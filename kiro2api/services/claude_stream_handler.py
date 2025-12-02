"""
Claude SSE 流处理器
将 CodeWhisperer 响应转换为 Claude API 格式的 SSE 事件
参考 amazonq2api/src/proxy/stream-handler.ts 和 parser.ts 实现
"""

import json
import uuid
import logging
from typing import List, Dict, Any, Optional, Generator, AsyncGenerator

from parsers.stream_parser import CodeWhispererStreamParser
from models.claude_schemas import ClaudeRequest

logger = logging.getLogger(__name__)


def build_claude_sse_event(event_type: str, data: Dict[str, Any]) -> str:
    """构建 Claude SSE 格式的事件"""
    json_data = json.dumps(data)
    return f"event: {event_type}\ndata: {json_data}\n\n"


def build_claude_message_start_event(
    conversation_id: str,
    model: str = "claude-sonnet-4.5",
    input_tokens: int = 0
) -> str:
    """构建 message_start 事件"""
    data = {
        "type": "message_start",
        "message": {
            "id": conversation_id,
            "type": "message",
            "role": "assistant",
            "content": [],
            "model": model,
            "stop_reason": None,
            "stop_sequence": None,
            "usage": {"input_tokens": input_tokens, "output_tokens": 0}
        }
    }
    return build_claude_sse_event("message_start", data)


def build_claude_content_block_start_event(index: int) -> str:
    """构建 content_block_start 事件（文本类型）"""
    data = {
        "type": "content_block_start",
        "index": index,
        "content_block": {"type": "text", "text": ""}
    }
    return build_claude_sse_event("content_block_start", data)


def build_claude_content_block_delta_event(index: int, text: str) -> str:
    """构建 content_block_delta 事件"""
    data = {
        "type": "content_block_delta",
        "index": index,
        "delta": {"type": "text_delta", "text": text}
    }
    return build_claude_sse_event("content_block_delta", data)


def build_claude_content_block_stop_event(index: int) -> str:
    """构建 content_block_stop 事件"""
    data = {
        "type": "content_block_stop",
        "index": index
    }
    return build_claude_sse_event("content_block_stop", data)


def build_claude_ping_event() -> str:
    """构建 ping 事件"""
    data = {"type": "ping"}
    return build_claude_sse_event("ping", data)


def build_claude_message_stop_event(
    input_tokens: int,
    output_tokens: int,
    stop_reason: str = "end_turn"
) -> str:
    """构建 message_delta 和 message_stop 事件"""
    # 先发送 message_delta
    delta_data = {
        "type": "message_delta",
        "delta": {"stop_reason": stop_reason, "stop_sequence": None},
        "usage": {"input_tokens": input_tokens, "output_tokens": output_tokens}
    }
    delta_event = build_claude_sse_event("message_delta", delta_data)
    
    # 再发送 message_stop
    stop_data = {
        "type": "message_stop",
        "stop_reason": stop_reason,
        "usage": {"input_tokens": input_tokens, "output_tokens": output_tokens}
    }
    stop_event = build_claude_sse_event("message_stop", stop_data)
    
    return delta_event + stop_event


def build_claude_tool_use_start_event(index: int, tool_use_id: str, tool_name: str) -> str:
    """构建 tool use 类型的 content_block_start 事件"""
    data = {
        "type": "content_block_start",
        "index": index,
        "content_block": {
            "type": "tool_use",
            "id": tool_use_id,
            "name": tool_name
        }
    }
    return build_claude_sse_event("content_block_start", data)


def build_claude_tool_use_input_delta_event(index: int, input_json_delta: str) -> str:
    """构建 tool use input 内容的 content_block_delta 事件"""
    data = {
        "type": "content_block_delta",
        "index": index,
        "delta": {
            "type": "input_json_delta",
            "partial_json": input_json_delta
        }
    }
    return build_claude_sse_event("content_block_delta", data)


def count_tokens(text: str) -> int:
    """计算文本的 token 数量（简化估算）"""
    if not text:
        return 0
    # 简化估算：平均每 4 个字符约等于 1 个 token
    return max(1, len(text) // 4)


def estimate_input_tokens(request_data: ClaudeRequest) -> int:
    """估算输入 token 数量"""
    try:
        text_parts = []
        
        # 统计 system prompt
        if request_data.system:
            if isinstance(request_data.system, str):
                text_parts.append(request_data.system)
            elif isinstance(request_data.system, list):
                for block in request_data.system:
                    if hasattr(block, "type") and block.type == "text":
                        text_parts.append(block.text)
        
        # 统计所有消息内容
        for msg in request_data.messages:
            content = msg.content
            if isinstance(content, str):
                text_parts.append(content)
            elif isinstance(content, list):
                for block in content:
                    if isinstance(block, dict):
                        if block.get("type") == "text":
                            text_parts.append(block.get("text", ""))
                        elif block.get("type") == "tool_use":
                            text_parts.append(block.get("name", ""))
                            text_parts.append(json.dumps(block.get("input", {})))
                        elif block.get("type") == "tool_result":
                            result_content = block.get("content", "")
                            if isinstance(result_content, str):
                                text_parts.append(result_content)
                            elif isinstance(result_content, list):
                                for item in result_content:
                                    if isinstance(item, dict) and item.get("type") == "text":
                                        text_parts.append(item.get("text", ""))
        
        # 统计 tools 定义
        if request_data.tools:
            for tool in request_data.tools:
                text_parts.append(tool.name)
                text_parts.append(tool.description)
                text_parts.append(json.dumps(tool.input_schema))
        
        full_text = "\n".join(text_parts)
        return count_tokens(full_text)
    except Exception as e:
        logger.warning(f"估算输入 token 失败: {e}")
        return 0


class ClaudeStreamHandler:
    """
    Claude API 流处理器
    将 CodeWhisperer 响应转换为 Claude 格式的 SSE 事件
    """
    
    def __init__(self, model: str = "claude-sonnet-4.5", request_data: Optional[ClaudeRequest] = None):
        self.model = model
        self.parser = CodeWhispererStreamParser()
        
        # 响应文本累积缓冲区
        self.response_buffer: List[str] = []
        
        # 内容块索引
        self.content_block_index = -1
        
        # 状态标志
        self.content_block_started = False
        self.content_block_start_sent = False
        self.content_block_stop_sent = False
        self.message_start_sent = False
        
        # 对话 ID
        self.conversation_id: Optional[str] = None
        
        # Tool use 相关状态
        self.current_tool_use: Optional[Dict[str, str]] = None
        self.tool_input_buffer: List[str] = []
        self.processed_tool_use_ids: set = set()
        self.all_tool_inputs: List[str] = []
        
        # 估算输入 token 数量
        if request_data:
            # 检测是否是小模型请求
            model_lower = request_data.model.lower()
            if "haiku" in model_lower:
                self.input_tokens = 0
            else:
                self.input_tokens = estimate_input_tokens(request_data)
        else:
            self.input_tokens = 0
    
    def handle_chunk(self, chunk: bytes) -> Generator[str, None, None]:
        """处理数据块并返回 Claude 格式的事件"""
        messages = self.parser.parse(chunk)
        
        for message in messages:
            yield from self._process_event(message)
    
    def _process_event(self, event: Dict[str, Any]) -> Generator[str, None, None]:
        """处理单个事件"""
        # 检测事件类型
        if "conversationId" in event:
            # initial-response 事件
            self.conversation_id = event.get("conversationId", str(uuid.uuid4()))
            
            if not self.message_start_sent:
                yield build_claude_message_start_event(
                    self.conversation_id,
                    self.model,
                    self.input_tokens
                )
                self.message_start_sent = True
                yield build_claude_ping_event()
        
        elif "content" in event:
            # assistantResponseEvent 文本事件
            content = event.get("content", "")
            
            # 如果之前有 tool use 块未关闭，先关闭它
            if self.current_tool_use and not self.content_block_stop_sent:
                yield build_claude_content_block_stop_event(self.content_block_index)
                self.content_block_stop_sent = True
                self.current_tool_use = None
            
            # 首次收到内容时，发送 content_block_start
            if not self.content_block_start_sent:
                self.content_block_index += 1
                yield build_claude_content_block_start_event(self.content_block_index)
                self.content_block_start_sent = True
                self.content_block_started = True
            
            # 发送内容增量
            if content:
                self.response_buffer.append(content)
                yield build_claude_content_block_delta_event(self.content_block_index, content)
        
        elif "toolUses" in event:
            # assistantResponseEvent 结束，包含 toolUses
            logger.info(f"收到助手响应结束事件，toolUses数量: {len(event.get('toolUses', []))}")
            
            # 检查是否需要发送 content_block_stop
            if self.content_block_started and not self.content_block_stop_sent:
                yield build_claude_content_block_stop_event(self.content_block_index)
                self.content_block_stop_sent = True
        
        elif "toolUseId" in event or "name" in event:
            # toolUseEvent 事件
            yield from self._handle_tool_use_event(event)
    
    def _handle_tool_use_event(self, event: Dict[str, Any]) -> Generator[str, None, None]:
        """处理 tool use 事件"""
        tool_use_id = event.get("toolUseId")
        tool_name = event.get("name")
        tool_input = event.get("input")
        is_stop = event.get("stop", False)
        
        logger.debug(f"Tool use 事件 - ID: {tool_use_id}, Name: {tool_name}, Stop: {is_stop}")
        
        # 如果是新 tool use 事件的开始
        if tool_use_id and tool_name and not self.current_tool_use:
            logger.info(f"开始新的 tool use: {tool_name} (ID: {tool_use_id})")
            
            # 如果之前有文本块未关闭，先关闭它
            if self.content_block_start_sent and not self.content_block_stop_sent:
                yield build_claude_content_block_stop_event(self.content_block_index)
                self.content_block_stop_sent = True
            
            # 记录这个 tool_use_id 为已处理
            self.processed_tool_use_ids.add(tool_use_id)
            
            # 内容块索引递增
            self.content_block_index += 1
            
            # 发送 content_block_start (tool_use type)
            yield build_claude_tool_use_start_event(self.content_block_index, tool_use_id, tool_name)
            
            self.content_block_started = True
            self.current_tool_use = {"toolUseId": tool_use_id, "name": tool_name}
            self.tool_input_buffer = []
        
        # 累积 input 片段
        if self.current_tool_use and tool_input is not None:
            if isinstance(tool_input, str):
                input_fragment = tool_input
            elif isinstance(tool_input, dict):
                input_fragment = json.dumps(tool_input)
            else:
                input_fragment = str(tool_input)
            
            self.tool_input_buffer.append(input_fragment)
            yield build_claude_tool_use_input_delta_event(self.content_block_index, input_fragment)
        
        # 如果是 stop 事件，发送 content_block_stop
        if is_stop and self.current_tool_use:
            full_input = "".join(self.tool_input_buffer)
            logger.info(f"完成 tool use: {self.current_tool_use.get('name')} (ID: {self.current_tool_use.get('toolUseId')})")
            
            # 保存完整的 tool input 用于 token 统计
            self.all_tool_inputs.append(full_input)
            
            yield build_claude_content_block_stop_event(self.content_block_index)
            
            # 重置状态
            self.content_block_stop_sent = False
            self.content_block_started = False
            self.content_block_start_sent = False
            self.current_tool_use = None
            self.tool_input_buffer = []
    
    def finalize(self) -> Generator[str, None, None]:
        """流结束时的收尾处理"""
        # 只有当 content_block_started 且尚未发送 content_block_stop 时才发送
        if self.content_block_started and not self.content_block_stop_sent:
            yield build_claude_content_block_stop_event(self.content_block_index)
            self.content_block_stop_sent = True
        
        # 计算 output token 数量
        full_text_response = "".join(self.response_buffer)
        full_tool_inputs = "".join(self.all_tool_inputs)
        output_tokens = count_tokens(full_text_response + full_tool_inputs)
        
        logger.info(
            f"Token 统计 - 输入: {self.input_tokens}, 输出: {output_tokens} "
            f"(文本: {len(full_text_response)} 字符, tool inputs: {len(full_tool_inputs)} 字符)"
        )
        
        yield build_claude_message_stop_event(self.input_tokens, output_tokens, "end_turn")


async def handle_claude_stream(
    response_body: bytes,
    model: str = "claude-sonnet-4.5",
    request_data: Optional[ClaudeRequest] = None
) -> AsyncGenerator[str, None]:
    """
    处理 CodeWhisperer 响应并生成 Claude 格式的 SSE 事件
    用于非流式响应的处理
    """
    handler = ClaudeStreamHandler(model, request_data)
    
    # 处理响应体
    for event in handler.handle_chunk(response_body):
        yield event
    
    # 发送收尾事件
    for event in handler.finalize():
        yield event

