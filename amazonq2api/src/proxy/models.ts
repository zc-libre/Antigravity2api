/**
 * 数据结构定义
 * 包含 Claude 和 CodeWhisperer 的请求/响应数据结构
 */

// ============================================================================
// Claude API 数据结构
// ============================================================================

/**
 * Claude 文本内容块
 */
export interface ClaudeTextContent {
    type: "text";
    text: string;
}

/**
 * Claude 图片内容块
 */
export interface ClaudeImageContent {
    type: "image";
    source: {
        type: "base64";
        media_type: string;
        data: string;
    };
}

/**
 * Claude Tool Use 内容块
 */
export interface ClaudeToolUseContent {
    type: "tool_use";
    id: string;
    name: string;
    input: Record<string, unknown>;
}

/**
 * Claude Tool Result 内容块
 */
export interface ClaudeToolResultContent {
    type: "tool_result";
    tool_use_id: string;
    content: string | Array<{ type: "text"; text: string }>;
    status?: "success" | "error";
}

export type ClaudeContentBlock =
    | ClaudeTextContent
    | ClaudeImageContent
    | ClaudeToolUseContent
    | ClaudeToolResultContent;

export type ClaudeContent = string | ClaudeContentBlock[];

/**
 * Claude 消息
 */
export interface ClaudeMessage {
    role: "user" | "assistant";
    content: ClaudeContent;
}

/**
 * Claude 工具定义
 */
export interface ClaudeTool {
    name: string;
    description: string;
    input_schema: Record<string, unknown>;
}

/**
 * Claude System Prompt 块
 */
export interface ClaudeSystemBlock {
    type: "text";
    text: string;
}

/**
 * Claude API 请求
 */
export interface ClaudeRequest {
    model: string;
    messages: ClaudeMessage[];
    max_tokens?: number;
    temperature?: number;
    tools?: ClaudeTool[];
    stream?: boolean;
    system?: string | ClaudeSystemBlock[];
}

// ============================================================================
// CodeWhisperer / Amazon Q 数据结构
// ============================================================================

/**
 * 环境状态
 */
export interface EnvState {
    operatingSystem: string;
    currentWorkingDirectory: string;
}

/**
 * 工具规范
 */
export interface ToolSpecification {
    name: string;
    description: string;
    inputSchema: {
        json: Record<string, unknown>;
    };
}

/**
 * 工具定义
 */
export interface Tool {
    toolSpecification: ToolSpecification;
}

/**
 * 工具执行结果
 */
export interface ToolResult {
    toolUseId: string;
    content: Array<{ text: string }>;
    status: string;
}

/**
 * 用户输入消息上下文
 */
export interface UserInputMessageContext {
    envState?: EnvState;
    tools?: Tool[];
    toolResults?: ToolResult[];
}

/**
 * Amazon Q 图片格式
 */
export interface AmazonQImage {
    format: string;
    source: {
        bytes: string;
    };
}

/**
 * 用户输入消息
 */
export interface UserInputMessage {
    content: string;
    userInputMessageContext: UserInputMessageContext;
    origin: string;
    modelId: string;
    images?: AmazonQImage[];
}

/**
 * 当前消息
 */
export interface CurrentMessage {
    userInputMessage: UserInputMessage;
}

/**
 * 助手响应消息
 */
export interface AssistantResponseMessage {
    messageId: string;
    content: string;
    toolUses?: Array<{
        toolUseId: string;
        name: string;
        input: Record<string, unknown>;
    }>;
}

/**
 * 历史消息条目
 */
export interface HistoryEntry {
    userInputMessage?: {
        content: string;
        userInputMessageContext: UserInputMessageContext;
        origin?: string;
        images?: AmazonQImage[];
    };
    assistantResponseMessage?: AssistantResponseMessage;
}

/**
 * 对话状态
 */
export interface ConversationState {
    conversationId: string;
    history: HistoryEntry[];
    currentMessage: CurrentMessage;
    chatTriggerType: string;
}

/**
 * CodeWhisperer API 请求
 */
export interface CodeWhispererRequest {
    conversationState: ConversationState;
    profileArn?: string;
}

// ============================================================================
// CodeWhisperer 事件数据结构
// ============================================================================

/**
 * 消息对象
 */
export interface Message {
    conversationId: string;
    role: string;
}

/**
 * 内容块
 */
export interface ContentBlock {
    type: string;
}

/**
 * 增量内容
 */
export interface Delta {
    type: string;
    text: string;
}

/**
 * 使用统计
 */
export interface Usage {
    input_tokens: number;
    output_tokens: number;
}

/**
 * 消息开始事件
 */
export interface MessageStart {
    type: "message_start";
    message?: Message;
}

/**
 * 内容块开始事件
 */
export interface ContentBlockStart {
    type: "content_block_start";
    index: number;
    content_block?: ContentBlock;
}

/**
 * 内容块增量事件
 */
export interface ContentBlockDelta {
    type: "content_block_delta";
    index: number;
    delta?: Delta;
}

/**
 * 内容块停止事件
 */
export interface ContentBlockStop {
    type: "content_block_stop";
    index: number;
}

/**
 * 消息停止事件
 */
export interface MessageStop {
    type: "message_stop";
    stop_reason?: string;
    usage?: Usage;
}

/**
 * 助手响应结束事件（包含 toolUses）
 */
export interface AssistantResponseEnd {
    type: "assistant_response_end";
    tool_uses: Array<{
        toolUseId: string;
        name: string;
        input: Record<string, unknown>;
    }>;
    message_id: string;
}

/**
 * 工具使用事件
 */
export interface CodeWhispererToolUse {
    toolUseId: string;
    name: string;
    input: Record<string, unknown>;
}

/**
 * CodeWhisperer 事件数据的联合类型
 */
export type CodeWhispererEventData =
    | MessageStart
    | ContentBlockStart
    | ContentBlockDelta
    | ContentBlockStop
    | MessageStop
    | AssistantResponseEnd
    | CodeWhispererToolUse;

/**
 * Event Stream 解析后的事件信息
 */
export interface EventInfo {
    event_type?: string;
    content_type?: string;
    message_type?: string;
    payload?: Record<string, unknown>;
}

/**
 * Event Stream 解析后的消息
 */
export interface ParsedMessage {
    headers: Record<string, string>;
    payload?: Record<string, unknown> | Buffer;
    total_length: number;
}

// ============================================================================
// 辅助函数
// ============================================================================

/**
 * 将 Claude 工具定义转换为 CodeWhisperer 工具定义
 */
export function claudeToolToCodeWhispererTool(claudeTool: ClaudeTool): Tool {
    // Amazon Q 的 description 字段有长度限制（10240 字符）
    let description = claudeTool.description;
    if (description.length > 10240) {
        description = description.slice(0, 10100) + "\n\n...(Full description provided in TOOL DOCUMENTATION section)";
    }

    return {
        toolSpecification: {
            name: claudeTool.name,
            description,
            inputSchema: {
                json: claudeTool.input_schema
            }
        }
    };
}

/**
 * 从 Claude 内容中提取文本
 */
export function extractTextFromClaudeContent(content: ClaudeContent): string {
    if (typeof content === "string") {
        return content;
    }

    const textParts: string[] = [];
    for (const block of content) {
        if (block.type === "text") {
            textParts.push(block.text);
        }
    }
    return textParts.join("\n");
}

/**
 * 从 Claude 内容中提取图片并转换为 Amazon Q 格式
 */
export function extractImagesFromClaudeContent(content: ClaudeContent): AmazonQImage[] | undefined {
    if (typeof content === "string") {
        return undefined;
    }

    const images: AmazonQImage[] = [];
    for (const block of content) {
        if (block.type === "image") {
            const source = block.source;
            if (source.type === "base64") {
                // 从 media_type 提取格式 (例如: "image/png" -> "png")
                const mediaType = source.media_type || "image/png";
                const parts = mediaType.split("/");
                const format = parts.length > 1 ? parts[1]! : "png";

                images.push({
                    format,
                    source: {
                        bytes: source.data
                    }
                });
            }
        }
    }

    return images.length > 0 ? images : undefined;
}

