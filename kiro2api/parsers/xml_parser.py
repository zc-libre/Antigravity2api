import re
import json
import uuid
import logging
from typing import Optional, List

from models.schemas import ToolCall

logger = logging.getLogger(__name__)


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
