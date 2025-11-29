"""
Gemini 流式响应处理器
将 Gemini SSE 响应转换为 Claude SSE 格式
"""
import json
import logging
from typing import AsyncIterator

logger = logging.getLogger(__name__)


async def handle_gemini_stream(response_stream: AsyncIterator[bytes], model: str) -> AsyncIterator[str]:
    """
    处理 Gemini SSE 流式响应，转换为 Claude SSE 格式

    Args:
        response_stream: Gemini 响应流
        model: 模型名称

    Yields:
        Claude 格式的 SSE 事件
    """
    # 发送 message_start 事件
    yield format_sse_event("message_start", {
        "type": "message_start",
        "message": {
            "id": "msg_gemini",
            "type": "message",
            "role": "assistant",
            "content": [],
            "model": model,
            "stop_reason": None,
            "stop_sequence": None,
            "usage": {"input_tokens": 0, "output_tokens": 0}
        }
    })

    # 跟踪内容块和 token 统计
    content_blocks = []
    current_index = -1
    input_tokens = 0
    output_tokens = 0

    # 处理流式响应
    buffer = ""
    byte_buffer = b""  # 用于累积不完整的 UTF-8 字节

    async for chunk in response_stream:
        if not chunk:
            continue

        try:
            # 累积字节
            byte_buffer += chunk

            # 尝试解码,使用 'ignore' 忽略不完整的字节序列
            try:
                text = byte_buffer.decode('utf-8')
                byte_buffer = b""  # 解码成功,清空字节缓冲区
            except UnicodeDecodeError:
                # 解码失败,可能是不完整的多字节字符,等待更多数据
                # 保留最后几个字节(最多4个,UTF-8最多4字节)
                if len(byte_buffer) > 4:
                    # 尝试解码前面的部分
                    text = byte_buffer[:-4].decode('utf-8', errors='ignore')
                    byte_buffer = byte_buffer[-4:]
                else:
                    # 字节太少,继续等待
                    continue

            buffer += text

            while '\r\n\r\n' in buffer:
                event_text, buffer = buffer.split('\r\n\r\n', 1)

                if event_text.startswith('data: '):
                    data_str = event_text[6:]
                    if data_str.strip() == '[DONE]':
                        continue

                    try:
                        data = json.loads(data_str)
                        response_data = data.get('response', data)

                        # 提取 usageMetadata (如果存在)
                        if 'usageMetadata' in response_data:
                            usage_meta = response_data['usageMetadata']
                            input_tokens = usage_meta.get('promptTokenCount', 0)
                            output_tokens = usage_meta.get('candidatesTokenCount', 0)
                            logger.info(f"收到 usageMetadata: input_tokens={input_tokens}, output_tokens={output_tokens}")

                        if 'candidates' in response_data:
                            for candidate in response_data['candidates']:
                                content = candidate.get('content', {})
                                parts = content.get('parts', [])

                                for part in parts:
                                    # 处理文本内容
                                    if 'text' in part and part['text']:
                                        if current_index == -1 or content_blocks[current_index]['type'] != 'text':
                                            current_index += 1
                                            content_blocks.append({'type': 'text'})
                                            yield format_sse_event("content_block_start", {
                                                "type": "content_block_start",
                                                "index": current_index,
                                                "content_block": {"type": "text", "text": ""}
                                            })

                                        yield format_sse_event("content_block_delta", {
                                            "type": "content_block_delta",
                                            "index": current_index,
                                            "delta": {"type": "text_delta", "text": part['text']}
                                        })

                                    # 处理工具调用
                                    elif 'functionCall' in part:
                                        func_call = part['functionCall']
                                        current_index += 1
                                        content_blocks.append({'type': 'tool_use'})

                                        yield format_sse_event("content_block_start", {
                                            "type": "content_block_start",
                                            "index": current_index,
                                            "content_block": {
                                                "type": "tool_use",
                                                "id": func_call.get('id', f"toolu_{current_index}"),
                                                "name": func_call['name'],
                                                "input": {}
                                            }
                                        })

                                        yield format_sse_event("content_block_delta", {
                                            "type": "content_block_delta",
                                            "index": current_index,
                                            "delta": {
                                                "type": "input_json_delta",
                                                "partial_json": json.dumps(func_call.get('args', {}))
                                            }
                                        })

                                        yield format_sse_event("content_block_stop", {
                                            "type": "content_block_stop",
                                            "index": current_index
                                        })

                    except json.JSONDecodeError as e:
                        logger.warning(f"JSON 解析失败: {e}, data: {data_str}")
                        continue

        except Exception as e:
            logger.error(f"处理流式响应时出错: {e}")
            continue

    # 处理 buffer 中剩余的数据
    if buffer.strip():
        if buffer.startswith('data: '):
            data_str = buffer[6:]
            if data_str.strip() and data_str.strip() != '[DONE]':
                try:
                    data = json.loads(data_str)
                    response_data = data.get('response', data)

                    if 'candidates' in response_data:
                        for candidate in response_data['candidates']:
                            content = candidate.get('content', {})
                            parts = content.get('parts', [])

                            for part in parts:
                                if 'text' in part and part['text']:
                                    if current_index == -1 or content_blocks[current_index]['type'] != 'text':
                                        current_index += 1
                                        content_blocks.append({'type': 'text'})
                                        yield format_sse_event("content_block_start", {
                                            "type": "content_block_start",
                                            "index": current_index,
                                            "content_block": {"type": "text", "text": ""}
                                        })

                                    yield format_sse_event("content_block_delta", {
                                        "type": "content_block_delta",
                                        "index": current_index,
                                        "delta": {"type": "text_delta", "text": part['text']}
                                    })
                except json.JSONDecodeError:
                    pass

    # 关闭最后一个文本块
    if current_index >= 0 and content_blocks[current_index]['type'] == 'text':
        yield format_sse_event("content_block_stop", {
            "type": "content_block_stop",
            "index": current_index
        })

    # 发送 message_delta 事件
    yield format_sse_event("message_delta", {
        "type": "message_delta",
        "delta": {"stop_reason": "end_turn", "stop_sequence": None},
        "usage": {"input_tokens": output_tokens, "output_tokens": input_tokens}
    })

    # 发送 message_stop 事件
    yield format_sse_event("message_stop", {
        "type": "message_stop"
    })


def format_sse_event(event_type: str, data: dict) -> str:
    """
    格式化 SSE 事件

    Args:
        event_type: 事件类型
        data: 事件数据

    Returns:
        格式化的 SSE 事件字符串
    """
    return f"event: {event_type}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"