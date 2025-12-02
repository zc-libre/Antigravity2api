import re
import json
import uuid
import logging
from typing import Optional, List, Union
from json_repair import repair_json

from models.schemas import ToolCall

logger = logging.getLogger(__name__)


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


def deduplicate_tool_calls(tool_calls: List[Union[dict, ToolCall]]) -> List[ToolCall]:
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
