"""
Claude API 请求转换器
将 Claude API 请求转换为 CodeWhisperer API 请求
与 request_builder.py (OpenAI格式) 发送的字段完全一致
"""

import re
import json
import uuid
import copy
import base64
import logging
from typing import List, Dict, Any, Optional

from config import MODEL_MAP, DEFAULT_MODEL, PROFILE_ARN
from models.claude_schemas import ClaudeRequest, ClaudeMessage

logger = logging.getLogger(__name__)


def map_claude_model_to_codewhisperer(claude_model: str) -> str:
    """
    将 Claude 模型名称映射到 CodeWhisperer 模型
    完全基于 config.py 中的 MODEL_MAP 配置，只支持精确匹配
    """
    # 精确匹配
    if claude_model in MODEL_MAP:
        logger.info(f"✅ 模型匹配: {claude_model} -> {MODEL_MAP[claude_model]}")
        return MODEL_MAP[claude_model]
    
    # 使用默认模型
    default_value = MODEL_MAP.get(DEFAULT_MODEL)
    if default_value:
        logger.info(f"⚠️ 模型未匹配，使用默认值: {claude_model} -> {default_value}")
        return default_value
    
    # 最后的兜底
    logger.error(f"❌ 无法映射模型: {claude_model}")
    raise ValueError(f"No model mapping available for: {claude_model}")


def extract_text_from_claude_content(content) -> str:
    """从 Claude 内容中提取文本"""
    if content is None:
        return ""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        text_parts = []
        for block in content:
            if isinstance(block, dict):
                if block.get("type") == "text":
                    text_parts.append(block.get("text", ""))
                elif block.get("type") == "tool_result":
                    result_content = block.get("content", "")
                    if isinstance(result_content, str):
                        text_parts.append(result_content)
                    elif isinstance(result_content, list):
                        for item in result_content:
                            if isinstance(item, dict) and item.get("type") == "text":
                                text_parts.append(item.get("text", ""))
            elif hasattr(block, "type"):
                if block.type == "text":
                    text_parts.append(block.text)
        return "".join(text_parts)
    return str(content) if content else ""


def extract_images_from_claude_content(content) -> List[Dict[str, Any]]:
    """从 Claude 内容中提取图片，转换为 CodeWhisperer 格式"""
    images = []
    if not isinstance(content, list):
        return images
    
    for block in content:
        if isinstance(block, dict) and block.get("type") == "image":
            source = block.get("source", {})
            if source.get("type") == "base64":
                media_type = source.get("media_type", "image/png")
                match = re.search(r'image/(\w+)', media_type)
                if match:
                    image_format = match.group(1)
                    encoded_data = source.get("data", "")
                    
                    # 验证 Base64 编码
                    try:
                        base64.b64decode(encoded_data)
                        images.append({
                            "format": image_format,
                            "source": {"bytes": encoded_data}
                        })
                        logger.info(f"🖼️ 成功处理图片，格式: {image_format}, 大小: {len(encoded_data)} 字符")
                    except Exception as e:
                        logger.error(f"❌ Base64 编码无效: {e}")
    
    return images


def convert_claude_to_codewhisperer_request(request: ClaudeRequest) -> Dict[str, Any]:
    """
    将 Claude API 请求转换为 CodeWhisperer API 请求
    与 request_builder.py (OpenAI格式) 发送的字段完全一致
    """
    logger.info(f"🔄 request model: {request.model}")
    codewhisperer_model = map_claude_model_to_codewhisperer(request.model)
    conversation_id = str(uuid.uuid4())
    
    # 提取 system prompt
    system_prompt = ""
    if request.system:
        if isinstance(request.system, str):
            system_prompt = request.system
        elif isinstance(request.system, list):
            system_parts = []
            for block in request.system:
                if hasattr(block, "type") and block.type == "text":
                    system_parts.append(block.text)
                elif isinstance(block, dict) and block.get("type") == "text":
                    system_parts.append(block.get("text", ""))
            system_prompt = "\n".join(system_parts)
    
    # 转换消息为类似 OpenAI 格式的处理
    conversation_messages = []
    for msg in request.messages:
        conversation_messages.append(msg)
    
    if not conversation_messages:
        raise ValueError("No conversation messages found")
    
    # 构建历史记录 - 与 OpenAI 格式完全一致
    history = []
    
    if len(conversation_messages) > 1:
        history_messages = conversation_messages[:-1]
        
        # 处理历史消息
        processed_messages = []
        i = 0
        while i < len(history_messages):
            msg = history_messages[i]
            
            if msg.role == "user":
                content = extract_text_from_claude_content(msg.content) or "Continue"
                
                # 检查是否包含 tool_result
                if isinstance(msg.content, list):
                    tool_results = []
                    text_parts = []
                    for block in msg.content:
                        if isinstance(block, dict):
                            if block.get("type") == "tool_result":
                                tool_use_id = block.get("tool_use_id", "unknown")
                                result_content = block.get("content", "")
                                if isinstance(result_content, str):
                                    tool_results.append(f"[Tool result for {tool_use_id}]: {result_content}")
                                elif isinstance(result_content, list):
                                    result_text = "".join([
                                        item.get("text", "") for item in result_content 
                                        if isinstance(item, dict) and item.get("type") == "text"
                                    ])
                                    tool_results.append(f"[Tool result for {tool_use_id}]: {result_text}")
                            elif block.get("type") == "text":
                                text_parts.append(block.get("text", ""))
                    
                    if tool_results:
                        content = "\n".join(tool_results)
                        if text_parts:
                            content += "\n" + "".join(text_parts)
                
                processed_messages.append(("user", content))
                i += 1
            
            elif msg.role == "assistant":
                # 检查是否包含 tool_use
                if isinstance(msg.content, list):
                    tool_descriptions = []
                    text_content = ""
                    for block in msg.content:
                        if isinstance(block, dict):
                            if block.get("type") == "tool_use":
                                func_name = block.get("name", "unknown")
                                args = json.dumps(block.get("input", {}))
                                tool_descriptions.append(f"[Called {func_name} with args: {args}]")
                            elif block.get("type") == "text":
                                text_content += block.get("text", "")
                    
                    if tool_descriptions:
                        content = " ".join(tool_descriptions)
                        logger.info(f"📌 Processing assistant message with tool calls: {content}")
                    else:
                        content = text_content or "I understand."
                else:
                    content = extract_text_from_claude_content(msg.content) or "I understand."
                
                processed_messages.append(("assistant", content))
                i += 1
            else:
                i += 1
        
        # 构建历史记录对 - 与 OpenAI 格式完全一致
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
                
                # 查找助手响应
                if i + 1 < len(processed_messages) and processed_messages[i + 1][0] == "assistant":
                    _, assistant_content = processed_messages[i + 1]
                    history.append({
                        "assistantResponseMessage": {
                            "content": assistant_content
                        }
                    })
                    i += 2
                else:
                    # 没有助手响应，添加占位符
                    history.append({
                        "assistantResponseMessage": {
                            "content": "I understand."
                        }
                    })
                    i += 1
            elif role == "assistant":
                # 孤立的助手消息
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
    
    # 构建当前消息
    current_message = conversation_messages[-1]
    
    # 处理当前消息中的图片
    images = extract_images_from_claude_content(current_message.content)
    
    # 获取当前消息内容
    current_content = extract_text_from_claude_content(current_message.content)
    
    # 处理不同角色的当前消息 - 与 OpenAI 格式一致
    if current_message.role == "user":
        # 检查是否包含 tool_result
        if isinstance(current_message.content, list):
            tool_results = []
            text_parts = []
            for block in current_message.content:
                if isinstance(block, dict):
                    if block.get("type") == "tool_result":
                        tool_use_id = block.get("tool_use_id", "unknown")
                        result_content = block.get("content", "")
                        if isinstance(result_content, str):
                            tool_results.append(f"[Tool execution completed for {tool_use_id}]: {result_content}")
                        elif isinstance(result_content, list):
                            result_text = "".join([
                                item.get("text", "") for item in result_content 
                                if isinstance(item, dict) and item.get("type") == "text"
                            ])
                            tool_results.append(f"[Tool execution completed for {tool_use_id}]: {result_text}")
                    elif block.get("type") == "text":
                        text_parts.append(block.get("text", ""))
            
            if tool_results:
                current_content = "\n".join(tool_results)
                if text_parts:
                    current_content += "\n" + "".join(text_parts)
    
    elif current_message.role == "assistant":
        # 如果最后一条消息是助手消息且包含 tool_use
        if isinstance(current_message.content, list):
            tool_descriptions = []
            for block in current_message.content:
                if isinstance(block, dict) and block.get("type") == "tool_use":
                    func_name = block.get("name", "unknown")
                    tool_descriptions.append(f"Continue after calling {func_name}")
            if tool_descriptions:
                current_content = "; ".join(tool_descriptions)
            else:
                current_content = "Continue the conversation"
        else:
            current_content = "Continue the conversation"
    
    # 确保当前消息有内容
    if not current_content:
        current_content = "Continue"
    
    # 添加 system prompt 到当前消息 - 与 OpenAI 格式一致
    if system_prompt:
        current_content = f"{system_prompt}\n\n{current_content}"
    
    # 构建请求 - 与 OpenAI 格式完全一致
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
    
    # 添加工具上下文 - 与 OpenAI 格式一致
    user_input_message_context = {}
    if request.tools:
        user_input_message_context["tools"] = [
            {
                "toolSpecification": {
                    "name": tool.name,
                    "description": tool.description or "",
                    "inputSchema": {"json": tool.input_schema or {}}
                }
            } for tool in request.tools
        ]
    
    # 添加图片 - 与 OpenAI 格式一致
    if images:
        codewhisperer_request["conversationState"]["currentMessage"]["userInputMessage"]["images"] = images
        logger.info(f"📊 添加了 {len(images)} 个图片到 userInputMessage 中")
        for idx, img in enumerate(images):
            logger.info(f"  - 图片 {idx+1}: 格式={img['format']}, 大小={len(img['source']['bytes'])} 字符")
            logger.info(f"  - 图片数据前20字符: {img['source']['bytes'][:20]}...")
        logger.info(f"✅ 成功添加 images 到 userInputMessage 中")
    
    if user_input_message_context:
        codewhisperer_request["conversationState"]["currentMessage"]["userInputMessage"]["userInputMessageContext"] = user_input_message_context
        logger.info(f"✅ 成功添加 userInputMessageContext 到请求中")
    
    # 创建日志请求副本
    log_request = copy.deepcopy(codewhisperer_request)
    if "images" in log_request.get("conversationState", {}).get("currentMessage", {}).get("userInputMessage", {}):
        for img in log_request["conversationState"]["currentMessage"]["userInputMessage"]["images"]:
            if "bytes" in img.get("source", {}):
                img["source"]["bytes"] = img["source"]["bytes"][:20] + "..."
    
    logger.info(f"🔄 COMPLETE CODEWHISPERER REQUEST: {json.dumps(log_request, indent=2)}")
    return codewhisperer_request
