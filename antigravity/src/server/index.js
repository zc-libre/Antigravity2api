import express from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { generateAssistantResponse, getAvailableModels } from '../api/client.js';
import { generateRequestBody } from '../utils/utils.js';
import logger from '../utils/logger.js';
import config from '../config/config.js';
import adminRoutes, { incrementRequestCount, addLog, checkModelQuota, recordModelUsage } from '../admin/routes.js';
import claudeRoutes from '../routes/claude.js';
import { validateKey, checkRateLimit } from '../admin/key_manager.js';
import { validateUserApiKey, getUserById, startInactiveUsersCleanup, stopInactiveUsersCleanup } from '../admin/user_manager.js';
import { startAIScheduler, stopAIScheduler } from '../admin/ai_moderator.js';
import idleManager from '../utils/idle_manager.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 确保必要的目录存在
const ensureDirectories = () => {
  const dirs = ['data', 'uploads'];
  dirs.forEach(dir => {
    const dirPath = path.join(process.cwd(), dir);
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
      logger.info(`创建目录: ${dir}`);
    }
  });
};

ensureDirectories();

const app = express();

app.use(express.json({ limit: config.security.maxRequestSize }));

// 静态文件服务 - 提供管理控制台页面
app.use(express.static(path.join(process.cwd(), 'public')));

app.use((err, req, res, next) => {
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ error: `请求体过大，最大支持 ${config.security.maxRequestSize}` });
  }
  next(err);
});

// 请求日志中间件
app.use((req, res, next) => {
  // 记录请求活动，管理空闲状态
  if (req.path.startsWith('/antigravity/api/v1/')) {
    idleManager.recordActivity();
  }

  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    logger.request(req.method, req.path, res.statusCode, duration);

    // 记录到管理日志
    if (req.path.startsWith('/antigravity/api/v1/')) {
      incrementRequestCount();
      addLog('info', `${req.method} ${req.path} - ${res.statusCode} (${duration}ms)`);
    }
  });
  next();
});

// API 密钥验证和频率限制中间件
app.use(async (req, res, next) => {
  if (req.path.startsWith('/antigravity/api/v1/')) {
    const apiKey = config.security?.apiKey;
    if (apiKey) {
      const authHeader = req.headers.authorization;
      const providedKey = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : authHeader;

      // 先检查配置文件中的密钥（不受频率限制）
      if (providedKey === apiKey) {
        req.tokenSource = { type: 'admin' };
        return next();
      }

      // 再检查管理员数据库中的密钥
      const isValid = await validateKey(providedKey);
      if (isValid) {
        // 检查频率限制
        const rateLimitCheck = await checkRateLimit(providedKey);
        if (!rateLimitCheck.allowed) {
          logger.warn(`频率限制: ${req.method} ${req.path} - ${rateLimitCheck.error}`);
          await addLog('warn', `频率限制触发: ${providedKey.substring(0, 10)}...`);

          res.setHeader('X-RateLimit-Limit', rateLimitCheck.limit || 0);
          res.setHeader('X-RateLimit-Remaining', 0);
          res.setHeader('X-RateLimit-Reset', rateLimitCheck.resetIn || 0);

          return res.status(429).json({
            error: {
              message: rateLimitCheck.error,
              type: 'rate_limit_exceeded',
              reset_in_seconds: rateLimitCheck.resetIn
            }
          });
        }

        // 设置频率限制响应头
        if (rateLimitCheck.limit) {
          res.setHeader('X-RateLimit-Limit', rateLimitCheck.limit);
          res.setHeader('X-RateLimit-Remaining', rateLimitCheck.remaining);
        }
        req.tokenSource = { type: 'admin' };
        return next();
      }

      // 检查用户 API 密钥
      const userKeyResult = await validateUserApiKey(providedKey);
      if (userKeyResult.valid) {
        req.tokenSource = { type: 'user', userId: userKeyResult.userId };
        return next();
      }

      // 都没有找到有效密钥
      logger.warn(`API Key 验证失败: ${req.method} ${req.path}`);
      await addLog('warn', `API Key 验证失败: ${req.method} ${req.path}`);
      return res.status(401).json({ error: 'Invalid API Key' });
    }
  }
  next();
});

// 管理路由
app.use('/antigravity/api/admin', adminRoutes);

// Claude API 兼容路由
app.use('/antigravity/api/claude', claudeRoutes);

app.get('/antigravity/api/v1/models', async (req, res) => {
  try {
    const models = await getAvailableModels(req.tokenSource);
    res.json(models);
  } catch (error) {
    logger.error('获取模型列表失败:', error.message);
    res.status(500).json({ error: error.message });
  }
});

app.post('/antigravity/api/v1/chat/completions', async (req, res) => {
  let { messages, model, stream = true, tools, ...params} = req.body;
  try {

    if (!messages) {
      return res.status(400).json({ error: 'messages is required' });
    }

    // 如果是用户 API Key，注入用户的系统提示词并检查模型配额
    if (req.tokenSource && req.tokenSource.type === 'user') {
      try {
        const user = await getUserById(req.tokenSource.userId);
        if (user && user.systemPrompt) {
          // 检查是否已经有系统消息
          const hasSystemMessage = messages.some(msg => msg.role === 'system');

          if (!hasSystemMessage) {
            // 在消息数组开头添加系统提示词
            messages = [
              { role: 'system', content: user.systemPrompt },
              ...messages
            ];
          } else {
            // 如果已有系统消息，将用户的系统提示词追加到第一个系统消息
            const systemMsgIndex = messages.findIndex(msg => msg.role === 'system');
            messages[systemMsgIndex].content = user.systemPrompt + '\n\n' + messages[systemMsgIndex].content;
          }
        }
      } catch (error) {
        logger.warn(`获取用户系统提示词失败: ${error.message}`);
        // 继续执行，不影响正常请求
      }

      // 检查模型配额
      try {
        const quotaCheck = await checkModelQuota(req.tokenSource.userId, model || 'gemini-2.0-flash-exp');
        if (!quotaCheck.allowed) {
          logger.warn(`用户 ${req.tokenSource.userId} 模型 ${model} 配额已用尽`);
          return res.status(429).json({
            error: {
              message: quotaCheck.error || `模型 ${model} 今日配额已用尽，剩余: ${quotaCheck.remaining}/${quotaCheck.quota}`,
              type: 'quota_exceeded',
              quota: quotaCheck.quota,
              used: quotaCheck.used,
              remaining: quotaCheck.remaining
            }
          });
        }
      } catch (error) {
        logger.warn(`检查模型配额失败: ${error.message}`);
        // 继续执行，不影响正常请求
      }
    }

    const requestBody = generateRequestBody(messages, model, params, tools);
    //console.log(JSON.stringify(requestBody,null,2));
    
    if (stream) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      
      const id = `chatcmpl-${Date.now()}`;
      const created = Math.floor(Date.now() / 1000);
      let hasToolCall = false;
      
      await generateAssistantResponse(requestBody, req.tokenSource, (data) => {
        if (data.type === 'tool_calls') {
          hasToolCall = true;
          res.write(`data: ${JSON.stringify({
            id,
            object: 'chat.completion.chunk',
            created,
            model,
            choices: [{ index: 0, delta: { tool_calls: data.tool_calls }, finish_reason: null }]
          })}\n\n`);
        } else {
          res.write(`data: ${JSON.stringify({
            id,
            object: 'chat.completion.chunk',
            created,
            model,
            choices: [{ index: 0, delta: { content: data.content }, finish_reason: null }]
          })}\n\n`);
        }
      });
      
      res.write(`data: ${JSON.stringify({
        id,
        object: 'chat.completion.chunk',
        created,
        model,
        choices: [{ index: 0, delta: {}, finish_reason: hasToolCall ? 'tool_calls' : 'stop' }]
      })}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();

      // 记录模型使用（用户 API Key）
      if (req.tokenSource && req.tokenSource.type === 'user') {
        try {
          await recordModelUsage(req.tokenSource.userId, model || 'gemini-2.0-flash-exp');
        } catch (error) {
          logger.warn(`记录模型使用失败: ${error.message}`);
        }
      }
    } else {
      let fullContent = '';
      let toolCalls = [];
      await generateAssistantResponse(requestBody, req.tokenSource, (data) => {
        if (data.type === 'tool_calls') {
          toolCalls = data.tool_calls;
        } else {
          fullContent += data.content;
        }
      });
      
      const message = { role: 'assistant', content: fullContent };
      if (toolCalls.length > 0) {
        message.tool_calls = toolCalls;
      }
      
      res.json({
        id: `chatcmpl-${Date.now()}`,
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model,
        choices: [{
          index: 0,
          message,
          finish_reason: toolCalls.length > 0 ? 'tool_calls' : 'stop'
        }]
      });

      // 记录模型使用（用户 API Key）
      if (req.tokenSource && req.tokenSource.type === 'user') {
        try {
          await recordModelUsage(req.tokenSource.userId, model || 'gemini-2.0-flash-exp');
        } catch (error) {
          logger.warn(`记录模型使用失败: ${error.message}`);
        }
      }
    }
  } catch (error) {
    logger.error('生成响应失败:', error.message);
    if (!res.headersSent) {
      if (stream) {
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        const id = `chatcmpl-${Date.now()}`;
        const created = Math.floor(Date.now() / 1000);
        res.write(`data: ${JSON.stringify({
          id,
          object: 'chat.completion.chunk',
          created,
          model,
          choices: [{ index: 0, delta: { content: `错误: ${error.message}` }, finish_reason: null }]
        })}\n\n`);
        res.write(`data: ${JSON.stringify({
          id,
          object: 'chat.completion.chunk',
          created,
          model,
          choices: [{ index: 0, delta: {}, finish_reason: 'stop' }]
        })}\n\n`);
        res.write('data: [DONE]\n\n');
        res.end();
      } else {
        res.status(500).json({ error: error.message });
      }
    }
  }
});

const server = app.listen(config.server.port, config.server.host, () => {
  logger.info(`服务器已启动: ${config.server.host}:${config.server.port}`);

  // 启动账号自动清理任务
  startInactiveUsersCleanup();

  // 启动AI自动审核调度器
  startAIScheduler();
});

server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    logger.error(`端口 ${config.server.port} 已被占用`);
    process.exit(1);
  } else if (error.code === 'EACCES') {
    logger.error(`端口 ${config.server.port} 无权限访问`);
    process.exit(1);
  } else {
    logger.error('服务器启动失败:', error.message);
    process.exit(1);
  }
});

const shutdown = () => {
  logger.info('正在关闭服务器...');

  // 停止账号自动清理任务
  stopInactiveUsersCleanup();

  // 停止AI调度器
  stopAIScheduler();

  // 清理空闲管理器
  idleManager.destroy();

  server.close(() => {
    logger.info('服务器已关闭');
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 5000);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
