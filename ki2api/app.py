"""
Ki2API - OpenAI-compatible API for Claude Sonnet 4 via AWS CodeWhisperer
"""
import os
import json
import time
import uuid
import httpx
import re
import asyncio
import base64
import copy
import logging
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Header, Depends
from fastapi.responses import StreamingResponse

# Local imports - support both package and direct execution
try:
    from .models import (
        ChatCompletionRequest, ChatCompletionResponse, ChatCompletionStreamResponse,
        ResponseMessage, Choice, StreamChoice, Usage, ToolCall
    )
    from .parsers import (
        CodeWhispererStreamParser, parse_bracket_tool_calls, parse_single_tool_call,
        find_matching_bracket, deduplicate_tool_calls
    )
    from .token_manager import TokenManager, load_auth_configs
except ImportError:
    from models import (
        ChatCompletionRequest, ChatCompletionResponse, ChatCompletionStreamResponse,
        ResponseMessage, Choice, StreamChoice, Usage, ToolCall
    )
    from parsers import (
        CodeWhispererStreamParser, parse_bracket_tool_calls, parse_single_tool_call,
        find_matching_bracket, deduplicate_tool_calls
    )
    from token_manager import TokenManager, load_auth_configs

# Configure logging
logging.basicConfig(level=logging.INFO)  # for dev
# logging.basicConfig(level=logging.WARNING) 
logger = logging.getLogger(__name__)

# Load environment variables
load_dotenv()

# Initialize FastAPI app
app = FastAPI(
    title="Ki2API - Claude Sonnet 4 OpenAI Compatible API",
    description="OpenAI-compatible API for Claude Sonnet 4 via AWS CodeWhisperer (Multi-Account Support)",
    version="3.1.0"
)

# Configuration
API_KEY = os.getenv("API_KEY", "ki2api-key-2024")
KIRO_BASE_URL = "https://codewhisperer.us-east-1.amazonaws.com/generateAssistantResponse"
PROFILE_ARN = "arn:aws:codewhisperer:us-east-1:699475941385:profile/EHGA3GRVQMUK"

# Model mapping
MODEL_MAP = {
    "claude-sonnet-4-5-20250929": "claude-sonnet-4-5",
    "claude-3-5-haiku-20241022":  "auto",
    "claude-opus-4.5": "claude-opus-4.5"
}
DEFAULT_MODEL = "claude-sonnet-4-5-20250929"

# Initialize TokenManager
_auth_configs = load_auth_configs()
token_manager = TokenManager(_auth_configs)


# ============================================================================
# Authentication
# ============================================================================

async def verify_api_key(authorization: str = Header(None)):
    if not authorization:
        raise HTTPException(
            status_code=401,
            detail={
                "error": {
                    "message": "You didn't provide an API key.",
                    "type": "invalid_request_error",
                    "param": None,
                    "code": "invalid_api_key"
                }
            }
        )
    
    if not authorization.startswith("Bearer "):
        raise HTTPException(
            status_code=401,
            detail={
                "error": {
                    "message": "Invalid API key format. Expected 'Bearer <key>'",
                    "type": "invalid_request_error",
                    "param": None,
                    "code": "invalid_api_key"
                }
            }
        )
    
    api_key = authorization.replace("Bearer ", "")
    if api_key != API_KEY:
        raise HTTPException(
            status_code=401,
            detail={
                "error": {
                    "message": "Invalid API key provided",
                    "type": "invalid_request_error",
                    "param": None,
                    "code": "invalid_api_key"
                }
            }
        )
    return api_key


# ============================================================================
# Request Builder
# ============================================================================

def build_codewhisperer_request(request: ChatCompletionRequest):
    logger.info(f"🔄 request model: {request.model}")
    codewhisperer_model = MODEL_MAP.get(request.model, MODEL_MAP[DEFAULT_MODEL])
    conversation_id = str(uuid.uuid4())
    
    # Extract system prompt and user messages
    system_prompt = ""
    conversation_messages = []
    
    for msg in request.messages:
        if msg.role == "system":
            system_prompt = msg.get_content_text()
        elif msg.role in ["user", "assistant", "tool"]:
            conversation_messages.append(msg)
    
    if not conversation_messages:
        raise HTTPException(
            status_code=400, 
            detail={
                "error": {
                    "message": "No conversation messages found",
                    "type": "invalid_request_error",
                    "param": "messages",
                    "code": "invalid_request"
                }
            }
        )
    
    # Build history - only include user/assistant pairs
    history = []
    
    # Process history messages (all except the last one)
    if len(conversation_messages) > 1:
        history_messages = conversation_messages[:-1]
        
        # Build user messages list (combining tool results with user messages)
        processed_messages = []
        i = 0
        while i < len(history_messages):
            msg = history_messages[i]
            
            if msg.role == "user":
                content = msg.get_content_text() or "Continue"
                processed_messages.append(("user", content))
                i += 1
            elif msg.role == "assistant":
                # Check if this assistant message contains tool calls
                if hasattr(msg, 'tool_calls') and msg.tool_calls:
                    # Build a description of the tool calls
                    tool_descriptions = []
                    for tc in msg.tool_calls:
                        func_name = tc.function.get("name", "unknown") if isinstance(tc.function, dict) else "unknown"
                        args = tc.function.get("arguments", "{}") if isinstance(tc.function, dict) else "{}"
                        tool_descriptions.append(f"[Called {func_name} with args: {args}]")
                    content = " ".join(tool_descriptions)
                    logger.info(f"📌 Processing assistant message with tool calls: {content}")
                else:
                    content = msg.get_content_text() or "I understand."
                processed_messages.append(("assistant", content))
                i += 1
            elif msg.role == "tool":
                # Combine tool results into the next user message
                tool_content = msg.get_content_text() or "[Tool executed]"
                tool_call_id = getattr(msg, 'tool_call_id', 'unknown')
                
                # Format tool result with ID for tracking
                formatted_tool_result = f"[Tool result for {tool_call_id}]: {tool_content}"
                
                # Look ahead to see if there's a user message
                if i + 1 < len(history_messages) and history_messages[i + 1].role == "user":
                    user_content = history_messages[i + 1].get_content_text() or ""
                    combined_content = f"{formatted_tool_result}\n{user_content}".strip()
                    processed_messages.append(("user", combined_content))
                    i += 2
                else:
                    # Tool result without following user message - add as user message
                    processed_messages.append(("user", formatted_tool_result))
                    i += 1
            else:
                i += 1
        
        # Build history pairs
        i = 0
        while i < len(processed_messages):
            role, content = processed_messages[i]
            
            if role == "user":
                history.append({
                    "userInputMessage": {
                        "content": content,
                        "modelId": codewhisperer_model,
                        "origin": "AI_EDITOR"
                    }
                })
                
                # Look for assistant response
                if i + 1 < len(processed_messages) and processed_messages[i + 1][0] == "assistant":
                    _, assistant_content = processed_messages[i + 1]
                    history.append({
                        "assistantResponseMessage": {
                            "content": assistant_content
                        }
                    })
                    i += 2
                else:
                    # No assistant response, add a placeholder
                    history.append({
                        "assistantResponseMessage": {
                            "content": "I understand."
                        }
                    })
                    i += 1
            elif role == "assistant":
                # Orphaned assistant message
                history.append({
                    "userInputMessage": {
                        "content": "Continue",
                        "modelId": codewhisperer_model,
                        "origin": "AI_EDITOR"
                    }
                })
                history.append({
                    "assistantResponseMessage": {
                        "content": content
                    }
                })
                i += 1
            else:
                i += 1
    
    # Build current message
    current_message = conversation_messages[-1]

    # Handle images in the last message
    images = []
    if isinstance(current_message.content, list):
        for part in current_message.content:
            if part.type == "image_url" and part.image_url:
                try:
                    logger.info(f"🔍 处理图片 URL: {part.image_url.url[:50]}...")
                    
                    if not part.image_url.url.startswith("data:image/"):
                        logger.error(f"❌ 图片 URL 格式不正确，应该以 'data:image/' 开头")
                        continue
                    
                    header, encoded_data = part.image_url.url.split(",", 1)
                    
                    match = re.search(r'image/(\w+)', header)
                    if match:
                        image_format = match.group(1)
                        try:
                            base64.b64decode(encoded_data)
                            logger.info("✅ Base64 编码验证通过")
                        except Exception as e:
                            logger.error(f"❌ Base64 编码无效: {e}")
                            continue
                            
                        images.append({
                            "format": image_format,
                            "source": {"bytes": encoded_data}
                        })
                        logger.info(f"🖼️ 成功处理图片，格式: {image_format}, 大小: {len(encoded_data)} 字符")
                    else:
                        logger.warning(f"⚠️ 无法从头部确定图片格式: {header}")
                except Exception as e:
                    logger.error(f"❌ 处理图片 URL 失败: {str(e)}")

    current_content = current_message.get_content_text()
    
    # Handle different roles for current message
    if current_message.role == "tool":
        tool_result = current_content or '[Tool executed]'
        tool_call_id = getattr(current_message, 'tool_call_id', 'unknown')
        current_content = f"[Tool execution completed for {tool_call_id}]: {tool_result}"
        
        if len(conversation_messages) > 1:
            prev_message = conversation_messages[-2]
            if prev_message.role == "assistant" and hasattr(prev_message, 'tool_calls') and prev_message.tool_calls:
                for tc in prev_message.tool_calls:
                    if tc.id == tool_call_id:
                        func_name = tc.function.get("name", "unknown") if isinstance(tc.function, dict) else "unknown"
                        current_content = f"[Completed execution of {func_name}]: {tool_result}"
                        break
    elif current_message.role == "assistant":
        if hasattr(current_message, 'tool_calls') and current_message.tool_calls:
            tool_descriptions = []
            for tc in current_message.tool_calls:
                func_name = tc.function.get("name", "unknown") if isinstance(tc.function, dict) else "unknown"
                tool_descriptions.append(f"Continue after calling {func_name}")
            current_content = "; ".join(tool_descriptions)
        else:
            current_content = "Continue the conversation"
    
    if not current_content:
        current_content = "Continue"
    
    if system_prompt:
        current_content = f"{system_prompt}\n\n{current_content}"
    
    # Build request
    codewhisperer_request = {
        "profileArn": PROFILE_ARN,
        "conversationState": {
            "chatTriggerType": "MANUAL",
            "conversationId": conversation_id,
            "currentMessage": {
                "userInputMessage": {
                    "content": current_content,
                    "modelId": codewhisperer_model,
                    "origin": "AI_EDITOR"
                }
            },
            "history": history
        }
    }
    
    # Add context for tools
    user_input_message_context = {}
    if request.tools:
        user_input_message_context["tools"] = [
            {
                "toolSpecification": {
                    "name": tool.function.name,
                    "description": tool.function.description or "",
                    "inputSchema": {"json": tool.function.parameters or {}}
                }
            } for tool in request.tools
        ]
    
    if images:
        codewhisperer_request["conversationState"]["currentMessage"]["userInputMessage"]["images"] = images
        logger.info(f"📊 添加了 {len(images)} 个图片到 userInputMessage 中")
        for i, img in enumerate(images):
            logger.info(f"  - 图片 {i+1}: 格式={img['format']}, 大小={len(img['source']['bytes'])} 字符")
            logger.info(f"  - 图片数据前20字符: {img['source']['bytes'][:20]}...")
        logger.info(f"✅ 成功添加 images 到 userInputMessage 中")

    if user_input_message_context:
        codewhisperer_request["conversationState"]["currentMessage"]["userInputMessage"]["userInputMessageContext"] = user_input_message_context
        logger.info(f"✅ 成功添加 userInputMessageContext 到请求中")
    
    # 创建一个用于日志记录的请求副本
    log_request = copy.deepcopy(codewhisperer_request)
    if "images" in log_request.get("conversationState", {}).get("currentMessage", {}).get("userInputMessage", {}):
        for img in log_request["conversationState"]["currentMessage"]["userInputMessage"]["images"]:
            if "bytes" in img.get("source", {}):
                img["source"]["bytes"] = img["source"]["bytes"][:20] + "..."
    
    logger.info(f"🔄 COMPLETE CODEWHISPERER REQUEST: {json.dumps(log_request, indent=2)}")
    return codewhisperer_request


# ============================================================================
# API Calls
# ============================================================================

async def call_kiro_api(request: ChatCompletionRequest):
    """Make API call to Kiro/CodeWhisperer with token refresh and rotation handling (非流式)"""
    token = await token_manager.get_token()
    if not token:
        raise HTTPException(
            status_code=401,
            detail={
                "error": {
                    "message": "No access token available",
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
        "Accept": "application/json"
    }

    max_retries = len(token_manager.configs) if token_manager.configs else 1

    for retry in range(max_retries):
        try:
            async with httpx.AsyncClient() as client:
                response = await client.post(
                    KIRO_BASE_URL,
                    headers=headers,
                    json=request_data,
                    timeout=120
                )

                logger.info(f"📤 RESPONSE STATUS: {response.status_code} (retry: {retry})")

                if response.status_code == 403:
                    logger.warning(f"收到403响应，标记当前token并尝试切换...")
                    token_manager.mark_token_error()
                    new_token = await token_manager.get_token()
                    if new_token and new_token != token:
                        token = new_token
                        headers["Authorization"] = f"Bearer {token}"
                        continue
                    else:
                        raise HTTPException(status_code=401, detail="All tokens failed")

                if response.status_code == 429:
                    logger.warning(f"收到429响应，标记当前token为耗尽并切换...")
                    token_manager.mark_token_exhausted("rate_limit")
                    new_token = await token_manager.get_token()
                    if new_token and new_token != token:
                        token = new_token
                        headers["Authorization"] = f"Bearer {token}"
                        continue
                    else:
                        raise HTTPException(
                            status_code=429,
                            detail={
                                "error": {
                                    "message": "Rate limit exceeded on all tokens",
                                    "type": "rate_limit_error",
                                    "param": None,
                                    "code": "rate_limit_exceeded"
                                }
                            }
                        )

                response.raise_for_status()
                return response

        except httpx.HTTPStatusError as e:
            logger.error(f"HTTP ERROR: {e.response.status_code} - {e.response.text}")
            token_manager.mark_token_error()
            if retry < max_retries - 1:
                new_token = await token_manager.get_token()
                if new_token:
                    token = new_token
                    headers["Authorization"] = f"Bearer {token}"
                    continue
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


async def call_kiro_api_stream(request: ChatCompletionRequest):
    """真正的流式 API 调用 - 返回流式响应的异步生成器"""
    token = await token_manager.get_token()
    if not token:
        raise HTTPException(
            status_code=401,
            detail={
                "error": {
                    "message": "No access token available",
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
        "Accept": "text/event-stream"
    }

    client = httpx.AsyncClient(timeout=httpx.Timeout(120.0, connect=30.0))

    max_retries = len(token_manager.configs) if token_manager.configs else 1

    for retry in range(max_retries):
        try:
            response = await client.send(
                client.build_request("POST", KIRO_BASE_URL, headers=headers, json=request_data),
                stream=True
            )

            logger.info(f"📤 STREAM RESPONSE STATUS: {response.status_code} (retry: {retry})")

            if response.status_code == 403:
                await response.aclose()
                logger.warning("收到403响应，标记当前token并尝试切换...")
                token_manager.mark_token_error()
                new_token = await token_manager.get_token()
                if new_token and new_token != token:
                    token = new_token
                    headers["Authorization"] = f"Bearer {token}"
                    continue
                else:
                    await client.aclose()
                    raise HTTPException(status_code=401, detail="All tokens failed")

            if response.status_code == 429:
                await response.aclose()
                logger.warning("收到429响应，标记当前token为耗尽并切换...")
                token_manager.mark_token_exhausted("rate_limit")
                new_token = await token_manager.get_token()
                if new_token and new_token != token:
                    token = new_token
                    headers["Authorization"] = f"Bearer {token}"
                    continue
                else:
                    await client.aclose()
                    raise HTTPException(
                        status_code=429,
                        detail={
                            "error": {
                                "message": "Rate limit exceeded on all tokens",
                                "type": "rate_limit_error",
                                "param": None,
                                "code": "rate_limit_exceeded"
                            }
                        }
                    )

            if response.status_code >= 400:
                error_body = await response.aread()
                await response.aclose()
                logger.error(f"HTTP ERROR: {response.status_code} - {error_body}")
                token_manager.mark_token_error()
                if retry < max_retries - 1:
                    new_token = await token_manager.get_token()
                    if new_token:
                        token = new_token
                        headers["Authorization"] = f"Bearer {token}"
                        continue
                await client.aclose()
                raise HTTPException(
                    status_code=503,
                    detail={
                        "error": {
                            "message": f"API call failed: {response.status_code}",
                            "type": "api_error",
                            "param": None,
                            "code": "api_error"
                        }
                    }
                )

            return response, client

        except HTTPException:
            await client.aclose()
            raise
        except Exception as e:
            if retry < max_retries - 1:
                token_manager.mark_token_error()
                new_token = await token_manager.get_token()
                if new_token:
                    token = new_token
                    headers["Authorization"] = f"Bearer {token}"
                    continue
            await client.aclose()
            logger.error(f"Stream API call failed: {str(e)}")
            raise HTTPException(
                status_code=503,
                detail={
                    "error": {
                        "message": f"Stream API call failed: {str(e)}",
                        "type": "api_error",
                        "param": None,
                        "code": "api_error"
                    }
                }
            )


# ============================================================================
# Utility Functions
# ============================================================================

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


# ============================================================================
# Response Handlers
# ============================================================================

async def create_non_streaming_response(request: ChatCompletionRequest):
    """非流式响应处理"""
    try:
        logger.info("🚀 开始非流式响应生成...")
        response = await call_kiro_api(request)
        
        logger.info(f"📤 CodeWhisperer响应状态码: {response.status_code}")
        logger.info(f"📤 响应头: {dict(response.headers)}")
        logger.info(f"📤 原始响应体长度: {len(response.content)} bytes")
        
        raw_response_text = ""
        try:
            raw_response_text = response.content.decode('utf-8', errors='ignore')
            logger.info(f"🔍 原始响应文本长度: {len(raw_response_text)}")
            logger.info(f"🔍 原始响应预览(前1000字符): {raw_response_text[:1000]}")
            
            if "[Called" in raw_response_text:
                logger.info("✅ 原始响应中发现 [Called 标记")
                called_positions = [m.start() for m in re.finditer(r'\[Called', raw_response_text)]
                logger.info(f"🎯 [Called 出现位置: {called_positions}")
            else:
                logger.info("❌ 原始响应中未发现 [Called 标记")
                
        except Exception as e:
            logger.error(f"❌ 解码原始响应失败: {e}")
        
        parser = CodeWhispererStreamParser()
        events = parser.parse(response.content)
        
        full_response_text = ""
        tool_calls = []
        current_tool_call_dict = None

        logger.info(f"🔄 解析到 {len(events)} 个事件，开始处理...")
        
        for i, event in enumerate(events):
            logger.info(f"📋 事件 {i}: {event}")

        for event in events:
            if "name" in event and "toolUseId" in event:
                logger.info(f"🔧 发现结构化工具调用事件: {event}")
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

                if "input" in event:
                    current_tool_call_dict["function"]["arguments"] += event.get("input", "")
                    logger.info(f"📝 累积参数: {event.get('input', '')}")

                if event.get("stop"):
                    logger.info(f"✅ 完成工具调用: {current_tool_call_dict['function']['name']}")
                    try:
                        args = json.loads(current_tool_call_dict["function"]["arguments"])
                        current_tool_call_dict["function"]["arguments"] = json.dumps(args, ensure_ascii=False)
                        logger.info(f"✅ 工具调用参数验证成功")
                    except json.JSONDecodeError as e:
                        logger.warning(f"⚠️ 工具调用的参数不是有效的JSON: {current_tool_call_dict['function']['arguments']}")
                        logger.warning(f"⚠️ JSON错误: {e}")
                    
                    tool_calls.append(ToolCall(**current_tool_call_dict))
                    current_tool_call_dict = None
            
            elif "content" in event:
                content = event.get("content", "")
                full_response_text += content
                logger.info(f"📄 添加文本内容: {content[:100]}...")

        if current_tool_call_dict:
            logger.warning("⚠️ 响应流在工具调用结束前终止，仍尝试添加。")
            tool_calls.append(ToolCall(**current_tool_call_dict))

        logger.info(f"📊 事件处理完成 - 文本长度: {len(full_response_text)}, 结构化工具调用: {len(tool_calls)}")

        logger.info("🔍 开始检查解析后文本中的bracket格式工具调用...")
        bracket_tool_calls = parse_bracket_tool_calls(full_response_text)
        if bracket_tool_calls:
            logger.info(f"✅ 在解析后文本中发现 {len(bracket_tool_calls)} 个 bracket 格式工具调用")
            tool_calls.extend(bracket_tool_calls)
            
            for tc in bracket_tool_calls:
                func_name = tc.function.get("name", "unknown")
                escaped_name = re.escape(func_name)
                pattern = r'\[Called\s+' + escaped_name + r'\s+with\s+args:\s*\{[^}]*(?:\{[^}]*\}[^}]*)*\}\s*\]'
                full_response_text = re.sub(pattern, '', full_response_text, flags=re.DOTALL)
            
            full_response_text = re.sub(r'\s+', ' ', full_response_text).strip()

        logger.info("🔍 开始检查原始响应中的bracket格式工具调用...")
        raw_bracket_tool_calls = parse_bracket_tool_calls(raw_response_text)
        if raw_bracket_tool_calls and isinstance(raw_bracket_tool_calls, list):
            logger.info(f"✅ 在原始响应中发现 {len(raw_bracket_tool_calls)} 个 bracket 格式工具调用")
            tool_calls.extend(raw_bracket_tool_calls)
        else:
            logger.info("❌ 原始响应中未发现bracket格式工具调用")

        logger.info(f"🔄 去重前工具调用数量: {len(tool_calls)}")
        unique_tool_calls = deduplicate_tool_calls(tool_calls)
        logger.info(f"🔄 去重后工具调用数量: {len(unique_tool_calls)}")

        if unique_tool_calls:
            logger.info(f"🔧 构建工具调用响应，包含 {len(unique_tool_calls)} 个工具调用")
            for i, tc in enumerate(unique_tool_calls):
                logger.info(f"🔧 工具调用 {i}: {tc.function.get('name', 'unknown')}")
            
            response_message = ResponseMessage(
                role="assistant",
                content=None,
                tool_calls=unique_tool_calls
            )
            finish_reason = "tool_calls"
        else:
            logger.info("📄 构建普通文本响应")
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
    """真正的流式响应处理 - 边接收边转发"""
    try:
        logger.info("🌊 开始真正的流式响应生成...")
        response, client = await call_kiro_api_stream(request)

        async def generate_stream():
            response_id = f"chatcmpl-{uuid.uuid4()}"
            created = int(time.time())
            parser = CodeWhispererStreamParser()

            is_in_tool_call = False
            sent_role = False
            current_tool_call_index = 0
            streamed_tool_calls_count = 0
            content_buffer = ""
            incomplete_tool_call = ""

            try:
                async for chunk in response.aiter_bytes():
                    events = parser.parse(chunk)

                    for event in events:
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

                        elif "content" in event and not is_in_tool_call:
                            content_text = event.get("content", "")
                            if content_text:
                                content_buffer += content_text

                                while True:
                                    called_start = content_buffer.find("[Called")

                                    if called_start == -1:
                                        if content_buffer and not incomplete_tool_call:
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

                                    remaining_text = content_buffer[called_start:]
                                    bracket_end = find_matching_bracket(remaining_text, 0)

                                    if bracket_end == -1:
                                        incomplete_tool_call = remaining_text
                                        content_buffer = ""
                                        break

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

                                        tool_chunk = ChatCompletionStreamResponse(
                                            id=response_id, model=request.model, created=created,
                                            choices=[StreamChoice(index=0, delta=delta_tool)]
                                        )
                                        yield f"data: {tool_chunk.model_dump_json(exclude_none=True)}\n\n"
                                        current_tool_call_index += 1
                                        streamed_tool_calls_count += 1

                                    content_buffer = remaining_text[bracket_end + 1:]
                                    incomplete_tool_call = ""

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

                if content_buffer.strip():
                    delta_content = {"content": content_buffer}
                    if not sent_role:
                        delta_content["role"] = "assistant"
                        sent_role = True

                    content_chunk = ChatCompletionStreamResponse(
                        id=response_id, model=request.model, created=created,
                        choices=[StreamChoice(index=0, delta=delta_content)]
                    )
                    yield f"data: {content_chunk.model_dump_json(exclude_none=True)}\n\n"

                finish_reason = "tool_calls" if streamed_tool_calls_count > 0 else "stop"
                logger.info(f"🏁 STREAM FINISH: streamed_tool_calls_count={streamed_tool_calls_count}, finish_reason={finish_reason}")
                end_chunk = ChatCompletionStreamResponse(
                    id=response_id, model=request.model, created=created,
                    choices=[StreamChoice(index=0, delta={}, finish_reason=finish_reason)]
                )
                yield f"data: {end_chunk.model_dump_json(exclude_none=True)}\n\n"

                yield "data: [DONE]\n\n"

            finally:
                await response.aclose()
                await client.aclose()
                logger.info("🧹 流式响应资源已清理")

        return StreamingResponse(
            generate_stream(),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "Content-Type": "text/event-stream"
            }
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"❌ 流式响应生成失败: {str(e)}")
        import traceback
        traceback.print_exc()
        raise HTTPException(
            status_code=500,
            detail={
                "error": {
                    "message": f"Stream generation failed: {str(e)}",
                    "type": "internal_server_error",
                    "param": None,
                    "code": "stream_error"
                }
            }
        )


# ============================================================================
# API Endpoints
# ============================================================================

@app.get("/v1/models")
async def list_models(api_key: str = Depends(verify_api_key)):
    """List available models"""
    return {
        "object": "list",
        "data": [
            {
                "id": model_id,
                "object": "model",
                "created": int(time.time()),
                "owned_by": "ki2api"
            }
            for model_id in MODEL_MAP.keys()
        ]
    }


@app.post("/v1/chat/completions")
async def create_chat_completion(
    request: ChatCompletionRequest,
    api_key: str = Depends(verify_api_key)
):
    """Create a chat completion"""
    logger.info(f"📥 COMPLETE REQUEST: {request.model_dump_json(indent=2)}")

    for i, msg in enumerate(request.messages):
        if msg.content is None and msg.role != "assistant":
            logger.warning(f"Message {i} with role '{msg.role}' has None content")

    if request.model not in MODEL_MAP:
        raise HTTPException(
            status_code=400,
            detail={
                "error": {
                    "message": f"The model '{request.model}' does not exist or you do not have access to it.",
                    "type": "invalid_request_error",
                    "param": "model",
                    "code": "model_not_found"
                }
            }
        )

    if request.stream:
        logger.info("🌊 使用真正的流式处理")
        return await create_streaming_response(request)
    else:
        logger.info("📄 使用非流式处理")
        return await create_non_streaming_response(request)


@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {
        "status": "healthy",
        "service": "Ki2API",
        "version": "3.1.0",
        "token_configs": len(token_manager.configs)
    }


@app.get("/v1/token/status")
async def token_status(api_key: str = Depends(verify_api_key)):
    """Token 管理器状态监控端点"""
    status = token_manager.get_status()
    return {
        "service": "Ki2API",
        "token_manager": status,
        "configs": [
            {
                "index": i,
                "auth_type": cfg.auth_type,
                "disabled": cfg.disabled,
                "refresh_token_preview": cfg.refresh_token[:20] + "..."
            }
            for i, cfg in enumerate(token_manager.configs)
        ]
    }


@app.post("/v1/token/reset")
async def reset_tokens(api_key: str = Depends(verify_api_key)):
    """重置所有 token 的耗尽状态"""
    token_manager.reset_all_exhausted()
    return {
        "status": "success",
        "message": "All token exhaustion states have been reset"
    }


@app.get("/")
async def root():
    """Root endpoint with service information"""
    return {
        "service": "Ki2API",
        "description": "OpenAI-compatible API for Claude Sonnet 4 via AWS CodeWhisperer",
        "version": "3.1.0",
        "endpoints": {
            "models": "/v1/models",
            "chat": "/v1/chat/completions",
            "health": "/health",
            "token_status": "/v1/token/status",
            "token_reset": "/v1/token/reset"
        },
        "features": {
            "streaming": True,
            "tools": True,
            "multiple_models": True,
            "xml_tool_parsing": True,
            "auto_token_refresh": True,
            "null_content_handling": True,
            "tool_call_deduplication": True,
            "multi_account_rotation": True
        },
        "token_configs_count": len(token_manager.configs)
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8989)
