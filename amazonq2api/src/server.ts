import express, { Request, Response, NextFunction } from "express";
import { v4 as uuidv4 } from "uuid";
import { loadConfig } from "./config.js";
import { autoRegister, AutoRegisterOptions } from "./index.js";
import { FileStore } from "./storage/file-store.js";
import { logger } from "./utils/logger.js";
import { AccountRecord } from "./types/index.js";
import cors from "cors";

// Claude API Proxy imports
import { ClaudeRequest } from "./proxy/models.js";
import { convertClaudeToCodeWhispererRequest, codewhispererRequestToDict } from "./proxy/converter.js";
import { processClaudeHistoryForAmazonQ, logHistorySummary, mergeToolResults } from "./proxy/message-processor.js";
import { initAccountManager, AccountManager, Account } from "./proxy/account-manager.js";
import {
    getAuthHeadersWithRetry,
    getAuthHeadersForAccount,
    refreshAccountToken,
    buildAmazonQHeaders,
    TokenRefreshError,
    NoAccountAvailableError
} from "./proxy/auth.js";
import { AmazonQStreamHandler } from "./proxy/stream-handler.js";

/**
 * 注册任务状态枚举
 */
type TaskStatus = "pending" | "running" | "completed" | "failed";

/**
 * 日志条目
 */
interface LogEntry {
    timestamp: string;
    level: "info" | "warn" | "error" | "debug";
    message: string;
    context?: unknown;
}

/**
 * 注册任务记录
 */
interface RegisterTask {
    id: string;
    status: TaskStatus;
    createdAt: string;
    startedAt?: string;
    completedAt?: string;
    options: RegisterTaskOptions;
    result?: AccountRecord;
    error?: string;
    logs: LogEntry[];
    progress?: {
        step: string;
        percent: number;
    };
}

/**
 * 注册任务选项
 */
interface RegisterTaskOptions {
    password?: string;
    fullName?: string;
    headless?: boolean;
    label?: string;
    maxRetries?: number;
}

// 全局任务存储
const tasks = new Map<string, RegisterTask>();

// 当前正在运行的任务
let runningTask: RegisterTask | null = null;

// 任务队列
const taskQueue: string[] = [];

// SSE 客户端连接（按 taskId 分组）
const sseClients = new Map<string, Set<Response>>();

/**
 * 向任务添加日志
 */
function addTaskLog(taskId: string, level: LogEntry["level"], message: string, context?: unknown): void {
    const task = tasks.get(taskId);
    if (!task) return;

    const logEntry: LogEntry = {
        timestamp: new Date().toISOString(),
        level,
        message,
        context
    };
    task.logs.push(logEntry);

    // 广播给所有订阅此任务的 SSE 客户端
    broadcastToTask(taskId, { type: "log", data: logEntry });
    
    // 同时输出到控制台
    logger[level](message, { taskId, ...context as object });
}

/**
 * 更新任务进度
 */
function updateTaskProgress(taskId: string, step: string, percent: number): void {
    const task = tasks.get(taskId);
    if (!task) return;

    task.progress = { step, percent };
    broadcastToTask(taskId, { type: "progress", data: task.progress });
}

/**
 * 广播消息到订阅任务的所有 SSE 客户端
 */
function broadcastToTask(taskId: string, message: { type: string; data: unknown }): void {
    const clients = sseClients.get(taskId);
    if (!clients || clients.size === 0) return;

    const data = `data: ${JSON.stringify(message)}\n\n`;
    clients.forEach(client => {
        try {
            client.write(data);
        } catch (error) {
            // 客户端已断开
        }
    });
}

/**
 * 广播任务状态变更
 */
function broadcastTaskStatus(taskId: string): void {
    const task = tasks.get(taskId);
    if (!task) return;

    broadcastToTask(taskId, {
        type: "status",
        data: {
            status: task.status,
            error: task.error,
            result: task.result ? {
                email: task.result.awsEmail,
                savedAt: task.result.savedAt
            } : undefined
        }
    });
}

const config = loadConfig();
const fileStore = new FileStore(config.outputFile);

// 初始化账号管理器
const accountManager = initAccountManager(config.outputFile);

// Amazon Q API URL
const AMAZONQ_API_URL = "https://q.us-east-1.amazonaws.com/";

/**
 * 处理任务队列
 */
async function processQueue(): Promise<void> {
    if (runningTask || taskQueue.length === 0) {
        return;
    }

    const taskId = taskQueue.shift()!;
    const task = tasks.get(taskId);
    if (!task) {
        processQueue();
        return;
    }

    runningTask = task;
    task.status = "running";
    task.startedAt = new Date().toISOString();
    
    addTaskLog(taskId, "info", "开始执行注册任务");
    updateTaskProgress(taskId, "初始化", 0);
    broadcastTaskStatus(taskId);

    try {
        // 定义进度回调
        const onProgress = (step: string, percent: number, message?: string) => {
            updateTaskProgress(taskId, step, percent);
            if (message) {
                addTaskLog(taskId, "info", message);
            }
        };

        const account = await autoRegister({
            ...task.options,
            config,
            onProgress
        });
        
        task.status = "completed";
        task.result = account;
        task.completedAt = new Date().toISOString();
        
        addTaskLog(taskId, "info", `注册成功，邮箱: ${account.awsEmail}`);
        updateTaskProgress(taskId, "完成", 100);
        broadcastTaskStatus(taskId);
    } catch (error) {
        task.status = "failed";
        task.error = error instanceof Error ? error.message : String(error);
        task.completedAt = new Date().toISOString();
        
        addTaskLog(taskId, "error", `注册失败: ${task.error}`);
        broadcastTaskStatus(taskId);
    } finally {
        runningTask = null;
        // 继续处理队列
        processQueue();
    }
}

const app = express();
app.use(express.json({ limit: "50mb" }));
app.use(cors());

// 请求日志中间件
app.use((req: Request, _res: Response, next: NextFunction) => {
    logger.debug("收到请求", { method: req.method, path: req.path });
    next();
});

/**
 * GET /health
 * 健康检查
 */
app.get("/health", (_req: Request, res: Response) => {
    res.json({
        status: "ok",
        timestamp: new Date().toISOString(),
        runningTask: runningTask?.id ?? null,
        queueLength: taskQueue.length
    });
});

/**
 * POST /api/register
 * 创建新的注册任务
 */
app.post("/api/register", (req: Request, res: Response) => {
    const options: RegisterTaskOptions = {
        password: req.body.password,
        fullName: req.body.fullName,
        headless: req.body.headless ?? config.headless,
        label: req.body.label ?? `Web-${Date.now()}`,
        maxRetries: req.body.maxRetries ?? 3
    };

    const task: RegisterTask = {
        id: uuidv4(),
        status: "pending",
        createdAt: new Date().toISOString(),
        options,
        logs: []
    };

    tasks.set(task.id, task);
    taskQueue.push(task.id);
    
    addTaskLog(task.id, "info", "任务已创建，等待执行");
    logger.info("创建注册任务", { taskId: task.id, label: options.label });

    // 触发队列处理
    processQueue();

    res.status(201).json({
        success: true,
        taskId: task.id,
        message: "注册任务已创建",
        position: taskQueue.length
    });
});

/**
 * GET /api/register/:taskId/logs
 * 获取任务日志（支持 SSE 实时推送）
 */
app.get("/api/register/:taskId/logs", (req: Request<{ taskId: string }>, res: Response) => {
    const { taskId } = req.params;
    const task = tasks.get(taskId);

    if (!task) {
        res.status(404).json({
            success: false,
            error: "任务不存在"
        });
        return;
    }

    // 检查是否请求 SSE
    if (req.headers.accept === "text/event-stream") {
        // SSE 模式
        res.setHeader("Content-Type", "text/event-stream");
        res.setHeader("Cache-Control", "no-cache");
        res.setHeader("Connection", "keep-alive");
        res.setHeader("X-Accel-Buffering", "no");

        // 发送现有日志
        task.logs.forEach(log => {
            res.write(`data: ${JSON.stringify({ type: "log", data: log })}\n\n`);
        });

        // 发送当前进度
        if (task.progress) {
            res.write(`data: ${JSON.stringify({ type: "progress", data: task.progress })}\n\n`);
        }

        // 发送当前状态
        res.write(`data: ${JSON.stringify({
            type: "status",
            data: {
                status: task.status,
                error: task.error,
                result: task.result ? {
                    email: task.result.awsEmail,
                    savedAt: task.result.savedAt
                } : undefined
            }
        })}\n\n`);

        // 注册 SSE 客户端
        if (!sseClients.has(taskId)) {
            sseClients.set(taskId, new Set());
        }
        sseClients.get(taskId)!.add(res);

        // 客户端断开连接时清理
        req.on("close", () => {
            const clients = sseClients.get(taskId);
            if (clients) {
                clients.delete(res);
                if (clients.size === 0) {
                    sseClients.delete(taskId);
                }
            }
        });
    } else {
        // 普通 JSON 模式
        res.json({
            success: true,
            logs: task.logs,
            progress: task.progress,
            status: task.status
        });
    }
});

/**
 * GET /api/register/:taskId
 * 查询注册任务状态
 */
app.get("/api/register/:taskId", (req: Request<{ taskId: string }>, res: Response) => {
    const { taskId } = req.params;
    const task = tasks.get(taskId);

    if (!task) {
        res.status(404).json({
            success: false,
            error: "任务不存在"
        });
        return;
    }

    // 计算队列位置（taskId 已经确认是 string 类型）
    const queuePosition = taskQueue.indexOf(taskId as string);

    res.json({
        success: true,
        task: {
            id: task.id,
            status: task.status,
            createdAt: task.createdAt,
            startedAt: task.startedAt,
            completedAt: task.completedAt,
            label: task.options.label,
            queuePosition: queuePosition >= 0 ? queuePosition + 1 : null,
            result: task.status === "completed" ? {
                email: task.result?.awsEmail,
                savedAt: task.result?.savedAt
            } : undefined,
            error: task.error
        }
    });
});

/**
 * GET /api/tasks
 * 列出所有任务
 */
app.get("/api/tasks", (_req: Request, res: Response) => {
    const taskList = Array.from(tasks.values())
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        .map(task => ({
            id: task.id,
            status: task.status,
            createdAt: task.createdAt,
            completedAt: task.completedAt,
            label: task.options.label,
            email: task.result?.awsEmail,
            error: task.error
        }));

    res.json({
        success: true,
        total: taskList.length,
        running: runningTask?.id ?? null,
        queueLength: taskQueue.length,
        tasks: taskList
    });
});

/**
 * DELETE /api/register/:taskId
 * 取消等待中的任务
 */
app.delete("/api/register/:taskId", (req: Request<{ taskId: string }>, res: Response) => {
    const { taskId } = req.params;
    const task = tasks.get(taskId);

    if (!task) {
        res.status(404).json({
            success: false,
            error: "任务不存在"
        });
        return;
    }

    if (task.status === "running") {
        res.status(400).json({
            success: false,
            error: "无法取消正在运行的任务"
        });
        return;
    }

    if (task.status === "completed" || task.status === "failed") {
        res.status(400).json({
            success: false,
            error: "任务已结束，无法取消"
        });
        return;
    }

    // 从队列移除（taskId 已经确认是 string 类型）
    const queueIndex = taskQueue.indexOf(taskId as string);
    if (queueIndex >= 0) {
        taskQueue.splice(queueIndex, 1);
    }
    tasks.delete(taskId);

    logger.info("任务已取消", { taskId });

    res.json({
        success: true,
        message: "任务已取消"
    });
});

/**
 * GET /api/accounts
 * 获取所有已注册账号
 */
app.get("/api/accounts", async (_req: Request, res: Response) => {
    try {
        const accounts = await fileStore.readAll();
        res.json({
            success: true,
            total: accounts.length,
            accounts: accounts.map(acc => ({
                email: acc.awsEmail,
                label: acc.label,
                savedAt: acc.savedAt,
                hasRefreshToken: !!acc.refreshToken
            }))
        });
    } catch (error) {
        logger.error("读取账号列表失败", { error });
        res.status(500).json({
            success: false,
            error: "读取账号列表失败"
        });
    }
});

/**
 * GET /api/accounts/:email
 * 获取指定账号详情
 */
app.get("/api/accounts/:email", async (req: Request<{ email: string }>, res: Response) => {
    try {
        const accounts = await fileStore.readAll();
        const email = req.params.email;
        const account = accounts.find(acc => acc.awsEmail === email);

        if (!account) {
            res.status(404).json({
                success: false,
                error: "账号不存在"
            });
            return;
        }

        res.json({
            success: true,
            account: {
                email: account.awsEmail,
                password: account.awsPassword,
                clientId: account.clientId,
                clientSecret: account.clientSecret,
                accessToken: account.accessToken,
                refreshToken: account.refreshToken,
                label: account.label,
                savedAt: account.savedAt,
                expiresIn: account.expiresIn
            }
        });
    } catch (error) {
        logger.error("读取账号详情失败", { error });
        res.status(500).json({
            success: false,
            error: "读取账号详情失败"
        });
    }
});

// ============================================================================
// Claude API 代理端点
// ============================================================================

/**
 * API Key 验证中间件
 */
function verifyApiKey(req: Request, res: Response, next: NextFunction): void {
    const apiKey = process.env.API_KEY;
    
    // 如果没有设置 API_KEY，则不需要验证
    if (!apiKey) {
        next();
        return;
    }
    
    // 检查请求头中的 x-api-key
    const requestApiKey = req.headers["x-api-key"];
    if (!requestApiKey || requestApiKey !== apiKey) {
        res.status(401).json({
            error: "未授权：需要有效的 API Key。请在请求头中添加 x-api-key"
        });
        return;
    }
    
    next();
}

/**
 * POST /v1/messages
 * Claude API 兼容的消息创建端点
 */
app.post("/v1/messages", verifyApiKey, async (req: Request, res: Response) => {
    try {
        const requestData = req.body as ClaudeRequest;
        const model = requestData.model || "claude-sonnet-4.5";
        
        logger.info(`收到 Claude API 请求: model=${model}`);
        
        // 转换为 CodeWhisperer 请求
        const codewhispererReq = convertClaudeToCodeWhispererRequest(requestData);
        
        // 转换为字典
        let codewhispererDict = codewhispererRequestToDict(codewhispererReq);
        
        // 处理历史记录：合并连续的 userInputMessage
        const conversationState = codewhispererDict.conversationState as Record<string, unknown>;
        const history = conversationState.history as Array<Record<string, unknown>>;
        
        if (history && history.length > 0) {
            logger.info("=" + "=".repeat(79));
            logger.info("原始历史记录:");
            logHistorySummary(history as any, "[原始] ");
            
            // 合并连续的用户消息
            const processedHistory = processClaudeHistoryForAmazonQ(history as any);
            
            logger.info("=" + "=".repeat(79));
            logger.info("处理后的历史记录:");
            logHistorySummary(processedHistory, "[处理后] ");
            
            // 更新请求体
            conversationState.history = processedHistory;
            codewhispererDict.conversationState = conversationState;
        }
        
        // 处理 currentMessage 中的重复 toolResults
        const currentMessage = conversationState.currentMessage as Record<string, unknown>;
        const userInputMessage = currentMessage?.userInputMessage as Record<string, unknown>;
        const userInputMessageContext = userInputMessage?.userInputMessageContext as Record<string, unknown>;
        
        if (userInputMessageContext?.toolResults) {
            const toolResults = userInputMessageContext.toolResults as Array<{
                toolUseId: string;
                content: Array<{ text: string }>;
                status: string;
            }>;
            userInputMessageContext.toolResults = mergeToolResults(toolResults);
        }
        
        const finalRequest = codewhispererDict;
        
        // 调试：打印请求体
        logger.debug(`转换后的请求体: ${JSON.stringify(finalRequest, null, 2)}`);
        
        // 获取账号和认证头
        const specifiedAccountId = req.headers["x-account-id"] as string | undefined;
        
        let account: Account | null = null;
        let baseAuthHeaders: Record<string, string>;
        
        try {
            if (specifiedAccountId) {
                // 使用指定的账号
                account = await accountManager.getAccount(specifiedAccountId);
                if (!account) {
                    res.status(404).json({ error: `账号不存在: ${specifiedAccountId}` });
                    return;
                }
                if (account.enabled === false) {
                    res.status(403).json({ error: `账号已禁用: ${specifiedAccountId}` });
                    return;
                }
                
                baseAuthHeaders = await getAuthHeadersForAccount(account, accountManager);
                logger.info(`使用指定账号 - 账号: ${account.id} (label: ${account.label || "N/A"})`);
            } else {
                // 随机选择账号
                const result = await getAuthHeadersWithRetry(accountManager);
                account = result.account;
                baseAuthHeaders = result.headers;
                logger.info(`使用多账号模式 - 账号: ${account.id} (label: ${account.label || "N/A"})`);
            }
        } catch (error) {
            if (error instanceof NoAccountAvailableError) {
                logger.error(`无可用账号: ${error.message}`);
                res.status(503).json({ error: "没有可用的账号，请在管理页面添加账号" });
                return;
            }
            if (error instanceof TokenRefreshError) {
                logger.error(`Token 刷新失败: ${error.message}`);
                res.status(502).json({ error: "Token 刷新失败" });
                return;
            }
            throw error;
        }
        
        // 构建 Amazon Q 特定的请求头
        const authHeaders = buildAmazonQHeaders(baseAuthHeaders);
        
        // 发送请求到 Amazon Q
        logger.info("正在发送请求到 Amazon Q...");
        
        // 设置 SSE 响应头
        res.setHeader("Content-Type", "text/event-stream");
        res.setHeader("Cache-Control", "no-cache");
        res.setHeader("Connection", "keep-alive");
        res.setHeader("X-Accel-Buffering", "no");
        
        // 发送请求
        const response = await fetch(AMAZONQ_API_URL, {
            method: "POST",
            headers: authHeaders,
            body: JSON.stringify(finalRequest)
        });
        
        // 处理错误响应
        if (!response.ok) {
            const errorText = await response.text();
            logger.error(`Amazon Q API 错误: ${response.status} ${errorText}`);
            
            // 检测账号是否被封
            if (response.status === 403 && errorText.includes("TEMPORARILY_SUSPENDED") && account) {
                logger.error(`账号 ${account.id} 已被封禁，自动禁用`);
                await accountManager.disableAccount(account.id!, "TEMPORARILY_SUSPENDED");
            }
            
            // 如果是 401/403，尝试刷新 token 并重试
            if ((response.status === 401 || response.status === 403) && account) {
                logger.warn(`收到 ${response.status} 错误，尝试刷新 token 并重试`);
                
                try {
                    const refreshedAccount = await refreshAccountToken(account, accountManager);
                    const newAuthHeaders = buildAmazonQHeaders({
                        Authorization: `Bearer ${refreshedAccount.accessToken}`
                    });
                    
                    // 重试请求
                    const retryResponse = await fetch(AMAZONQ_API_URL, {
                        method: "POST",
                        headers: newAuthHeaders,
                        body: JSON.stringify(finalRequest)
                    });
                    
                    if (!retryResponse.ok) {
                        const retryErrorText = await retryResponse.text();
                        logger.error(`重试后仍失败: ${retryResponse.status} ${retryErrorText}`);
                        
                        // 检测是否被封
                        if (retryResponse.status === 403 && retryErrorText.includes("TEMPORARILY_SUSPENDED")) {
                            await accountManager.disableAccount(account.id!, "TEMPORARILY_SUSPENDED");
                        }
                        
                        res.write(`data: {"type":"error","error":"上游 API 错误: ${retryResponse.status}"}\n\n`);
                        res.end();
                        return;
                    }
                    
                    // 使用重试响应继续处理
                    await streamAmazonQResponse(retryResponse, res, model, requestData);
                    return;
                } catch (refreshError) {
                    logger.error(`Token 刷新失败: ${refreshError}`);
                    res.write(`data: {"type":"error","error":"Token 刷新失败"}\n\n`);
                    res.end();
                    return;
                }
            }
            
            res.write(`data: {"type":"error","error":"上游 API 错误: ${response.status}"}\n\n`);
            res.end();
            return;
        }
        
        // 处理成功响应
        await streamAmazonQResponse(response, res, model, requestData);
        
    } catch (error) {
        logger.error(`处理请求时发生错误: ${error}`);
        
        // 如果响应头还没发送，返回 JSON 错误
        if (!res.headersSent) {
            res.status(500).json({ error: `内部服务器错误: ${error}` });
        } else {
            // 如果已经是 SSE 模式，发送错误事件
            res.write(`data: {"type":"error","error":"内部服务器错误"}\n\n`);
            res.end();
        }
    }
});

/**
 * 流式处理 Amazon Q 响应并转换为 Claude 格式
 */
async function streamAmazonQResponse(
    fetchResponse: globalThis.Response,
    expressRes: express.Response,
    model: string,
    requestData: ClaudeRequest
): Promise<void> {
    const handler = new AmazonQStreamHandler(model, requestData);
    
    if (!fetchResponse.body) {
        expressRes.write(`data: {"type":"error","error":"Response body is null"}\n\n`);
        expressRes.end();
        return;
    }
    
    const reader = fetchResponse.body.getReader();
    
    try {
        while (true) {
            const { done, value } = await reader.read();
            
            if (done) {
                break;
            }
            
            if (value) {
                for await (const event of handler.handleChunk(Buffer.from(value))) {
                    expressRes.write(event);
                }
            }
        }
        
        // 流结束，发送收尾事件
        for (const event of handler.finalize()) {
            expressRes.write(event);
        }
    } catch (error) {
        logger.error(`流处理错误: ${error}`);
        expressRes.write(`data: {"type":"error","error":"流处理错误"}\n\n`);
    } finally {
        reader.releaseLock();
        expressRes.end();
    }
}

/**
 * GET /v1/models
 * 列出可用模型
 */
app.get("/v1/models", (_req: Request, res: Response) => {
    res.json({
        object: "list",
        data: [
            {
                id: "claude-sonnet-4.5",
                object: "model",
                created: Date.now(),
                owned_by: "amazon-q"
            },
            {
                id: "claude-sonnet-4",
                object: "model",
                created: Date.now(),
                owned_by: "amazon-q"
            },
            {
                id: "claude-haiku-4.5",
                object: "model",
                created: Date.now(),
                owned_by: "amazon-q"
            }
        ]
    });
});

// 错误处理中间件
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    logger.error("服务器错误", { error: err.message });
    res.status(500).json({
        success: false,
        error: "服务器内部错误"
    });
});

// 启动服务器
const PORT = parseInt(process.env.PORT ?? "3000", 10);

app.listen(PORT, () => {
    logger.info(`🚀 Amazon Q 服务已启动`, {
        port: PORT,
        headless: config.headless,
        outputFile: config.outputFile
    });
    logger.info("Claude API 代理端点:", {
        messages: `POST http://localhost:${PORT}/v1/messages`,
        models: `GET  http://localhost:${PORT}/v1/models`
    });
    logger.info("注册服务端点:", {
        health: `GET  http://localhost:${PORT}/health`,
        createTask: `POST http://localhost:${PORT}/api/register`,
        getTask: `GET  http://localhost:${PORT}/api/register/:taskId`,
        listTasks: `GET  http://localhost:${PORT}/api/tasks`,
        cancelTask: `DELETE http://localhost:${PORT}/api/register/:taskId`,
        listAccounts: `GET  http://localhost:${PORT}/api/accounts`,
        getAccount: `GET  http://localhost:${PORT}/api/accounts/:email`
    });
});

export { app };

