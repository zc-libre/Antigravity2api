import re
import json
import time
import uuid
import logging
import httpx
from fastapi import HTTPException
from fastapi.responses import StreamingResponse

from config import KIRO_BASE_URL
from models.schemas import (
    ChatCompletionRequest,
    ChatCompletionResponse,
    ChatCompletionStreamResponse,
    ResponseMessage,
    Choice,
    StreamChoice,
    Usage,
    ToolCall,
)
from auth import token_manager
from parsers.stream_parser import CodeWhispererStreamParser
from parsers.bracket_parser import (
    parse_bracket_tool_calls,
    parse_single_tool_call,
    find_matching_bracket,
    deduplicate_tool_calls,
)
from services.request_builder import build_codewhisperer_request

logger = logging.getLogger(__name__)


def estimate_tokens(text: str) -> int:
    """Rough token estimation"""
    return max(1, len(text) // 4)


def create_usage_stats(prompt_text: str, completion_text: str) -> Usage:
    """Create usage statistics"""
    prompt_tokens = estimate_tokens(prompt_text)
    completion_tokens = estimate_tokens(completion_text)
    return Usage(
        prompt_tokens=prompt_tokens,
        completion_tokens=completion_tokens,
        total_tokens=prompt_tokens + completion_tokens
    )


async def call_kiro_api(request: ChatCompletionRequest):
    """
    Make API call to Kiro/CodeWhisperer with multi-account token rotation
    
    功能：
    - 多账号轮询支持
    - 自动刷新过期 token
    - 429 错误时自动切换账号
    - 403 错误时刷新 token 并重试
    """
    # 使用多账号 token 管理器获取 token
    token = await token_manager.get_token()
    if not token:
        raise HTTPException(
            status_code=401, 
            detail={
                "error": {
                    "message": "No access token available. Please check your KIRO_AUTH_CONFIG configuration.",
                    "type": "authentication_error",
                    "param": None,
                    "code": "invalid_api_key"
                }
            }
        )
    
    request_data = build_codewhisperer_request(request)
    
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
        "Accept": "text/event-stream" if request.stream else "application/json"
    }

    # 最大重试次数（用于轮询多个账号）
    max_retries = 3
    
    try:
        async with httpx.AsyncClient() as client:
            for attempt in range(max_retries):
                response = await client.post(
                    KIRO_BASE_URL,
                    headers=headers,
                    json=request_data,
                    timeout=120
                )
                
                logger.info(f"📤 RESPONSE STATUS: {response.status_code} (attempt {attempt + 1})")
                
                if response.status_code == 403:
                    logger.info("收到403响应，尝试刷新token...")
                    new_token = await token_manager.refresh_tokens()
                    if new_token:
                        headers["Authorization"] = f"Bearer {new_token}"
                        continue  # 使用新 token 重试
                    else:
                        # 刷新失败，尝试切换到下一个账号
                        token_manager.mark_token_error()
                        new_token = await token_manager.get_token()
                        if new_token:
                            headers["Authorization"] = f"Bearer {new_token}"
                            continue
                        raise HTTPException(status_code=401, detail="Token refresh failed and no backup accounts available")
                
                if response.status_code == 429:
                    logger.warning("收到429响应（速率限制），尝试切换账号...")
                    # 标记当前 token 已耗尽，切换到下一个账号
                    token_manager.mark_token_exhausted("rate_limit_429")
                    
                    # 尝试获取新 token
                    new_token = await token_manager.get_token()
                    if new_token and attempt < max_retries - 1:
                        headers["Authorization"] = f"Bearer {new_token}"
                        logger.info("已切换到新账号，重试请求...")
                        continue
                    
                    # 所有账号都耗尽
                    raise HTTPException(
                        status_code=429,
                        detail={
                            "error": {
                                "message": "All accounts rate limited. Please try again later.",
                                "type": "rate_limit_error",
                                "param": None,
                                "code": "rate_limit_exceeded"
                            }
                        }
                    )
                
                response.raise_for_status()
                return response
            
            # 所有重试都失败
            raise HTTPException(
                status_code=503,
                detail={
                    "error": {
                        "message": "API call failed after multiple retries",
                        "type": "api_error",
                        "param": None,
                        "code": "api_error"
                    }
                }
            )
            
    except httpx.HTTPStatusError as e:
        logger.error(f"HTTP ERROR: {e.response.status_code} - {e.response.text}")
        token_manager.mark_token_error()
        raise HTTPException(
            status_code=503,
            detail={
                "error": {
                    "message": f"API call failed: {str(e)}",
                    "type": "api_error",
                    "param": None,
                    "code": "api_error"
                }
            }
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"API call failed: {str(e)}")
        token_manager.mark_token_error()
        raise HTTPException(
            status_code=503,
            detail={
                "error": {
                    "message": f"API call failed: {str(e)}",
                    "type": "api_error",
                    "param": None,
                    "code": "api_error"
                }
            }
        )


async def create_non_streaming_response(request: ChatCompletionRequest):
    """
    Handles non-streaming chat completion requests.
    It fetches the complete response from CodeWhisperer, parses it using
    CodeWhispererStreamParser, and constructs a single OpenAI-compatible
    ChatCompletionResponse. This version correctly handles tool calls by
    parsing both structured event data and bracket format in text.
    """
    try:
        logger.info("🚀 开始非流式响应生成...")
        response = await call_kiro_api(request)
        
        # 添加详细的原始响应日志
        logger.info(f"📤 CodeWhisperer响应状态码: {response.status_code}")
        logger.info(f"📤 响应头: {dict(response.headers)}")
        logger.info(f"📤 原始响应体长度: {len(response.content)} bytes")
        
        # 获取原始响应文本用于工具调用检测
        raw_response_text = ""
        try:
            raw_response_text = response.content.decode('utf-8', errors='ignore')
            logger.info(f"🔍 原始响应文本长度: {len(raw_response_text)}")
            logger.info(f"🔍 原始响应预览(前1000字符): {raw_response_text[:1000]}")
            
            # 检查是否包含工具调用标记
            if "[Called" in raw_response_text:
                logger.info("✅ 原始响应中发现 [Called 标记")
                called_positions = [m.start() for m in re.finditer(r'\[Called', raw_response_text)]
                logger.info(f"🎯 [Called 出现位置: {called_positions}")
            else:
                logger.info("❌ 原始响应中未发现 [Called 标记")
                
        except Exception as e:
            logger.error(f"❌ 解码原始响应失败: {e}")
        
        # 使用 CodeWhispererStreamParser 一次性解析整个响应体
        parser = CodeWhispererStreamParser()
        events = parser.parse(response.content)
        
        full_response_text = ""
        tool_calls = []
        current_tool_call_dict = None

        logger.info(f"🔄 解析到 {len(events)} 个事件，开始处理...")
        
        # 记录每个事件的详细信息
        for i, event in enumerate(events):
            logger.info(f"📋 事件 {i}: {event}")

        for event in events:
            # 优先处理结构化工具调用事件
            if "name" in event and "toolUseId" in event:
                logger.info(f"🔧 发现结构化工具调用事件: {event}")
                # 如果是新的工具调用，则初始化
                if not current_tool_call_dict:
                    current_tool_call_dict = {
                        "id": event.get("toolUseId"),
                        "type": "function",
                        "function": {
                            "name": event.get("name"),
                            "arguments": ""
                        }
                    }
                    logger.info(f"🆕 开始解析工具调用: {current_tool_call_dict['function']['name']}")

                # 累积参数
                if "input" in event:
                    current_tool_call_dict["function"]["arguments"] += event.get("input", "")
                    logger.info(f"📝 累积参数: {event.get('input', '')}")

                # 工具调用结束
                if event.get("stop"):
                    logger.info(f"✅ 完成工具调用: {current_tool_call_dict['function']['name']}")
                    # 验证并标准化参数为JSON字符串
                    try:
                        args = json.loads(current_tool_call_dict["function"]["arguments"])
                        current_tool_call_dict["function"]["arguments"] = json.dumps(args, ensure_ascii=False)
                        logger.info(f"✅ 工具调用参数验证成功")
                    except json.JSONDecodeError as e:
                        logger.warning(f"⚠️ 工具调用的参数不是有效的JSON: {current_tool_call_dict['function']['arguments']}")
                        logger.warning(f"⚠️ JSON错误: {e}")
                    
                    tool_calls.append(ToolCall(**current_tool_call_dict))
                    current_tool_call_dict = None # 重置以备下一个
            
            # 处理普通文本内容事件
            elif "content" in event:
                content = event.get("content", "")
                full_response_text += content
                logger.info(f"📄 添加文本内容: {content[:100]}...")

        # 如果流在工具调用中间意外结束，也将其添加
        if current_tool_call_dict:
            logger.warning("⚠️ 响应流在工具调用结束前终止，仍尝试添加。")
            tool_calls.append(ToolCall(**current_tool_call_dict))

        logger.info(f"📊 事件处理完成 - 文本长度: {len(full_response_text)}, 结构化工具调用: {len(tool_calls)}")

        # 检查解析后文本中的 bracket 格式工具调用
        logger.info("🔍 开始检查解析后文本中的bracket格式工具调用...")
        bracket_tool_calls = parse_bracket_tool_calls(full_response_text)
        if bracket_tool_calls:
            logger.info(f"✅ 在解析后文本中发现 {len(bracket_tool_calls)} 个 bracket 格式工具调用")
            tool_calls.extend(bracket_tool_calls)
            
            # 从响应文本中移除工具调用文本
            for tc in bracket_tool_calls:
                # 构建精确的正则表达式来匹配这个特定的工具调用
                func_name = tc.function.get("name", "unknown")
                # 转义函数名中的特殊字符
                escaped_name = re.escape(func_name)
                # 匹配 [Called FunctionName with args: {...}]
                pattern = r'\[Called\s+' + escaped_name + r'\s+with\s+args:\s*\{[^}]*(?:\{[^}]*\}[^}]*)*\}\s*\]'
                full_response_text = re.sub(pattern, '', full_response_text, flags=re.DOTALL)
            
            # 清理多余的空白
            full_response_text = re.sub(r'\s+', ' ', full_response_text).strip()

        # 关键修复：检查原始响应中的 bracket 格式工具调用
        logger.info("🔍 开始检查原始响应中的bracket格式工具调用...")
        raw_bracket_tool_calls = parse_bracket_tool_calls(raw_response_text)
        if raw_bracket_tool_calls and isinstance(raw_bracket_tool_calls, list):
            logger.info(f"✅ 在原始响应中发现 {len(raw_bracket_tool_calls)} 个 bracket 格式工具调用")
            tool_calls.extend(raw_bracket_tool_calls)
        else:
            logger.info("❌ 原始响应中未发现bracket格式工具调用")

        # 去重工具调用
        logger.info(f"🔄 去重前工具调用数量: {len(tool_calls)}")
        unique_tool_calls = deduplicate_tool_calls(tool_calls)
        logger.info(f"🔄 去重后工具调用数量: {len(unique_tool_calls)}")

        # 根据是否有工具调用来构建响应
        if unique_tool_calls:
            logger.info(f"🔧 构建工具调用响应，包含 {len(unique_tool_calls)} 个工具调用")
            for i, tc in enumerate(unique_tool_calls):
                logger.info(f"🔧 工具调用 {i}: {tc.function.get('name', 'unknown')}")
            
            response_message = ResponseMessage(
                role="assistant",
                content=None,  # OpenAI规范：当有tool_calls时，content必须为None
                tool_calls=unique_tool_calls
            )
            finish_reason = "tool_calls"
        else:
            logger.info("📄 构建普通文本响应")
            # 如果没有工具调用，使用清理后的文本
            content = full_response_text.strip() if full_response_text.strip() else "I understand."
            logger.info(f"📄 最终文本内容: {content[:200]}...")
            
            response_message = ResponseMessage(
                role="assistant",
                content=content
            )
            finish_reason = "stop"

        choice = Choice(
            index=0,
            message=response_message,
            finish_reason=finish_reason
        )

        usage = create_usage_stats(
            prompt_text=" ".join([msg.get_content_text() for msg in request.messages]),
            completion_text=full_response_text if not unique_tool_calls else ""
        )

        chat_response = ChatCompletionResponse(
            model=request.model,
            choices=[choice],
            usage=usage
        )
        
        logger.info(f"📤 最终非流式响应构建完成")
        logger.info(f"📤 响应类型: {'工具调用' if unique_tool_calls else '文本内容'}")
        logger.info(f"📤 完整响应: {chat_response.model_dump_json(indent=2, exclude_none=True)}")
        return chat_response
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"❌ 非流式响应处理出错: {e}")
        import traceback
        traceback.print_exc()
        raise HTTPException(
            status_code=500,
            detail={
                "error": {
                    "message": f"Internal server error: {str(e)}",
                    "type": "internal_server_error",
                    "param": None,
                    "code": "internal_error"
                }
            }
        )


async def create_streaming_response(request: ChatCompletionRequest):
    """
    Handles streaming chat completion requests.
    真正的流式处理：在同一个上下文中保持 HTTP 连接，边收边推。
    """
    
    async def generate_stream():
        response_id = f"chatcmpl-{uuid.uuid4()}"
        created = int(time.time())
        parser = CodeWhispererStreamParser()

        # --- 状态变量 ---
        is_in_tool_call = False
        sent_role = False
        current_tool_call_index = 0
        streamed_tool_calls_count = 0
        content_buffer = ""
        incomplete_tool_call = ""

        # 准备请求 - 使用多账号 token 管理器
        token = await token_manager.get_token()
        if not token:
            yield f"data: {json.dumps({'error': {'message': 'No access token available. Please check your KIRO_AUTH_CONFIG configuration.', 'type': 'authentication_error'}})}\n\n"
            return

        request_data = build_codewhisperer_request(request)
        headers = {
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
            "Accept": "text/event-stream"
        }

        # 使用 httpx.Timeout 分离连接超时和读取超时，避免长对话被截断
        timeout = httpx.Timeout(connect=30.0, read=None, write=30.0, pool=30.0)

        try:
            async with httpx.AsyncClient(timeout=timeout) as client:
                # 支持 403 重试的循环
                max_retries = 2
                for attempt in range(max_retries):
                    async with client.stream("POST", KIRO_BASE_URL, headers=headers, json=request_data) as response:
                        logger.info(f"📤 STREAM RESPONSE STATUS: {response.status_code} (attempt {attempt + 1})")

                        # 处理 403 - 刷新 token 并重试
                        if response.status_code == 403 and attempt < max_retries - 1:
                            logger.info("收到403响应，尝试刷新token...")
                            new_token = await token_manager.refresh_tokens()
                            if new_token:
                                headers["Authorization"] = f"Bearer {new_token}"
                                continue  # 重试
                            else:
                                # 尝试切换到下一个账号
                                token_manager.mark_token_error()
                                new_token = await token_manager.get_token()
                                if new_token:
                                    headers["Authorization"] = f"Bearer {new_token}"
                                    continue
                                yield f"data: {json.dumps({'error': {'message': 'Token refresh failed and no backup accounts available', 'type': 'authentication_error'}})}\n\n"
                                return

                        if response.status_code == 429:
                            logger.warning("收到429响应（速率限制），尝试切换账号...")
                            # 标记当前 token 已耗尽，切换到下一个账号
                            token_manager.mark_token_exhausted("rate_limit_429")
                            
                            if attempt < max_retries - 1:
                                new_token = await token_manager.get_token()
                                if new_token:
                                    headers["Authorization"] = f"Bearer {new_token}"
                                    logger.info("已切换到新账号，重试请求...")
                                    continue
                            
                            yield f"data: {json.dumps({'error': {'message': 'All accounts rate limited. Please try again later.', 'type': 'rate_limit_error'}})}\n\n"
                            return

                        if response.status_code != 200:
                            yield f"data: {json.dumps({'error': {'message': f'API error: {response.status_code}', 'type': 'api_error'}})}\n\n"
                            return

                        # 真正的流式处理：边收边推
                        async for chunk in response.aiter_bytes():
                            events = parser.parse(chunk)
                            
                            for event in events:
                                # --- 处理结构化工具调用事件 ---
                                if "name" in event and "toolUseId" in event:
                                    logger.info(f"🎯 STREAM: Found structured tool call event: {event}")
                                    if not is_in_tool_call:
                                        is_in_tool_call = True
                                        
                                        delta_start = {
                                            "tool_calls": [{
                                                "index": current_tool_call_index,
                                                "id": event.get("toolUseId"),
                                                "type": "function",
                                                "function": {"name": event.get("name"), "arguments": ""}
                                            }]
                                        }
                                        if not sent_role:
                                            delta_start["role"] = "assistant"
                                            sent_role = True

                                        start_chunk = ChatCompletionStreamResponse(
                                            id=response_id, model=request.model, created=created,
                                            choices=[StreamChoice(index=0, delta=delta_start)]
                                        )
                                        yield f"data: {start_chunk.model_dump_json(exclude_none=True)}\n\n"

                                    if "input" in event:
                                        arg_chunk_str = event.get("input", "")
                                        if arg_chunk_str:
                                            arg_chunk_delta = {
                                                "tool_calls": [{
                                                    "index": current_tool_call_index,
                                                    "function": {"arguments": arg_chunk_str}
                                                }]
                                            }
                                            arg_chunk_resp = ChatCompletionStreamResponse(
                                                id=response_id, model=request.model, created=created,
                                                choices=[StreamChoice(index=0, delta=arg_chunk_delta)]
                                            )
                                            yield f"data: {arg_chunk_resp.model_dump_json(exclude_none=True)}\n\n"

                                    if event.get("stop"):
                                        is_in_tool_call = False
                                        current_tool_call_index += 1
                                        streamed_tool_calls_count += 1

                                # --- 处理普通文本内容事件 ---
                                elif "content" in event and not is_in_tool_call:
                                    content_text = event.get("content", "")
                                    if content_text:
                                        # 如果有不完整的工具调用，先合并再处理
                                        if incomplete_tool_call:
                                            content_buffer = incomplete_tool_call + content_text
                                            incomplete_tool_call = ""
                                        else:
                                            content_buffer += content_text
                                        
                                        # 处理 bracket 格式的工具调用
                                        while True:
                                            called_start = content_buffer.find("[Called")
                                            
                                            if called_start == -1:
                                                # 没有工具调用，发送所有内容
                                                if content_buffer:
                                                    delta_content = {"content": content_buffer}
                                                    if not sent_role:
                                                        delta_content["role"] = "assistant"
                                                        sent_role = True
                                                    
                                                    content_chunk = ChatCompletionStreamResponse(
                                                        id=response_id, model=request.model, created=created,
                                                        choices=[StreamChoice(index=0, delta=delta_content)]
                                                    )
                                                    yield f"data: {content_chunk.model_dump_json(exclude_none=True)}\n\n"
                                                    content_buffer = ""
                                                break
                                            
                                            # 发送 [Called 之前的文本
                                            if called_start > 0:
                                                text_before = content_buffer[:called_start]
                                                if text_before.strip():
                                                    delta_content = {"content": text_before}
                                                    if not sent_role:
                                                        delta_content["role"] = "assistant"
                                                        sent_role = True
                                                    
                                                    content_chunk = ChatCompletionStreamResponse(
                                                        id=response_id, model=request.model, created=created,
                                                        choices=[StreamChoice(index=0, delta=delta_content)]
                                                    )
                                                    yield f"data: {content_chunk.model_dump_json(exclude_none=True)}\n\n"
                                            
                                            # 查找对应的结束 ]
                                            remaining_text = content_buffer[called_start:]
                                            bracket_end = find_matching_bracket(remaining_text, 0)
                                            
                                            if bracket_end == -1:
                                                # 工具调用不完整，保留等待更多数据
                                                incomplete_tool_call = remaining_text
                                                content_buffer = ""
                                                break
                                            
                                            # 提取完整的工具调用
                                            tool_call_text = remaining_text[:bracket_end + 1]
                                            parsed_call = parse_single_tool_call(tool_call_text)
                                            
                                            if parsed_call:
                                                delta_tool = {
                                                    "tool_calls": [{
                                                        "index": current_tool_call_index,
                                                        "id": parsed_call.id,
                                                        "type": "function",
                                                        "function": {
                                                            "name": parsed_call.function["name"],
                                                            "arguments": parsed_call.function["arguments"]
                                                        }
                                                    }]
                                                }
                                                if not sent_role:
                                                    delta_tool["role"] = "assistant"
                                                    sent_role = True
                                                
                                                logger.info(f"📤 STREAM: Sending tool call: {parsed_call.function['name']}")
                                                tool_chunk = ChatCompletionStreamResponse(
                                                    id=response_id, model=request.model, created=created,
                                                    choices=[StreamChoice(index=0, delta=delta_tool)]
                                                )
                                                yield f"data: {tool_chunk.model_dump_json(exclude_none=True)}\n\n"
                                                current_tool_call_index += 1
                                                streamed_tool_calls_count += 1
                                            
                                            # 更新缓冲区，继续处理剩余内容
                                            content_buffer = remaining_text[bracket_end + 1:]
                                            incomplete_tool_call = ""

                        # 流结束后处理 parser buffer 中的残留数据
                        logger.info(f"🔄 Stream ended, parser buffer remaining: {parser.get_remaining_buffer_size()} bytes")
                        
                        if parser.has_remaining_data():
                            flush_events = parser.flush()
                            logger.info(f"🔄 Flushed {len(flush_events)} events from parser buffer")
                            
                            for event in flush_events:
                                if "content" in event and not is_in_tool_call:
                                    content_text = event.get("content", "")
                                    if content_text:
                                        content_buffer += content_text
                                        logger.info(f"📝 Recovered content from flush: {len(content_text)} chars")
                        
                        # 处理 incomplete_tool_call 中的残留内容
                        if incomplete_tool_call:
                            content_buffer = incomplete_tool_call + content_buffer
                            incomplete_tool_call = ""
                            
                            called_start = content_buffer.find("[Called")
                            if called_start == 0:
                                bracket_end = find_matching_bracket(content_buffer, 0)
                                if bracket_end != -1:
                                    tool_call_text = content_buffer[:bracket_end + 1]
                                    parsed_call = parse_single_tool_call(tool_call_text)
                                    
                                    if parsed_call:
                                        delta_tool = {
                                            "tool_calls": [{
                                                "index": current_tool_call_index,
                                                "id": parsed_call.id,
                                                "type": "function",
                                                "function": {
                                                    "name": parsed_call.function["name"],
                                                    "arguments": parsed_call.function["arguments"]
                                                }
                                            }]
                                        }
                                        if not sent_role:
                                            delta_tool["role"] = "assistant"
                                            sent_role = True
                                        
                                        tool_chunk = ChatCompletionStreamResponse(
                                            id=response_id, model=request.model, created=created,
                                            choices=[StreamChoice(index=0, delta=delta_tool)]
                                        )
                                        yield f"data: {tool_chunk.model_dump_json(exclude_none=True)}\n\n"
                                        current_tool_call_index += 1
                                        streamed_tool_calls_count += 1
                                        
                                        content_buffer = content_buffer[bracket_end + 1:]

                        # 发送任何剩余的内容
                        if content_buffer.strip():
                            logger.info(f"📤 Sending remaining content: {len(content_buffer)} chars")
                            delta_content = {"content": content_buffer}
                            if not sent_role:
                                delta_content["role"] = "assistant"
                                sent_role = True
                            
                            content_chunk = ChatCompletionStreamResponse(
                                id=response_id, model=request.model, created=created,
                                choices=[StreamChoice(index=0, delta=delta_content)]
                            )
                            yield f"data: {content_chunk.model_dump_json(exclude_none=True)}\n\n"

                        # --- 流结束 ---
                        finish_reason = "tool_calls" if streamed_tool_calls_count > 0 else "stop"
                        logger.info(f"🏁 STREAM: Completed with {streamed_tool_calls_count} tool calls, finish_reason={finish_reason}")
                        end_chunk = ChatCompletionStreamResponse(
                            id=response_id, model=request.model, created=created,
                            choices=[StreamChoice(index=0, delta={}, finish_reason=finish_reason)]
                        )
                        yield f"data: {end_chunk.model_dump_json(exclude_none=True)}\n\n"
                        
                        yield "data: [DONE]\n\n"
                        return  # 成功完成，退出重试循环

        except httpx.HTTPStatusError as e:
            logger.error(f"HTTP ERROR in stream: {e}")
            yield f"data: {json.dumps({'error': {'message': str(e), 'type': 'api_error'}})}\n\n"
        except Exception as e:
            logger.error(f"Stream error: {e}")
            import traceback
            traceback.print_exc()
            yield f"data: {json.dumps({'error': {'message': str(e), 'type': 'internal_error'}})}\n\n"

    return StreamingResponse(
        generate_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "Content-Type": "text/event-stream"
        }
    )
