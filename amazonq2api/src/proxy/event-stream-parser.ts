/**
 * AWS Event Stream 解析器
 * 解析 Amazon Q 返回的 vnd.amazon.eventstream 格式数据
 */

import { logger } from "../utils/logger.js";
import { ParsedMessage, EventInfo } from "./models.js";

/**
 * AWS Event Stream 解析器
 *
 * Event Stream 格式：
 * - Prelude (12 bytes):
 *   - Total length (4 bytes, big-endian uint32)
 *   - Headers length (4 bytes, big-endian uint32)
 *   - Prelude CRC (4 bytes, big-endian uint32)
 * - Headers (variable length)
 * - Payload (variable length)
 * - Message CRC (4 bytes, big-endian uint32)
 */
export class EventStreamParser {
    /**
     * 解析事件头部
     *
     * 头部格式：
     * - Header name length (1 byte)
     * - Header name (variable)
     * - Header value type (1 byte, 7=string)
     * - Header value length (2 bytes, big-endian uint16)
     * - Header value (variable)
     */
    static parseHeaders(headersData: Buffer): Record<string, string> {
        const headers: Record<string, string> = {};
        let offset = 0;

        while (offset < headersData.length) {
            // 读取头部名称长度
            if (offset >= headersData.length) break;
            const nameLength = headersData[offset]!;
            offset += 1;

            // 读取头部名称
            if (offset + nameLength > headersData.length) break;
            const name = headersData.subarray(offset, offset + nameLength).toString("utf8");
            offset += nameLength;

            // 读取值类型
            if (offset >= headersData.length) break;
            const valueType = headersData[offset];
            offset += 1;

            // 读取值长度（2 字节）
            if (offset + 2 > headersData.length) break;
            const valueLength = headersData.readUInt16BE(offset);
            offset += 2;

            // 读取值
            if (offset + valueLength > headersData.length) break;

            let value: string | Buffer;
            if (valueType === 7) {
                // String type - 解码为 UTF-8 字符串
                value = headersData.subarray(offset, offset + valueLength).toString("utf8");
            } else {
                // 其他类型 - 保留原始字节（与 Python 版本保持一致）
                // 注意：为了兼容性，这里转换为字符串，但记录警告
                value = headersData.subarray(offset, offset + valueLength).toString("utf8");
            }

            offset += valueLength;
            headers[name] = value as string;
        }

        return headers;
    }

    /**
     * 解析单个 Event Stream 消息
     */
    static parseMessage(data: Buffer): ParsedMessage | null {
        try {
            if (data.length < 16) {
                // 最小消息长度
                return null;
            }

            // 解析 Prelude (12 bytes)
            const totalLength = data.readUInt32BE(0);
            const headersLength = data.readUInt32BE(4);
            // const preludeCrc = data.readUInt32BE(8);

            // 验证长度
            if (data.length < totalLength) {
                logger.warn(`消息不完整: 期望 ${totalLength} 字节，实际 ${data.length} 字节`);
                return null;
            }

            // 解析头部
            const headersData = data.subarray(12, 12 + headersLength);
            const headers = EventStreamParser.parseHeaders(headersData);

            // 解析 Payload
            const payloadStart = 12 + headersLength;
            const payloadEnd = totalLength - 4; // 减去最后的 CRC
            const payloadData = data.subarray(payloadStart, payloadEnd);

            // 尝试解析 JSON payload
            let payload: Record<string, unknown> | Buffer | undefined;
            if (payloadData.length > 0) {
                try {
                    payload = JSON.parse(payloadData.toString("utf8"));
                } catch {
                    payload = payloadData;
                }
            }

            return {
                headers,
                payload,
                total_length: totalLength
            };
        } catch (error) {
            logger.error(`解析消息失败: ${error}`);
            return null;
        }
    }

    /**
     * 解析字节流，提取事件（生成器版本，用于同步处理）
     */
    static *parseBuffer(buffer: Buffer): Generator<ParsedMessage> {
        let offset = 0;

        while (offset + 12 <= buffer.length) {
            // 读取消息总长度
            const totalLength = buffer.readUInt32BE(offset);

            // 检查是否有完整的消息
            if (offset + totalLength > buffer.length) {
                break;
            }

            // 提取完整消息
            const messageData = buffer.subarray(offset, offset + totalLength);
            offset += totalLength;

            // 解析消息
            const message = EventStreamParser.parseMessage(messageData);
            if (message) {
                yield message;
            }
        }
    }
}

/**
 * 流式 Event Stream 解析器
 * 用于处理分块到达的数据
 */
export class StreamingEventStreamParser {
    private buffer: Buffer = Buffer.alloc(0);

    /**
     * 添加数据块并返回所有可解析的消息
     */
    addChunk(chunk: Buffer): ParsedMessage[] {
        // 合并缓冲区
        this.buffer = Buffer.concat([this.buffer, chunk]);

        const messages: ParsedMessage[] = [];

        // 尝试解析缓冲区中的消息
        while (this.buffer.length >= 12) {
            // 读取消息总长度
            const totalLength = this.buffer.readUInt32BE(0);

            // 检查是否有完整的消息
            if (this.buffer.length < totalLength) {
                break;
            }

            // 提取完整消息
            const messageData = this.buffer.subarray(0, totalLength);
            this.buffer = this.buffer.subarray(totalLength);

            // 解析消息
            const message = EventStreamParser.parseMessage(messageData);
            if (message) {
                messages.push(message);
            }
        }

        return messages;
    }

    /**
     * 重置解析器状态
     */
    reset(): void {
        this.buffer = Buffer.alloc(0);
    }
}

/**
 * 从解析后的消息中提取事件信息
 */
export function extractEventInfo(message: ParsedMessage): EventInfo {
    const headers = message.headers;
    const payload = message.payload;

    const eventType = headers[":event-type"] || headers["event-type"];
    const contentType = headers[":content-type"] || headers["content-type"];
    const messageType = headers[":message-type"] || headers["message-type"];

    return {
        event_type: eventType,
        content_type: contentType,
        message_type: messageType,
        payload: Buffer.isBuffer(payload) ? undefined : (payload as Record<string, unknown> | undefined)
    };
}

/**
 * 简化的文本解析器（备用方案）
 *
 * 从文本格式的事件流中提取可读部分：
 * :event-type assistantResponseEvent
 * :content-type application/json
 * :message-type event
 * {"content":"..."}
 */
export function parseTextStreamLine(line: string): Record<string, unknown> | null {
    const trimmedLine = line.trim();

    // 跳过空行
    if (!trimmedLine) {
        return null;
    }

    // 尝试解析 JSON
    if (trimmedLine.startsWith("{") && trimmedLine.endsWith("}")) {
        try {
            return JSON.parse(trimmedLine);
        } catch {
            // JSON 解析失败，返回 null
        }
    }

    return null;
}
