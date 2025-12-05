"""
Parsers for CodeWhisperer responses and tool calls
"""
import re
import json
import uuid
import struct
import logging
from typing import List, Optional, Dict, Any, Union

from json_repair import repair_json

try:
    from .models import ToolCall
except ImportError:
    from models import ToolCall

logger = logging.getLogger(__name__)


# ============================================================================
# XML Tool Call Parser
# ============================================================================

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


# ============================================================================
# Bracket Format Tool Call Parser
# ============================================================================

def find_matching_bracket(text: str, start_pos: int) -> int:
    """找到匹配的结束括号位置"""
    logger.info(f"🔧 FIND BRACKET: text length={len(text)}, start_pos={start_pos}")
    logger.info(f"🔧 FIND BRACKET: First 100 chars: >>>{text[:100]}<<<")
    
    if not text or start_pos >= len(text) or text[start_pos] != '[':
        logger.info(f"🔧 FIND BRACKET: Early return -1, text[start_pos]={text[start_pos] if start_pos < len(text) else 'OOB'}")
        return -1
    
    bracket_count = 1
    in_string = False
    escape_next = False
    
    logger.info(f"🔧 FIND BRACKET: Starting search from position {start_pos + 1}")
    
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
            logger.info(f"🔧 FIND BRACKET: Toggle string mode at {i}, in_string={in_string}")
            continue
        
        if not in_string:
            if char == '[':
                bracket_count += 1
                logger.info(f"🔧 FIND BRACKET: [ at {i}, bracket_count={bracket_count}")
            elif char == ']':
                bracket_count -= 1
                logger.info(f"🔧 FIND BRACKET: ] at {i}, bracket_count={bracket_count}")
                if bracket_count == 0:  # 只检查方括号匹配，不管花括号
                    logger.info(f"🔧 FIND BRACKET: Found matching ] at position {i}")
                    logger.info(f"🔧 FIND BRACKET: Complete match: >>>{text[start_pos:i+1]}<<<")
                    return i
    
    logger.info(f"🔧 FIND BRACKET: No matching bracket found, returning -1")
    logger.info(f"🔧 FIND BRACKET: Final bracket_count={bracket_count}")
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


# 为了确保兼容性，保留原来的函数名
def parse_bracket_tool_calls(response_text: str) -> Optional[List[ToolCall]]:
    """向后兼容的函数名"""
    return parse_bracket_tool_calls_professional(response_text)


def parse_single_tool_call(tool_call_text: str) -> Optional[ToolCall]:
    """向后兼容的函数名"""
    return parse_single_tool_call_professional(tool_call_text)


# ============================================================================
# Tool Call Deduplication
# ============================================================================

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


# ============================================================================
# AWS Event Stream Parser
# ============================================================================

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


# ============================================================================
# Simple Fallback Parser
# ============================================================================

class SimpleResponseParser:
    @staticmethod
    def parse_event_stream_to_json(raw_data: bytes) -> Dict[str, Any]:
        """Simple parser for fallback"""
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

