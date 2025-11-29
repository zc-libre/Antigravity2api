/**
 * 消息处理模块
 * 处理 Claude Code 历史记录，合并连续的用户消息，确保符合 Amazon Q 格式要求
 */

import { logger } from "../utils/logger.js";
import { HistoryEntry, UserInputMessageContext } from "./models.js";

interface UserInputMsg {
    content: string;
    userInputMessageContext: UserInputMessageContext;
    origin?: string;
    modelId?: string;
}

/**
 * 合并多个 userInputMessage 的内容
 */
export function mergeUserMessages(userMessages: UserInputMsg[]): UserInputMsg {
    if (userMessages.length === 0) {
        return {
            content: "",
            userInputMessageContext: {},
            origin: "CLI"
        };
    }

    // 提取所有内容
    const allContents: string[] = [];
    let baseContext: UserInputMessageContext | undefined;
    let baseOrigin: string | undefined;
    let baseModel: string | undefined;

    for (const msg of userMessages) {
        const content = msg.content || "";

        // 保留第一个消息的上下文信息
        if (!baseContext) {
            baseContext = msg.userInputMessageContext || {};
        }

        // 保留第一个消息的 origin
        if (!baseOrigin) {
            baseOrigin = msg.origin || "CLI";
        }

        // 保留第一个消息的 modelId
        if (!baseModel && msg.modelId) {
            baseModel = msg.modelId;
        }

        // 添加内容（保留所有内容，包括 system-reminder）
        if (content) {
            allContents.push(content);
        }
    }

    // 合并内容，使用双换行分隔
    const mergedContent = allContents.join("\n\n");

    // 构建合并后的消息
    const mergedMsg: UserInputMsg = {
        content: mergedContent,
        userInputMessageContext: baseContext || {},
        origin: baseOrigin || "CLI"
    };

    // 如果原始消息有 modelId，也保留
    if (baseModel) {
        mergedMsg.modelId = baseModel;
    }

    return mergedMsg;
}

/**
 * 处理 Claude Code 历史记录，使其符合 Amazon Q 要求
 *
 * 策略：
 * 1. 合并连续的 userInputMessage
 * 2. 保留所有内容（包括 system-reminder）
 * 3. 确保 user-assistant 消息严格交替
 */
export function processClaudeHistoryForAmazonQ(history: HistoryEntry[]): HistoryEntry[] {
    if (history.length === 0) {
        return [];
    }

    const processedHistory: HistoryEntry[] = [];
    const pendingUserMessages: UserInputMsg[] = [];

    logger.info(`[MESSAGE_PROCESSOR] 开始处理历史记录，共 ${history.length} 条消息`);

    for (let idx = 0; idx < history.length; idx++) {
        const msg = history[idx]!;

        if (msg.userInputMessage) {
            // 收集连续的用户消息
            pendingUserMessages.push(msg.userInputMessage as UserInputMsg);
            logger.debug(
                `[MESSAGE_PROCESSOR] 消息 ${idx}: 收集 userInputMessage，当前待合并数量: ${pendingUserMessages.length}`
            );
        } else if (msg.assistantResponseMessage) {
            // 遇到助手消息时，先合并之前的用户消息
            if (pendingUserMessages.length > 0) {
                logger.info(`[MESSAGE_PROCESSOR] 消息 ${idx}: 合并 ${pendingUserMessages.length} 条 userInputMessage`);
                const mergedUserMsg = mergeUserMessages(pendingUserMessages);
                processedHistory.push({
                    userInputMessage: mergedUserMsg
                });
                pendingUserMessages.length = 0;
            }

            // 添加助手消息
            logger.debug(`[MESSAGE_PROCESSOR] 消息 ${idx}: 添加 assistantResponseMessage`);
            processedHistory.push(msg);
        }
    }

    // 处理末尾剩余的用户消息
    if (pendingUserMessages.length > 0) {
        logger.info(`[MESSAGE_PROCESSOR] 处理末尾剩余的 ${pendingUserMessages.length} 条 userInputMessage`);
        const mergedUserMsg = mergeUserMessages(pendingUserMessages);
        processedHistory.push({
            userInputMessage: mergedUserMsg
        });
    }

    logger.info(
        `[MESSAGE_PROCESSOR] 历史记录处理完成，原始 ${history.length} 条 -> 处理后 ${processedHistory.length} 条`
    );

    // 验证消息交替
    try {
        validateMessageAlternation(processedHistory);
    } catch (error) {
        logger.error(`[MESSAGE_PROCESSOR] 消息交替验证失败: ${error}`);
        throw error;
    }

    return processedHistory;
}

/**
 * 验证消息是否严格交替（user-assistant-user-assistant...）
 */
export function validateMessageAlternation(history: HistoryEntry[]): boolean {
    if (history.length === 0) {
        return true;
    }

    let lastRole: "user" | "assistant" | null = null;

    for (let idx = 0; idx < history.length; idx++) {
        const msg = history[idx]!;
        let currentRole: "user" | "assistant";

        if (msg.userInputMessage) {
            currentRole = "user";
        } else if (msg.assistantResponseMessage) {
            currentRole = "assistant";
        } else {
            logger.warn(`[MESSAGE_PROCESSOR] 消息 ${idx} 既不是 user 也不是 assistant: ${Object.keys(msg)}`);
            continue;
        }

        if (lastRole === currentRole) {
            const errorMsg = `消息 ${idx} 违反交替规则: 连续两个 ${currentRole} 消息`;
            logger.error(`[MESSAGE_PROCESSOR] ${errorMsg}`);
            const prevMsg = history[idx - 1];
            if (prevMsg) {
                logger.error(`[MESSAGE_PROCESSOR] 上一条消息: ${Object.keys(prevMsg)}`);
            }
            logger.error(`[MESSAGE_PROCESSOR] 当前消息: ${Object.keys(msg)}`);
            throw new Error(errorMsg);
        }

        lastRole = currentRole;
    }

    logger.info("[MESSAGE_PROCESSOR] 消息交替验证通过");
    return true;
}

/**
 * 记录历史记录摘要，用于调试
 */
export function logHistorySummary(history: HistoryEntry[], prefix: string = ""): void {
    if (history.length === 0) {
        logger.info(`${prefix}历史记录为空`);
        return;
    }

    const summary: string[] = [];
    for (let idx = 0; idx < history.length; idx++) {
        const msg = history[idx]!;
        if (msg.userInputMessage) {
            const content = msg.userInputMessage.content || "";
            // 取前80个字符作为预览
            const contentPreview = content.slice(0, 80).replace(/\n/g, " ");
            summary.push(`  [${idx}] USER: ${contentPreview}...`);
        } else if (msg.assistantResponseMessage) {
            const content = msg.assistantResponseMessage.content || "";
            const contentPreview = content.slice(0, 80).replace(/\n/g, " ");
            summary.push(`  [${idx}] ASSISTANT: ${contentPreview}...`);
        }
    }

    logger.info(`${prefix}历史记录摘要 (共 ${history.length} 条):\n${summary.join("\n")}`);
}

/**
 * 合并 currentMessage 中重复的 toolResults
 */
export function mergeToolResults(
    toolResults: Array<{ toolUseId: string; content: Array<{ text: string }>; status: string }>
): Array<{ toolUseId: string; content: Array<{ text: string }>; status: string }> {
    const mergedToolResults: Array<{ toolUseId: string; content: Array<{ text: string }>; status: string }> = [];
    const seenToolUseIds = new Set<string>();

    for (const result of toolResults) {
        const toolUseId = result.toolUseId;

        if (seenToolUseIds.has(toolUseId)) {
            // 找到已存在的条目，合并 content
            const existing = mergedToolResults.find(r => r.toolUseId === toolUseId);
            if (existing) {
                existing.content.push(...result.content);
                logger.info(`[CURRENT MESSAGE] 合并重复的 toolUseId ${toolUseId} 的 content`);
            }
        } else {
            // 新条目
            seenToolUseIds.add(toolUseId);
            mergedToolResults.push({
                toolUseId: result.toolUseId,
                content: [...result.content],
                status: result.status
            });
        }
    }

    return mergedToolResults;
}

