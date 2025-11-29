/**
 * SSE 流处理模块
 * 处理 Amazon Q Event Stream 响应并转换为 Claude 格式
 */

import { logger } from "../utils/logger.js";
import { StreamingEventStreamParser, extractEventInfo } from "./event-stream-parser.js";
import {
    parseAmazonQEvent,
    buildClaudePingEvent,
    buildClaudeMessageStartEvent,
    buildClaudeContentBlockStartEvent,
    buildClaudeContentBlockDeltaEvent,
    buildClaudeContentBlockStopEvent,
    buildClaudeMessageStopEvent,
    buildClaudeToolUseStartEvent,
    buildClaudeToolUseInputDeltaEvent
} from "./parser.js";
import {
    MessageStart,
    ContentBlockDelta,
    AssistantResponseEnd,
    ClaudeRequest
} from "./models.js";

/**
 * Amazon Q Stream 处理器
 */
export class AmazonQStreamHandler {
    // 响应文本累积缓冲区
    private responseBuffer: string[] = [];

    // 内容块索引
    private contentBlockIndex: number = -1;

    // 内容块是否已开始
    private contentBlockStarted: boolean = false;

    // 内容块开始是否已发送
    private contentBlockStartSent: boolean = false;

    // 内容块停止是否已发送
    private contentBlockStopSent: boolean = false;

    // 对话 ID
    private conversationId: string | null = null;

    // 原始请求的 model
    private model: string;

    // 输入 token 数量
    private inputTokens: number = 0;

    // 是否已发送 message_start
    private messageStartSent: boolean = false;

    // Tool use 相关状态
    private currentToolUse: { toolUseId: string; name: string } | null = null;
    private toolInputBuffer: string[] = [];
    private toolUseId: string | null = null;
    private toolName: string | null = null;

    // 已处理的 tool_use_id 集合（用于去重）
    private processedToolUseIds: Set<string> = new Set();

    // 所有 tool use 的完整 input（用于 token 统计）
    private allToolInputs: string[] = [];

    // Event Stream 解析器
    private parser: StreamingEventStreamParser;

    constructor(model: string = "claude-sonnet-4.5", requestData?: ClaudeRequest) {
        this.model = model;
        this.parser = new StreamingEventStreamParser();

        // 估算输入 token 数量（小模型返回0避免累积）
        const isSmallModel = this.isSmallModelRequest(requestData);
        if (isSmallModel) {
            logger.info("检测到小模型请求, input_tokens 设置为 0");
            this.inputTokens = 0;
        } else if (requestData) {
            this.inputTokens = this.estimateInputTokens(requestData);
        } else {
            logger.warn("requestData 为空, input_tokens 设置为 0");
            this.inputTokens = 0;
        }
    }

    /**
     * 判断是否是小模型请求（返回 input_tokens=0）
     */
    private isSmallModelRequest(requestData?: ClaudeRequest): boolean {
        if (!requestData) {
            return false;
        }

        const model = requestData.model.toLowerCase();

        // 小模型关键词列表（可以扩展为从配置读取）
        const zeroTokenModels = ["haiku"];

        // 使用更严格的匹配：关键词必须作为独立单词出现（用 - 或 _ 分隔）
        for (const keyword of zeroTokenModels) {
            const pattern = new RegExp(`(^|[-_])${keyword}([-_]|$)`);
            if (pattern.test(model)) {
                return true;
            }
        }
        return false;
    }

    /**
     * 处理数据块并返回 Claude 格式的事件
     */
    async *handleChunk(chunk: Buffer): AsyncGenerator<string> {
        // 解析 Event Stream 消息
        const messages = this.parser.addChunk(chunk);

        for (const message of messages) {
            // 提取事件信息
            const eventInfo = extractEventInfo(message);
            if (!eventInfo) {
                continue;
            }

            // 记录收到的事件类型
            const eventType = eventInfo.event_type;
            logger.info(`收到 Amazon Q 事件: ${eventType}`);

            // 解析为标准事件对象
            const event = parseAmazonQEvent(eventInfo);

            if (!event) {
                // 检查是否是 toolUseEvent 的原始 payload
                if (eventType === "toolUseEvent" && eventInfo.payload) {
                    logger.debug(`处理 toolUseEvent: ${JSON.stringify(eventInfo.payload)}`);
                    for await (const cliEvent of this.handleToolUseEvent(eventInfo.payload)) {
                        yield cliEvent;
                    }
                } else {
                    logger.debug(`跳过未知事件类型: ${eventType}`);
                }
                continue;
            }

            // 根据事件类型处理
            if (event.type === "message_start") {
                const msgEvent = event as MessageStart;
                if (msgEvent.message) {
                    this.conversationId = msgEvent.message.conversationId;
                }

                // 发送 message_start
                if (!this.messageStartSent) {
                    const cliEvent = buildClaudeMessageStartEvent(
                        this.conversationId || "unknown",
                        this.model,
                        this.inputTokens
                    );
                    yield cliEvent;
                    this.messageStartSent = true;

                    // 在 message_start 之后发送 ping
                    yield buildClaudePingEvent();
                }
            } else if (event.type === "content_block_delta") {
                const deltaEvent = event as ContentBlockDelta;

                // 如果之前有 tool use 块未关闭，先关闭它
                if (this.currentToolUse && !this.contentBlockStopSent) {
                    const cliEvent = buildClaudeContentBlockStopEvent(this.contentBlockIndex);
                    logger.debug(`关闭 tool use 块: index=${this.contentBlockIndex}`);
                    yield cliEvent;
                    this.contentBlockStopSent = true;
                    this.currentToolUse = null;
                }

                // 首次收到内容时，发送 content_block_start
                if (!this.contentBlockStartSent) {
                    this.contentBlockIndex += 1;
                    const cliEvent = buildClaudeContentBlockStartEvent(this.contentBlockIndex);
                    yield cliEvent;
                    this.contentBlockStartSent = true;
                    this.contentBlockStarted = true;
                }

                // 发送内容增量
                if (deltaEvent.delta && deltaEvent.delta.text) {
                    const textChunk = deltaEvent.delta.text;
                    this.responseBuffer.push(textChunk);

                    const cliEvent = buildClaudeContentBlockDeltaEvent(this.contentBlockIndex, textChunk);
                    yield cliEvent;
                }
            } else if (event.type === "assistant_response_end") {
                const endEvent = event as AssistantResponseEnd;
                logger.info(`收到助手响应结束事件，toolUses数量: ${endEvent.tool_uses.length}`);

                // 检查是否需要发送 content_block_stop
                if (this.contentBlockStarted && !this.contentBlockStopSent) {
                    const cliEvent = buildClaudeContentBlockStopEvent(this.contentBlockIndex);
                    yield cliEvent;
                    this.contentBlockStopSent = true;
                }
            }
        }
    }

    /**
     * 流结束时的收尾处理
     */
    *finalize(): Generator<string> {
        // 只有当 content_block_started 且尚未发送 content_block_stop 时才发送
        if (this.contentBlockStarted && !this.contentBlockStopSent) {
            const cliEvent = buildClaudeContentBlockStopEvent(this.contentBlockIndex);
            yield cliEvent;
            this.contentBlockStopSent = true;
        }

        // 计算 output token 数量
        const fullTextResponse = this.responseBuffer.join("");
        const fullToolInputs = this.allToolInputs.join("");
        const outputTokens = this.countTokens(fullTextResponse + fullToolInputs);

        logger.info(
            `Token 统计 - 输入: ${this.inputTokens}, 输出: ${outputTokens} (文本: ${fullTextResponse.length} 字符, tool inputs: ${fullToolInputs.length} 字符)`
        );

        const cliEvent = buildClaudeMessageStopEvent(this.inputTokens, outputTokens, "end_turn");
        yield cliEvent;
    }

    /**
     * 处理 tool use 事件
     */
    private async *handleToolUseEvent(payload: Record<string, unknown>): AsyncGenerator<string> {
        try {
            const toolUseId = payload.toolUseId as string | undefined;
            const toolName = payload.name as string | undefined;
            const toolInput = payload.input as string | Record<string, unknown> | undefined;
            const isStop = payload.stop as boolean | undefined;

            logger.debug(`Tool use 事件 - ID: ${toolUseId}, Name: ${toolName}, Stop: ${isStop}`);

            // 如果是新 tool use 事件的开始
            if (toolUseId && toolName && !this.currentToolUse) {
                logger.info(`开始新的 tool use: ${toolName} (ID: ${toolUseId})`);

                // 如果之前有文本块未关闭，先关闭它
                if (this.contentBlockStartSent && !this.contentBlockStopSent) {
                    const cliEvent = buildClaudeContentBlockStopEvent(this.contentBlockIndex);
                    logger.debug(`关闭文本块: index=${this.contentBlockIndex}`);
                    yield cliEvent;
                    this.contentBlockStopSent = true;
                }

                // 记录这个 tool_use_id 为已处理
                this.processedToolUseIds.add(toolUseId);

                // 内容块索引递增
                this.contentBlockIndex += 1;

                // 发送 content_block_start (tool_use type)
                const cliEvent = buildClaudeToolUseStartEvent(this.contentBlockIndex, toolUseId, toolName);
                logger.debug(`发送 content_block_start (tool_use): index=${this.contentBlockIndex}`);
                yield cliEvent;

                this.contentBlockStarted = true;
                this.currentToolUse = { toolUseId, name: toolName };
                this.toolUseId = toolUseId;
                this.toolName = toolName;
                this.toolInputBuffer = [];
            }

            // 如果是正在处理的 tool use，累积 input 片段
            if (this.currentToolUse && toolInput !== undefined) {
                let inputFragment: string;
                if (typeof toolInput === "string") {
                    inputFragment = toolInput;
                } else if (typeof toolInput === "object") {
                    inputFragment = JSON.stringify(toolInput);
                } else {
                    inputFragment = String(toolInput);
                }

                this.toolInputBuffer.push(inputFragment);
                logger.debug(
                    `累积 input 片段: '${inputFragment.slice(0, 50)}...' (总长度: ${this.toolInputBuffer.join("").length})`
                );

                // 发送 input_json_delta
                const cliEvent = buildClaudeToolUseInputDeltaEvent(this.contentBlockIndex, inputFragment);
                yield cliEvent;
            }

            // 如果是 stop 事件，发送 content_block_stop
            if (isStop && this.currentToolUse) {
                const fullInput = this.toolInputBuffer.join("");
                logger.info(`完成 tool use: ${this.toolName} (ID: ${this.toolUseId})`);
                logger.debug(`完整 input (${fullInput.length} 字符): ${fullInput.slice(0, 200)}...`);

                // 保存完整的 tool input 用于 token 统计
                this.allToolInputs.push(fullInput);

                const cliEvent = buildClaudeContentBlockStopEvent(this.contentBlockIndex);
                logger.debug(`发送 content_block_stop: index=${this.contentBlockIndex}`);
                yield cliEvent;

                // 重置状态
                this.contentBlockStopSent = false;
                this.contentBlockStarted = false;
                this.contentBlockStartSent = false;
                this.currentToolUse = null;
                this.toolUseId = null;
                this.toolName = null;
                this.toolInputBuffer = [];
            }
        } catch (error) {
            logger.error(`处理 tool use 事件失败: ${error}`);
            throw error;
        }
    }

    /**
     * 计算文本的 token 数量（简化估算）
     */
    private countTokens(text: string): number {
        if (!text) {
            return 0;
        }
        // 简化估算：平均每 4 个字符约等于 1 个 token
        return Math.max(1, Math.floor(text.length / 4));
    }

    /**
     * 估算输入 token 数量
     */
    private estimateInputTokens(requestData: ClaudeRequest): number {
        try {
            const textParts: string[] = [];

            // 统计 system prompt
            if (requestData.system) {
                if (typeof requestData.system === "string") {
                    textParts.push(requestData.system);
                } else if (Array.isArray(requestData.system)) {
                    for (const block of requestData.system) {
                        if (block.type === "text") {
                            textParts.push(block.text);
                        }
                    }
                }
            }

            // 统计所有消息内容
            for (const msg of requestData.messages) {
                const content = msg.content;
                if (typeof content === "string") {
                    textParts.push(content);
                } else if (Array.isArray(content)) {
                    for (const block of content) {
                        if (block.type === "text") {
                            textParts.push(block.text);
                        } else if (block.type === "tool_use") {
                            textParts.push(block.name);
                            textParts.push(JSON.stringify(block.input));
                        } else if (block.type === "tool_result") {
                            const resultContent = block.content;
                            if (typeof resultContent === "string") {
                                textParts.push(resultContent);
                            } else if (Array.isArray(resultContent)) {
                                for (const resultBlock of resultContent) {
                                    if (typeof resultBlock === "object" && resultBlock.type === "text") {
                                        textParts.push(resultBlock.text);
                                    } else if (typeof resultBlock === "string") {
                                        // 处理字符串类型的 result_block（与 Python 版本保持一致）
                                        textParts.push(resultBlock);
                                    }
                                }
                            }
                        }
                    }
                }
            }

            // 统计 tools 定义
            if (requestData.tools) {
                for (const tool of requestData.tools) {
                    textParts.push(tool.name);
                    textParts.push(tool.description);
                    textParts.push(JSON.stringify(tool.input_schema));
                }
            }

            const fullText = textParts.join("\n");
            const estimatedTokens = this.countTokens(fullText);

            logger.info(`估算输入 tokens: ${estimatedTokens}`);
            return estimatedTokens;
        } catch (error) {
            logger.warn(`估算输入 token 失败: ${error}`);
            return 0;
        }
    }
}

/**
 * 处理 Amazon Q Event Stream 的便捷函数
 */
export async function* handleAmazonQStream(
    response: Response,
    model: string = "claude-sonnet-4.5",
    requestData?: ClaudeRequest
): AsyncGenerator<string> {
    const handler = new AmazonQStreamHandler(model, requestData);

    if (!response.body) {
        throw new Error("Response body is null");
    }

    const reader = response.body.getReader();

    try {
        while (true) {
            const { done, value } = await reader.read();

            if (done) {
                break;
            }

            if (value) {
                for await (const event of handler.handleChunk(Buffer.from(value))) {
                    yield event;
                }
            }
        }

        // 流结束，发送收尾事件
        for (const event of handler.finalize()) {
            yield event;
        }
    } catch (error) {
        // 顶级错误捕获（与 Python 版本保持一致）
        logger.error(`处理流时发生错误: ${error}`);
        throw error;
    } finally {
        reader.releaseLock();
    }
}

