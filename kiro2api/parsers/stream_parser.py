import re
import json
import struct
import logging
from typing import List, Dict, Any

logger = logging.getLogger(__name__)


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

    def flush(self) -> List[Dict[str, Any]]:
        """
        流结束时调用，尝试从残留 buffer 中提取所有可用数据。
        这对于非流式请求尤其重要，因为数据一次性传入后可能有残留。
        """
        events = []
        
        if not self.buffer:
            return events
            
        logger.info(f"🔄 Flushing parser buffer, remaining size: {len(self.buffer)} bytes")
        
        # 尝试从 buffer 中提取任何可能的 JSON 内容
        try:
            buffer_str = self.buffer.decode('utf-8', errors='ignore')
            
            # 方法1：查找所有 JSON 对象
            json_pattern = r'\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}'
            matches = re.findall(json_pattern, buffer_str, re.DOTALL)
            
            for match in matches:
                try:
                    event_data = json.loads(match)
                    if event_data:  # 确保不是空对象
                        events.append(event_data)
                        logger.debug(f"Flush extracted event: {event_data}")
                except json.JSONDecodeError:
                    continue
                    
            # 方法2：如果没找到完整JSON，尝试提取 content 字段
            if not events and '"content"' in buffer_str:
                content_pattern = r'"content"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"'
                content_matches = re.findall(content_pattern, buffer_str)
                for content in content_matches:
                    # 解码转义字符
                    try:
                        decoded_content = content.encode().decode('unicode_escape')
                        events.append({"content": decoded_content})
                        logger.debug(f"Flush extracted content: {decoded_content[:100]}...")
                    except Exception:
                        events.append({"content": content})
                        
        except Exception as e:
            logger.error(f"Error during buffer flush: {e}")
            
        # 清空 buffer
        self.buffer = b''
        
        if events:
            logger.info(f"✅ Flush recovered {len(events)} events from buffer")
        
        return events
    
    def has_remaining_data(self) -> bool:
        """检查 buffer 中是否还有未处理的数据"""
        return len(self.buffer) > 0
    
    def get_remaining_buffer_size(self) -> int:
        """获取 buffer 中剩余数据的大小"""
        return len(self.buffer)


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

