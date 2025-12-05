"""
Pydantic models for OpenAI API compatibility
"""
import time
import uuid
import logging
from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any, Union

logger = logging.getLogger(__name__)


class ImageUrl(BaseModel):
    url: str
    detail: Optional[str] = "auto"


class ContentPart(BaseModel):
    type: str
    text: Optional[str] = None
    image_url: Optional[ImageUrl] = None


class ToolCall(BaseModel):
    id: str
    type: str = "function"
    function: Dict[str, Any]


class ChatMessage(BaseModel):
    role: str
    content: Union[str, List[ContentPart], None]
    tool_calls: Optional[List[ToolCall]] = None
    tool_call_id: Optional[str] = None  # 用于 tool 角色的消息
    
    def get_content_text(self) -> str:
        """Extract text content from either string or content parts"""
        # Handle None content
        if self.content is None:
            logger.warning(f"Message with role '{self.role}' has None content")
            return ""
            
        if isinstance(self.content, str):
            return self.content
        elif isinstance(self.content, list):
            text_parts = []
            for part in self.content:
                if isinstance(part, dict):
                    if part.get("type") == "text" and "text" in part:
                        text_parts.append(part.get("text", ""))
                    elif part.get("type") == "tool_result" and "content" in part:
                        text_parts.append(part.get("content", ""))
                elif hasattr(part, 'text') and part.text:
                    text_parts.append(part.text)
            return "".join(text_parts)
        else:
            logger.warning(f"Unexpected content type: {type(self.content)}")
            return str(self.content) if self.content else ""


class Function(BaseModel):
    name: str
    description: Optional[str] = None
    parameters: Optional[Dict[str, Any]] = None


class Tool(BaseModel):
    type: str = "function"
    function: Function


class ChatCompletionRequest(BaseModel):
    model: str
    messages: List[ChatMessage]
    temperature: Optional[float] = 0.7
    max_tokens: Optional[int] = 4000
    stream: Optional[bool] = False
    top_p: Optional[float] = 1.0
    frequency_penalty: Optional[float] = 0.0
    presence_penalty: Optional[float] = 0.0
    stop: Optional[Union[str, List[str]]] = None
    user: Optional[str] = None
    tools: Optional[List[Tool]] = None
    tool_choice: Optional[Union[str, Dict[str, Any]]] = "auto"


class Usage(BaseModel):
    prompt_tokens: int
    completion_tokens: int
    total_tokens: int
    prompt_tokens_details: Optional[Dict[str, int]] = Field(default_factory=lambda: {"cached_tokens": 0})
    completion_tokens_details: Optional[Dict[str, int]] = Field(default_factory=lambda: {"reasoning_tokens": 0})


class ResponseMessage(BaseModel):
    role: str
    content: Optional[str] = None
    tool_calls: Optional[List[ToolCall]] = None


class Choice(BaseModel):
    index: int
    message: ResponseMessage
    logprobs: Optional[Any] = None
    finish_reason: str


class StreamChoice(BaseModel):
    index: int
    delta: Dict[str, Any]
    logprobs: Optional[Any] = None
    finish_reason: Optional[str] = None


class ChatCompletionResponse(BaseModel):
    id: str = Field(default_factory=lambda: f"chatcmpl-{uuid.uuid4()}")
    object: str = "chat.completion"
    created: int = Field(default_factory=lambda: int(time.time()))
    model: str
    system_fingerprint: Optional[str] = "fp_ki2api_v3"
    choices: List[Choice]
    usage: Usage


class ChatCompletionStreamResponse(BaseModel):
    id: str = Field(default_factory=lambda: f"chatcmpl-{uuid.uuid4()}")
    object: str = "chat.completion.chunk"
    created: int = Field(default_factory=lambda: int(time.time()))
    model: str
    system_fingerprint: Optional[str] = "fp_ki2api_v3"
    choices: List[StreamChoice]
    usage: Optional[Usage] = None


class ErrorResponse(BaseModel):
    error: Dict[str, Any]

