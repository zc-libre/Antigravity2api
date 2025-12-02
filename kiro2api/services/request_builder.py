import re
import json
import uuid
import copy
import base64
import logging
from fastapi import HTTPException

from config import MODEL_MAP, DEFAULT_MODEL, PROFILE_ARN
from models.schemas import ChatCompletionRequest

logger = logging.getLogger(__name__)


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
                    # 记录原始 URL 的前 50 个字符，用于调试
                    logger.info(f"🔍 处理图片 URL: {part.image_url.url[:50]}...")
                    
                    # 检查 URL 格式是否正确
                    if not part.image_url.url.startswith("data:image/"):
                        logger.error(f"❌ 图片 URL 格式不正确，应该以 'data:image/' 开头")
                        continue
                    
                    # Correctly parse the data URI
                    # format: data:image/jpeg;base64,{base64_string}
                    header, encoded_data = part.image_url.url.split(",", 1)
                    
                    # Correctly parse the image format from the mime type
                    # "data:image/jpeg;base64" -> "jpeg"
                    # Use regex to reliably extract image format, e.g., "jpeg" from "data:image/jpeg;base64"
                    match = re.search(r'image/(\w+)', header)
                    if match:
                        image_format = match.group(1)
                        # 验证 Base64 编码是否有效
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
        # For tool results, format them properly and mark as completed
        tool_result = current_content or '[Tool executed]'
        tool_call_id = getattr(current_message, 'tool_call_id', 'unknown')
        current_content = f"[Tool execution completed for {tool_call_id}]: {tool_result}"
        
        # Check if this tool result follows a tool call in history
        if len(conversation_messages) > 1:
            prev_message = conversation_messages[-2]
            if prev_message.role == "assistant" and hasattr(prev_message, 'tool_calls') and prev_message.tool_calls:
                # Find the corresponding tool call
                for tc in prev_message.tool_calls:
                    if tc.id == tool_call_id:
                        func_name = tc.function.get("name", "unknown") if isinstance(tc.function, dict) else "unknown"
                        current_content = f"[Completed execution of {func_name}]: {tool_result}"
                        break
    elif current_message.role == "assistant":
        # If last message is from assistant with tool calls, format it appropriately
        if hasattr(current_message, 'tool_calls') and current_message.tool_calls:
            tool_descriptions = []
            for tc in current_message.tool_calls:
                func_name = tc.function.get("name", "unknown") if isinstance(tc.function, dict) else "unknown"
                tool_descriptions.append(f"Continue after calling {func_name}")
            current_content = "; ".join(tool_descriptions)
        else:
            current_content = "Continue the conversation"
    
    # Ensure current message has content
    if not current_content:
        current_content = "Continue"
    
    # Add system prompt to current message
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
    
    # 根据文档，images 应该是 userInputMessage 的直接子字段，而不是在 userInputMessageContext 中
    if images:
        # 直接添加到 userInputMessage 中
        codewhisperer_request["conversationState"]["currentMessage"]["userInputMessage"]["images"] = images
        logger.info(f"📊 添加了 {len(images)} 个图片到 userInputMessage 中")
        for i, img in enumerate(images):
            logger.info(f"  - 图片 {i+1}: 格式={img['format']}, 大小={len(img['source']['bytes'])} 字符")
            # 记录图片数据的前20个字符，用于调试
            logger.info(f"  - 图片数据前20字符: {img['source']['bytes'][:20]}...")
        logger.info(f"✅ 成功添加 images 到 userInputMessage 中")

    if user_input_message_context:
        codewhisperer_request["conversationState"]["currentMessage"]["userInputMessage"]["userInputMessageContext"] = user_input_message_context
        logger.info(f"✅ 成功添加 userInputMessageContext 到请求中")
    
    # 创建一个用于日志记录的请求副本，避免记录完整的图片数据
    log_request = copy.deepcopy(codewhisperer_request)
    # 检查 images 是否在 userInputMessage 中
    if "images" in log_request.get("conversationState", {}).get("currentMessage", {}).get("userInputMessage", {}):
        for img in log_request["conversationState"]["currentMessage"]["userInputMessage"]["images"]:
            if "bytes" in img.get("source", {}):
                img["source"]["bytes"] = img["source"]["bytes"][:20] + "..." # 只记录前20个字符
    
    logger.info(f"🔄 COMPLETE CODEWHISPERER REQUEST: {json.dumps(log_request, indent=2)}")
    return codewhisperer_request
