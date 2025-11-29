/**
 * 事件解析模块
 * 构建 Claude 格式的 SSE 事件
 */

import { v4 as uuidv4 } from "uuid";
import { logger } from "../utils/logger.js";
import {
    EventInfo,
    MessageStart,
    ContentBlockDelta,
    Message,
    Delta,
    AssistantResponseEnd
} from "./models.js";

// ============================================================================
// Claude SSE 事件构建函数
// ============================================================================

/**
 * 构建 Claude SSE 格式的事件
 */
export function buildClaudeSSEEvent(eventType: string, data: Record<string, unknown>): string {
    const jsonData = JSON.stringify(data);
    return `event: ${eventType}\ndata: ${jsonData}\n\n`;
}

/**
 * 构建 message_start 事件
 */
export function buildClaudeMessageStartEvent(
    conversationId: string,
    model: string = "claude-sonnet-4.5",
    inputTokens: number = 0
): string {
    const data = {
        type: "message_start",
        message: {
            id: conversationId,
            type: "message",
            role: "assistant",
            content: [],
            model,
            stop_reason: null,
            stop_sequence: null,
            usage: { input_tokens: inputTokens, output_tokens: 0 }
        }
    };
    return buildClaudeSSEEvent("message_start", data);
}

/**
 * 构建 content_block_start 事件（文本类型）
 */
export function buildClaudeContentBlockStartEvent(index: number): string {
    const data = {
        type: "content_block_start",
        index,
        content_block: { type: "text", text: "" }
    };
    return buildClaudeSSEEvent("content_block_start", data);
}

/**
 * 构建 content_block_delta 事件
 */
export function buildClaudeContentBlockDeltaEvent(index: number, text: string): string {
    const data = {
        type: "content_block_delta",
        index,
        delta: { type: "text_delta", text }
    };
    return buildClaudeSSEEvent("content_block_delta", data);
}

/**
 * 构建 content_block_stop 事件
 */
export function buildClaudeContentBlockStopEvent(index: number): string {
    const data = {
        type: "content_block_stop",
        index
    };
    return buildClaudeSSEEvent("content_block_stop", data);
}

/**
 * 构建 ping 事件（保持连接活跃）
 */
export function buildClaudePingEvent(): string {
    const data = { type: "ping" };
    return buildClaudeSSEEvent("ping", data);
}

/**
 * 构建 message_delta 和 message_stop 事件
 */
export function buildClaudeMessageStopEvent(
    inputTokens: number,
    outputTokens: number,
    stopReason?: string
): string {
    // 先发送 message_delta
    const deltaData = {
        type: "message_delta",
        delta: { stop_reason: stopReason || "end_turn", stop_sequence: null },
        usage: { input_tokens: inputTokens, output_tokens: outputTokens }
    };
    const deltaEvent = buildClaudeSSEEvent("message_delta", deltaData);

    // 再发送 message_stop（包含最终 usage）
    const stopData = {
        type: "message_stop",
        stop_reason: stopReason || "end_turn",
        usage: { input_tokens: inputTokens, output_tokens: outputTokens }
    };
    const stopEvent = buildClaudeSSEEvent("message_stop", stopData);

    return deltaEvent + stopEvent;
}

/**
 * 构建 tool use 类型的 content_block_start 事件
 */
export function buildClaudeToolUseStartEvent(
    index: number,
    toolUseId: string,
    toolName: string
): string {
    const data = {
        type: "content_block_start",
        index,
        content_block: {
            type: "tool_use",
            id: toolUseId,
            name: toolName
        }
    };
    return buildClaudeSSEEvent("content_block_start", data);
}

/**
 * 构建 tool use input 内容的 content_block_delta 事件
 */
export function buildClaudeToolUseInputDeltaEvent(index: number, inputJsonDelta: string): string {
    const data = {
        type: "content_block_delta",
        index,
        delta: {
            type: "input_json_delta",
            partial_json: inputJsonDelta
        }
    };
    return buildClaudeSSEEvent("content_block_delta", data);
}

// ============================================================================
// Amazon Q Event Stream 特定解析函数
// ============================================================================

/**
 * 解析 Amazon Q Event Stream 事件
 *
 * Amazon Q 事件格式：
 * - event_type: "initial-response" | "assistantResponseEvent" | "toolUseEvent"
 * - payload: {"conversationId": "..."} | {"content": "..."} | {"name": "...", "toolUseId": "...", "input": "...", "stop": true/false}
 */
export function parseAmazonQEvent(eventInfo: EventInfo): MessageStart | ContentBlockDelta | AssistantResponseEnd | null {
    const eventType = eventInfo.event_type;
    const payload = eventInfo.payload;

    if (!eventType || !payload) {
        return null;
    }

    try {
        // initial-response 事件 -> MessageStart
        if (eventType === "initial-response") {
            const conversationId = (payload.conversationId as string) || uuidv4();
            const message: Message = {
                conversationId,
                role: "assistant"
            };
            return {
                type: "message_start",
                message
            };
        }

        // assistantResponseEvent 事件 -> ContentBlockDelta
        if (eventType === "assistantResponseEvent") {
            const content = payload.content as string | undefined;
            const toolUses = payload.toolUses as Array<{
                toolUseId: string;
                name: string;
                input: Record<string, unknown>;
            }> | undefined;

            // 如果有文本内容，返回文本增量事件
            if (content) {
                const delta: Delta = {
                    type: "text_delta",
                    text: content
                };
                return {
                    type: "content_block_delta",
                    index: 0,
                    delta
                };
            }

            // 如果有 toolUses，返回助手响应结束事件
            if (toolUses && toolUses.length > 0) {
                return {
                    type: "assistant_response_end",
                    tool_uses: toolUses,
                    message_id: (payload.messageId as string) || ""
                };
            }
        }

        // toolUseEvent 事件 -> 需要特殊处理
        // 返回 null，让 stream_handler 通过 event_type 检测并处理
        if (eventType === "toolUseEvent") {
            return null;
        }

        return null;
    } catch (error) {
        logger.error(`解析 Amazon Q 事件失败: ${error}`);
        return null;
    }
}

