import os
import json
import time
import uuid
import httpx
import re
import asyncio
import xml.etree.ElementTree as ET
import logging
import struct
import base64
import copy
from fastapi import FastAPI, HTTPException, Request, Header, Depends
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any, Union
from dotenv import load_dotenv
from json_repair import repair_json

# Configure logging
logging.basicConfig(level=logging.INFO) # for dev
# logging.basicConfig(level=logging.WARNING) 
logger = logging.getLogger(__name__)

# Load environment variables
load_dotenv()

# Initialize FastAPI app
app = FastAPI(
    title="Ki2API - Claude Sonnet 4 OpenAI Compatible API",
    description="OpenAI-compatible API for Claude Sonnet 4 via AWS CodeWhisperer",
    version="3.0.1"
)

# Configuration
API_KEY = os.getenv("API_KEY", "ki2api-key-2024")
KIRO_ACCESS_TOKEN = os.getenv("KIRO_ACCESS_TOKEN")
KIRO_REFRESH_TOKEN = os.getenv("KIRO_REFRESH_TOKEN")
KIRO_BASE_URL = "https://codewhisperer.us-east-1.amazonaws.com/generateAssistantResponse"
PROFILE_ARN = "arn:aws:codewhisperer:us-east-1:699475941385:profile/EHGA3GRVQMUK"

# Model mapping
MODEL_MAP = {
    "claude-sonnet-4-5-20250929": "CLAUDE_SONNET_4_5_20250929_V1_0",
    "claude-3-5-haiku-20241022":  "auto",
    "claude-opus-4.5":"claude-opus-4.5"
}
DEFAULT_MODEL = "claude-sonnet-4-5-20250929"

# Pydantic models for OpenAI compatibility
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

# Authentication
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

# Token management
class TokenManager:
    def __init__(self):
        self.access_token = KIRO_ACCESS_TOKEN
        self.refresh_token = KIRO_REFRESH_TOKEN
        self.refresh_url = "https://prod.us-east-1.auth.desktop.kiro.dev/refreshToken"
        self.last_refresh_time = 0
        self.refresh_lock = asyncio.Lock()

    async def refresh_tokens(self):
        """刷新token，使用锁防止并发刷新请求"""
        if not self.refresh_token:
            logger.error("没有刷新token，无法刷新访问token")
            return None
        
        async with self.refresh_lock:
            # 检查是否在短时间内已经刷新过
            current_time = time.time()
            if current_time - self.last_refresh_time < 5:
                logger.info("最近已刷新token，使用现有token")
                return self.access_token
            
            try:
                logger.info("开始刷新token...")
                async with httpx.AsyncClient() as client:
                    response = await client.post(
                        self.refresh_url,
                        json={"refreshToken": self.refresh_token},
                        timeout=30
                    )
                    response.raise_for_status()
                    
                    data = response.json()
                    if "accessToken" not in data:
                        logger.error(f"刷新token响应中没有accessToken: {data}")
                        return None
                    
                    self.access_token = data.get("accessToken")
                    self.last_refresh_time = current_time
                    logger.info("token刷新成功")
                    
                    # 更新环境变量
                    os.environ["KIRO_ACCESS_TOKEN"] = self.access_token
                    
                    return self.access_token
            except Exception as e:
                logger.error(f"token刷新失败: {str(e)}")
                return None

    def get_token(self):
        return self.access_token

token_manager = TokenManager()

# XML Tool Call Parser (from version 1)
def parse_xml_tool_calls(response_text: str) -> Optional[List[ToolCall]]:
    """解析CodeWhisperer返回的XML格式工具调用，转换为OpenAI格式"""
    if not response_text:
        return None
    
    tool_calls = []
    
    logger.info(f"🔍 开始解析XML工具调用，响应文本长度: {len(response_text)}")
    
    # 方法1: 解析 <tool_use> 标签格式
    tool_use_pattern = r'<tool_use>\s*<tool_name>([^<]+)</tool_name>\s*<tool_parameter_name>([^<]+)</tool_parameter_name>\s*<tool_parameter_value>([^<]*)</tool_parameter_value>\s*</tool_use>'
    matches = re.finditer(tool_use_pattern, response_text, re.DOTALL | re.IGNORECASE)
    
    for match in matches:
        function_name = match.group(1).strip()
        param_name = match.group(2).strip()
        param_value = match.group(3).strip()
        
        arguments = {param_name: param_value}
        tool_call_id = f"call_{uuid.uuid4().hex[:8]}"
        
        tool_call = ToolCall(
            id=tool_call_id,
            type="function",
            function={
                "name": function_name,
                "arguments": json.dumps(arguments, ensure_ascii=False)
            }
        )
        tool_calls.append(tool_call)
        logger.info(f"✅ 解析到工具调用: {function_name} with {param_name}={param_value}")
    
    # 方法2: 解析简单的 <tool_name> 格式
    if not tool_calls:
        simple_pattern = r'<tool_name>([^<]+)</tool_name>\s*<tool_parameter_name>([^<]+)</tool_parameter_name>\s*<tool_parameter_value>([^<]*)</tool_parameter_value>'
        matches = re.finditer(simple_pattern, response_text, re.DOTALL | re.IGNORECASE)
        
        for match in matches:
            function_name = match.group(1).strip()
            param_name = match.group(2).strip()
            param_value = match.group(3).strip()
            
            arguments = {param_name: param_value}
            tool_call_id = f"call_{uuid.uuid4().hex[:8]}"
            
            tool_call = ToolCall(
                id=tool_call_id,
                type="function",
                function={
                    "name": function_name,
                    "arguments": json.dumps(arguments, ensure_ascii=False)
                }
            )
            tool_calls.append(tool_call)
            logger.info(f"✅ 解析到简单工具调用: {function_name} with {param_name}={param_value}")
    
    # 方法3: 解析只有工具名的情况
    if not tool_calls:
        name_only_pattern = r'<tool_name>([^<]+)</tool_name>'
        matches = re.finditer(name_only_pattern, response_text, re.IGNORECASE)
        
        for match in matches:
            function_name = match.group(1).strip()
            tool_call_id = f"call_{uuid.uuid4().hex[:8]}"
            
            tool_call = ToolCall(
                id=tool_call_id,
                type="function",
                function={
                    "name": function_name,
                    "arguments": "{}"
                }
            )
            tool_calls.append(tool_call)
            logger.info(f"✅ 解析到无参数工具调用: {function_name}")
    
    if tool_calls:
        logger.info(f"🎉 总共解析出 {len(tool_calls)} 个工具调用")
        return tool_calls
    else:
        logger.info("❌ 未发现任何XML格式的工具调用")
        return None

def find_matching_bracket(text: str, start_pos: int) -> int:
    """找到匹配的结束括号位置，正确处理嵌套括号和字符串内的括号"""
    if not text or start_pos >= len(text) or text[start_pos] != '[':
        return -1
    
    bracket_count = 1
    in_string = False
    escape_next = False
    
    for i in range(start_pos + 1, len(text)):
        char = text[i]
        
        if escape_next:
            escape_next = False
            continue
        
        if char == '\\' and in_string:
            escape_next = True
            continue
        
        if char == '"' and not escape_next:
            in_string = not in_string
            continue
        
        if not in_string:
            if char == '[':
                bracket_count += 1
            elif char == ']':
                bracket_count -= 1
                if bracket_count == 0:
                    return i
    
    return -1

def parse_single_tool_call_professional(tool_call_text: str) -> Optional[ToolCall]:
      """专业的工具调用解析器 - 使用json_repair库"""
      logger.info(f"🔧 开始解析工具调用文本 (长度: {len(tool_call_text)})")

      # 步骤1: 提取函数名
      name_pattern = r'\[Called\s+(\w+)\s+with\s+args:'
      name_match = re.search(name_pattern, tool_call_text, re.IGNORECASE)

      if not name_match:
          logger.warning("⚠️ 无法从文本中提取函数名")
          return None

      function_name = name_match.group(1).strip()
      logger.info(f"✅ 提取到函数名: {function_name}")

      # 步骤2: 提取JSON参数部分
      # 找到 "with args:" 之后的位置
      args_start_marker = "with args:"
      args_start_pos = tool_call_text.lower().find(args_start_marker.lower())
      if args_start_pos == -1:
          logger.error("❌ 找不到 'with args:' 标记")
          return None

      # 从 "with args:" 后开始
      args_start = args_start_pos + len(args_start_marker)

      # 找到最后的 ']'
      args_end = tool_call_text.rfind(']')
      if args_end <= args_start:
          logger.error("❌ 找不到结束的 ']'")
          return None

      # 提取可能包含JSON的部分
      json_candidate = tool_call_text[args_start:args_end].strip()
      logger.info(f"📝 提取的JSON候选文本长度: {len(json_candidate)}")

      # 步骤3: 修复并解析JSON
      try:
          # 使用json_repair修复可能损坏的JSON
          repaired_json = repair_json(json_candidate)
          logger.info(f"🔧 JSON修复完成，修复后长度: {len(repaired_json)}")

          # 解析修复后的JSON
          parsed_args = json.loads(repaired_json)
          logger.info(f"✅ JSON解析成功，类型: {type(parsed_args)}")

          # Handle both dictionary and list formats
          if isinstance(parsed_args, dict):
              # Original format: direct dictionary
              arguments = parsed_args
          elif isinstance(parsed_args, list) and len(parsed_args) > 0:
              # New format: list with arguments as first element
              if isinstance(parsed_args[0], dict):
                  arguments = parsed_args[0]
              else:
                  logger.error(f"❌ 列表格式中第一个元素不是字典: {type(parsed_args[0])}")
                  return None
          else:
              logger.error(f"❌ 解析结果格式不支持: {type(parsed_args)}")
              return None

          # 创建工具调用对象
          tool_call_id = f"call_{uuid.uuid4().hex[:8]}"
          tool_call = ToolCall(
              id=tool_call_id,
              type="function",
              function={
                  "name": function_name,
                  "arguments": json.dumps(arguments, ensure_ascii=False)
              }
          )

          logger.info(f"✅ 成功创建工具调用: {function_name} (参数键: {list(arguments.keys())})")
          return tool_call

      except Exception as e:
          logger.error(f"❌ JSON修复/解析失败: {type(e).__name__}: {str(e)}")

          # 备用方案：尝试更激进的修复
          try:
              # 查找第一个 { 和最后一个 }
              first_brace = json_candidate.find('{')
              last_brace = json_candidate.rfind('}')

              if first_brace != -1 and last_brace > first_brace:
                  core_json = json_candidate[first_brace:last_brace + 1]

                  # 再次尝试修复
                  repaired_core = repair_json(core_json)
                  parsed_args = json.loads(repaired_core)

                  # Handle both dictionary and list formats in backup method too
                  if isinstance(parsed_args, dict):
                      arguments = parsed_args
                  elif isinstance(parsed_args, list) and len(parsed_args) > 0 and isinstance(parsed_args[0], dict):
                      arguments = parsed_args[0]
                  else:
                      logger.error(f"❌ 备用方案解析结果格式不支持: {type(parsed_args)}")
                      return None

                  tool_call_id = f"call_{uuid.uuid4().hex[:8]}"
                  tool_call = ToolCall(
                      id=tool_call_id,
                      type="function",
                      function={
                          "name": function_name,
                          "arguments": json.dumps(arguments, ensure_ascii=False)
                      }
                  )
                  logger.info(f"✅ 备用方案成功: {function_name}")
                  return tool_call

          except Exception as backup_error:
              logger.error(f"❌ 备用方案也失败了: {backup_error}")

          return None

def parse_bracket_tool_calls_professional(response_text: str) -> Optional[List[ToolCall]]:
    """专业的批量工具调用解析器"""
    if not response_text or "[Called" not in response_text:
        logger.info("📭 响应文本中没有工具调用标记")
        return None
    
    tool_calls = []
    errors = []
    
    # 方法1: 使用改进的分割方法
    try:
        # 找到所有 [Called 的位置
        call_positions = []
        start = 0
        while True:
            pos = response_text.find("[Called", start)
            if pos == -1:
                break
            call_positions.append(pos)
            start = pos + 1
        
        logger.info(f"🔍 找到 {len(call_positions)} 个潜在的工具调用")
        
        for i, start_pos in enumerate(call_positions):
            # 确定这个工具调用的结束位置
            # 可能是下一个 [Called 的位置，或者文本结束
            if i + 1 < len(call_positions):
                end_search_limit = call_positions[i + 1]
            else:
                end_search_limit = len(response_text)
            
            # 在限定范围内查找结束的 ]
            segment = response_text[start_pos:end_search_limit]
            
            # 查找匹配的结束括号
            bracket_count = 0
            end_pos = -1
            
            for j, char in enumerate(segment):
                if char == '[':
                    bracket_count += 1
                elif char == ']':
                    bracket_count -= 1
                    if bracket_count == 0:
                        end_pos = start_pos + j
                        break
            
            if end_pos == -1:
                # 如果没找到匹配的括号，尝试找最后一个 ]
                last_bracket = segment.rfind(']')
                if last_bracket != -1:
                    end_pos = start_pos + last_bracket
                else:
                    logger.warning(f"⚠️ 工具调用 {i+1} 没有找到结束括号")
                    continue
            
            # 提取工具调用文本
            tool_call_text = response_text[start_pos:end_pos + 1]
            logger.info(f"📋 提取工具调用 {i+1}, 长度: {len(tool_call_text)}")
            
            # 解析单个工具调用
            parsed_call = parse_single_tool_call_professional(tool_call_text)
            if parsed_call:
                tool_calls.append(parsed_call)
            else:
                errors.append(f"工具调用 {i+1} 解析失败")
                
    except Exception as e:
        logger.error(f"❌ 批量解析过程出错: {type(e).__name__}: {str(e)}")
        import traceback
        traceback.print_exc()
    
    # 记录结果
    if tool_calls:
        logger.info(f"🎉 成功解析 {len(tool_calls)} 个工具调用")
        for tc in tool_calls:
            logger.info(f"  ✓ {tc.function['name']} (ID: {tc.id})")
    
    if errors:
        logger.warning(f"⚠️ 有 {len(errors)} 个解析失败:")
        for error in errors:
            logger.warning(f"  ✗ {error}")
    
    return tool_calls if tool_calls else None

# 为了确保兼容性，也更新原来的函数名
def parse_bracket_tool_calls(response_text: str) -> Optional[List[ToolCall]]:
    """向后兼容的函数名"""
    return parse_bracket_tool_calls_professional(response_text)

def parse_single_tool_call(tool_call_text: str) -> Optional[ToolCall]:
    """向后兼容的函数名"""
    return parse_single_tool_call_professional(tool_call_text)

# Add deduplication function
def deduplicate_tool_calls(tool_calls: List[Union[Dict, ToolCall]]) -> List[ToolCall]:
    """Deduplicate tool calls based on function name and arguments"""
    seen = set()
    unique_tool_calls = []
    
    for tool_call in tool_calls:
        # Convert to ToolCall if it's a dict
        if isinstance(tool_call, dict):
            tc = ToolCall(
                id=tool_call.get("id", f"call_{uuid.uuid4().hex[:8]}"),
                type=tool_call.get("type", "function"),
                function=tool_call.get("function", {})
            )
        else:
            tc = tool_call
        
        # Create unique key based on function name and arguments
        key = (
            tc.function.get("name", ""),
            tc.function.get("arguments", "")
        )
        
        if key not in seen:
            seen.add(key)
            unique_tool_calls.append(tc)
        else:
            logger.info(f"🔄 Skipping duplicate tool call: {tc.function.get('name', 'unknown')}")
    
    return unique_tool_calls

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
# AWS Event Stream Parser (from version 2)
class CodeWhispererStreamParser:
    def __init__(self):
        self.buffer = b''
        self.error_count = 0
        self.max_errors = 5

    def parse(self, chunk: bytes) -> List[Dict[str, Any]]:
        """解析AWS事件流格式的数据块"""
        self.buffer += chunk
        logger.debug(f"Parser received {len(chunk)} bytes. Buffer size: {len(self.buffer)}")
        events = []
        
        if len(self.buffer) < 12:
            return []
            
        while len(self.buffer) >= 12:
            try:
                header_bytes = self.buffer[0:8]
                total_len, header_len = struct.unpack('>II', header_bytes)
                
                # 安全检查
                if total_len > 2000000 or header_len > 2000000:
                    logger.error(f"Unreasonable header values: total_len={total_len}, header_len={header_len}")
                    self.buffer = self.buffer[8:]
                    self.error_count += 1
                    if self.error_count > self.max_errors:
                        logger.error("Too many parsing errors, clearing buffer")
                        self.buffer = b''
                    continue

                # 等待完整帧
                if len(self.buffer) < total_len:
                    break

                # 提取完整帧
                frame = self.buffer[:total_len]
                self.buffer = self.buffer[total_len:]

                # 提取有效载荷
                payload_start = 8 + header_len
                payload_end = total_len - 4  # 减去尾部CRC
                
                if payload_start >= payload_end or payload_end > len(frame):
                    logger.error(f"Invalid payload bounds")
                    continue
                    
                payload = frame[payload_start:payload_end]
                
                # 解码有效载荷
                try:
                    payload_str = payload.decode('utf-8', errors='ignore')
                    
                    # 尝试解析JSON
                    json_start_index = payload_str.find('{')
                    if json_start_index != -1:
                        json_payload = payload_str[json_start_index:]
                        event_data = json.loads(json_payload)
                        events.append(event_data)
                        logger.debug(f"Successfully parsed event: {event_data}")
                except json.JSONDecodeError as e:
                    logger.error(f"JSON decode error: {e}")
                    continue

            except struct.error as e:
                logger.error(f"Struct unpack error: {e}")
                self.buffer = self.buffer[1:]
                self.error_count += 1
                if self.error_count > self.max_errors:
                    logger.error("Too many parsing errors, clearing buffer")
                    self.buffer = b''
            except Exception as e:
                logger.error(f"Unexpected error during parsing: {str(e)}")
                self.buffer = self.buffer[1:]
                self.error_count += 1
                if self.error_count > self.max_errors:
                    logger.error("Too many parsing errors, clearing buffer")
                    self.buffer = b''
        
        if events:
            self.error_count = 0
            
        return events

# Simple fallback parser for basic responses
class SimpleResponseParser:
    @staticmethod
    def parse_event_stream_to_json(raw_data: bytes) -> Dict[str, Any]:
        """Simple parser for fallback (from version 1)"""
        try:
            if isinstance(raw_data, bytes):
                raw_str = raw_data.decode('utf-8', errors='ignore')
            else:
                raw_str = str(raw_data)
            
            # Method 1: Look for JSON objects with content field
            json_pattern = r'\{[^{}]*"content"[^{}]*\}'
            matches = re.findall(json_pattern, raw_str, re.DOTALL)
            
            if matches:
                content_parts = []
                for match in matches:
                    try:
                        data = json.loads(match)
                        if 'content' in data and data['content']:
                            content_parts.append(data['content'])
                    except json.JSONDecodeError:
                        continue
                if content_parts:
                    full_content = ''.join(content_parts)
                    return {
                        "content": full_content, 
                        "tokens": len(full_content.split())
                    }
            
            # Method 2: Extract readable text
            clean_text = re.sub(r'[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]', '', raw_str)
            clean_text = re.sub(r':event-type[^:]*:[^:]*:[^:]*:', '', clean_text)
            clean_text = re.sub(r':content-type[^:]*:[^:]*:[^:]*:', '', clean_text)
            
            meaningful_text = re.sub(r'[^\w\s\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff.,!?;:()"\'-]', '', clean_text)
            meaningful_text = re.sub(r'\s+', ' ', meaningful_text).strip()
            
            if meaningful_text and len(meaningful_text) > 5:
                return {
                    "content": meaningful_text, 
                    "tokens": len(meaningful_text.split())
                }
            
            return {"content": "No readable content found", "tokens": 0}
            
        except Exception as e:
            return {"content": f"Error parsing response: {str(e)}", "tokens": 0}

# API call to CodeWhisperer
async def call_kiro_api(request: ChatCompletionRequest):
    """Make API call to Kiro/CodeWhisperer with token refresh handling"""
    token = token_manager.get_token()
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
        "Accept": "text/event-stream" if request.stream else "application/json"
    }

    try:
        async with httpx.AsyncClient() as client:
            response = await client.post(
                KIRO_BASE_URL,
                headers=headers,
                json=request_data,
                timeout=120
            )
            
            logger.info(f"📤 RESPONSE STATUS: {response.status_code}")
            
            if response.status_code == 403:
                logger.info("收到403响应，尝试刷新token...")
                new_token = await token_manager.refresh_tokens()
                if new_token:
                    headers["Authorization"] = f"Bearer {new_token}"
                    response = await client.post(
                        KIRO_BASE_URL,
                        headers=headers,
                        json=request_data,
                        timeout=120
                    )
                    logger.info(f"📤 RETRY RESPONSE STATUS: {response.status_code}")
                else:
                    raise HTTPException(status_code=401, detail="Token refresh failed")
            
            if response.status_code == 429:
                raise HTTPException(
                    status_code=429,
                    detail={
                        "error": {
                            "message": "Rate limit exceeded",
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

# Utility functions
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

# API endpoints
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

    # Validate messages have content
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

    # 根据请求类型调用相应的处理函数，实现真正的流式/非流式处理
    if request.stream:
        logger.info("🌊 使用真正的流式处理")
        return await create_streaming_response(request)
    else:
        logger.info("📄 使用非流式处理")
        return await create_non_streaming_response(request)


async def convert_to_streaming_response(response: ChatCompletionResponse):
    """
    [已废弃] 将非流式响应转换为流式格式返回
    此函数不再使用，因为现在直接使用 create_streaming_response 实现真正的流式处理
    """
    async def generate_stream():
        # 使用原响应的ID和时间戳
        response_id = response.id
        created = response.created
        model = response.model
        
        # 发送初始块 - role
        initial_chunk = ChatCompletionStreamResponse(
            id=response_id,
            model=model,
            created=created,
            choices=[StreamChoice(
                index=0,
                delta={"role": "assistant"},
                finish_reason=None
            )]
        )
        yield f"data: {initial_chunk.model_dump_json(exclude_none=True)}\n\n"
        
        # 获取响应消息
        if response.choices and len(response.choices) > 0:
            message = response.choices[0].message
            
            # 如果有工具调用，发送工具调用
            if message.tool_calls:
                for i, tool_call in enumerate(message.tool_calls):
                    # 发送完整的工具调用作为一个块
                    tool_chunk = ChatCompletionStreamResponse(
                        id=response_id,
                        model=model,
                        created=created,
                        choices=[StreamChoice(
                            index=0,
                            delta={
                                "tool_calls": [{
                                    "index": i,
                                    "id": tool_call.id,
                                    "type": tool_call.type,
                                    "function": tool_call.function
                                }]
                            },
                            finish_reason=None
                        )]
                    )
                    yield f"data: {tool_chunk.model_dump_json(exclude_none=True)}\n\n"
            
            # 如果有内容，分块发送内容
            elif message.content:
                # 将内容分成较小的块以模拟流式传输
                content = message.content
                chunk_size = 50  # 每个块的字符数
                
                for i in range(0, len(content), chunk_size):
                    chunk_text = content[i:i + chunk_size]
                    content_chunk = ChatCompletionStreamResponse(
                        id=response_id,
                        model=model,
                        created=created,
                        choices=[StreamChoice(
                            index=0,
                            delta={"content": chunk_text},
                            finish_reason=None
                        )]
                    )
                    yield f"data: {content_chunk.model_dump_json(exclude_none=True)}\n\n"
                    # 添加小延迟以模拟真实的流式传输
                    await asyncio.sleep(0.01)
            
            # 发送结束块
            finish_reason = response.choices[0].finish_reason
            end_chunk = ChatCompletionStreamResponse(
                id=response_id,
                model=model,
                created=created,
                choices=[StreamChoice(
                    index=0,
                    delta={},
                    finish_reason=finish_reason
                )]
            )
            yield f"data: {end_chunk.model_dump_json(exclude_none=True)}\n\n"
        
        # 发送流结束标记
        yield "data: [DONE]\n\n"
    
    return StreamingResponse(
        generate_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "Content-Type": "text/event-stream"
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

        # 准备请求
        token = token_manager.get_token()
        if not token:
            yield f"data: {json.dumps({'error': {'message': 'No access token available', 'type': 'authentication_error'}})}\n\n"
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
                                yield f"data: {json.dumps({'error': {'message': 'Token refresh failed', 'type': 'authentication_error'}})}\n\n"
                                return

                        if response.status_code == 429:
                            yield f"data: {json.dumps({'error': {'message': 'Rate limit exceeded', 'type': 'rate_limit_error'}})}\n\n"
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

                        # 流结束后处理剩余内容
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

@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {"status": "healthy", "service": "Ki2API", "version": "3.0.1"}

@app.get("/")
async def root():
    """Root endpoint with service information"""
    return {
        "service": "Ki2API",
        "description": "OpenAI-compatible API for Claude Sonnet 4 via AWS CodeWhisperer",
        "version": "3.0.1",
        "endpoints": {
            "models": "/v1/models",
            "chat": "/v1/chat/completions",
            "health": "/health"
        },
        "features": {
            "streaming": True,
            "tools": True,
            "multiple_models": True,
            "xml_tool_parsing": True,
            "auto_token_refresh": True,
            "null_content_handling": True,
            "tool_call_deduplication": True
        }
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8989)