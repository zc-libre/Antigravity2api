"""
Claude API 数据结构定义
参考 amazonq2api 模块的实现
"""

import time
import uuid
from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any, Union


# ============================================================================
# Claude API 请求数据结构
# ============================================================================

class ClaudeTextContent(BaseModel):
    """Claude 文本内容块"""
    type: str = "text"
    text: str


class ClaudeImageSource(BaseModel):
    """Claude 图片来源"""
    type: str = "base64"
    media_type: str
    data: str


class ClaudeImageContent(BaseModel):
    """Claude 图片内容块"""
    type: str = "image"
    source: ClaudeImageSource


class ClaudeToolUseContent(BaseModel):
    """Claude Tool Use 内容块"""
    type: str = "tool_use"
    id: str
    name: str
    input: Dict[str, Any]


class ClaudeToolResultContent(BaseModel):
    """Claude Tool Result 内容块"""
    type: str = "tool_result"
    tool_use_id: str
    content: Union[str, List[Dict[str, Any]]]
    status: Optional[str] = "success"


# Claude 内容块的联合类型
ClaudeContentBlock = Union[
    ClaudeTextContent, 
    ClaudeImageContent, 
    ClaudeToolUseContent, 
    ClaudeToolResultContent,
    Dict[str, Any]  # 兼容原始字典格式
]

# Claude 内容可以是字符串或内容块列表
ClaudeContent = Union[str, List[ClaudeContentBlock]]


class ClaudeMessage(BaseModel):
    """Claude 消息"""
    role: str  # "user" | "assistant"
    content: ClaudeContent


class ClaudeTool(BaseModel):
    """Claude 工具定义"""
    name: str
    description: str
    input_schema: Dict[str, Any]


class ClaudeSystemBlock(BaseModel):
    """Claude System Prompt 块"""
    type: str = "text"
    text: str


class ClaudeRequest(BaseModel):
    """Claude API 请求"""
    model: str
    messages: List[ClaudeMessage]
    max_tokens: Optional[int] = 4096
    temperature: Optional[float] = None
    tools: Optional[List[ClaudeTool]] = None
    stream: Optional[bool] = True
    system: Optional[Union[str, List[ClaudeSystemBlock]]] = None


# ============================================================================
# Claude API 响应数据结构
# ============================================================================

class ClaudeUsage(BaseModel):
    """Claude 使用统计"""
    input_tokens: int
    output_tokens: int


class ClaudeResponseContentBlock(BaseModel):
    """Claude 响应内容块"""
    type: str
    text: Optional[str] = None
    id: Optional[str] = None
    name: Optional[str] = None
    input: Optional[Dict[str, Any]] = None


class ClaudeResponse(BaseModel):
    """Claude API 非流式响应"""
    id: str = Field(default_factory=lambda: f"msg_{uuid.uuid4()}")
    type: str = "message"
    role: str = "assistant"
    content: List[ClaudeResponseContentBlock]
    model: str
    stop_reason: Optional[str] = "end_turn"
    stop_sequence: Optional[str] = None
    usage: ClaudeUsage


# ============================================================================
# Claude SSE 流式响应事件
# ============================================================================

class ClaudeMessageStartEvent(BaseModel):
    """message_start 事件"""
    type: str = "message_start"
    message: Dict[str, Any]


class ClaudeContentBlockStartEvent(BaseModel):
    """content_block_start 事件"""
    type: str = "content_block_start"
    index: int
    content_block: Dict[str, Any]


class ClaudeContentBlockDeltaEvent(BaseModel):
    """content_block_delta 事件"""
    type: str = "content_block_delta"
    index: int
    delta: Dict[str, Any]


class ClaudeContentBlockStopEvent(BaseModel):
    """content_block_stop 事件"""
    type: str = "content_block_stop"
    index: int


class ClaudeMessageDeltaEvent(BaseModel):
    """message_delta 事件"""
    type: str = "message_delta"
    delta: Dict[str, Any]
    usage: Dict[str, int]


class ClaudeMessageStopEvent(BaseModel):
    """message_stop 事件"""
    type: str = "message_stop"
    stop_reason: Optional[str] = "end_turn"
    usage: Dict[str, int]


class ClaudePingEvent(BaseModel):
    """ping 事件"""
    type: str = "ping"

