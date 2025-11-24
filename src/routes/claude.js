import express from 'express';
import {
  convertClaudeRequestToAntigravity,
  convertAntigravityStreamToClaude,
  convertAntigravityNonStreamToClaude
} from '../utils/claudeToAntigravity.js';
import { generateAssistantResponse, getAvailableModels } from '../api/client.js';
import logger from '../utils/logger.js';
import idleManager from '../utils/idle_manager.js';
import { incrementRequestCount, addLog } from '../admin/routes.js';

const router = express.Router();

function validateClaudeRequest(body = {}) {
  if (!body || typeof body !== 'object') {
    return '请求体必须是有效的 JSON 对象';
  }
  if (!body.model) {
    return '缺少必需参数: model';
  }
  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return '缺少必需参数: messages (必须为非空数组)';
  }
  if (body.max_tokens === undefined || body.max_tokens === null) {
    return '缺少必需参数: max_tokens';
  }
  return '';
}

function safeLog(level, message) {
  try {
    incrementRequestCount();
    addLog(level, message);
  } catch (err) {
    logger.warn('记录管理日志失败:', err?.message || err);
  }
}

function sanitizeHeaders(headers = {}) {
  const sensitiveKeys = ['authorization', 'proxy-authorization', 'cookie'];
  return Object.entries(headers).reduce((acc, [key, value]) => {
    acc[key] = sensitiveKeys.includes(key.toLowerCase()) ? '[REDACTED]' : value;
    return acc;
  }, {});
}

function logClaudeRequest(req) {
  logger.info('Claude /v1/messages 请求收到', {
    headers: sanitizeHeaders(req.headers),
    body: req.body
  });
}

router.post('/v1/messages', async (req, res) => {
  idleManager.recordActivity();

  // logClaudeRequest(req);

  const errorMsg = validateClaudeRequest(req.body);
  if (errorMsg) {
    return res.status(400).json({ error: errorMsg });
  }

  const isStream = req.body.stream === true;
  const antigravityRequest = convertClaudeRequestToAntigravity(req.body);

  if (isStream) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    const state = { messageStarted: false, stopped: false, model: req.body.model };

    const handleRawLine = (line) => {
      const converted = convertAntigravityStreamToClaude(line, state);
      if (converted) {
        if (converted.includes('message_stop')) {
          state.stopped = true;
        }
        res.write(converted);
      }
    };

    try {
      await generateAssistantResponse(antigravityRequest, req.tokenSource, { onRawLine: handleRawLine });

      if (state.messageStarted && !state.stopped) {
        if (state.lastBlockType === 'text' && state.currentIndex >= 0) {
          res.write(
            `event: content_block_stop\ndata: ${JSON.stringify({
              type: 'content_block_stop',
              index: state.currentIndex
            })}\n\n`
          );
        }
        // 收尾补发 stop 事件与 usage，避免上游缺失 finishReason 时客户端挂起
        res.write(
          `event: message_delta\ndata: ${JSON.stringify({
            type: 'message_delta',
            delta: { stop_reason: 'end_turn', stop_sequence: null },
            usage: {
              input_tokens: state.inputTokens ?? 0,
              output_tokens: state.outputTokens ?? 0
            }
          })}\n\n`
        );
        res.write('event: message_stop\ndata: {"type":"message_stop"}\n\n');
      }

      safeLog('info', 'Claude /v1/messages 流式请求完成');
    } catch (error) {
      logger.error('Claude 流式请求失败:', error.message);
      res.write(
        `event: error\ndata: ${JSON.stringify({ type: 'error', error: error.message })}\n\n`
      );
      safeLog('error', `Claude /v1/messages 流式错误: ${error.message}`);
    } finally {
      if (!res.writableEnded) {
        res.end();
      }
    }

    return;
  }

  let fullContent = '';
  let thinkingContent = '';
  let toolCalls = [];
  let finishReason = 'STOP';

  try {
    await generateAssistantResponse(
      antigravityRequest,
      (data) => {
        if (!data || !data.type) return;
        if (data.type === 'text') {
          fullContent += data.content || '';
        } else if (data.type === 'thinking') {
          thinkingContent += data.content || '';
        } else if (data.type === 'tool_calls') {
          toolCalls = data.tool_calls || [];
        }
      },
      {
        onRawLine: (line) => {
          try {
            const jsonStr = line.startsWith('data:') ? line.slice(5).trim() : line;
            const payload = JSON.parse(jsonStr);
            const reason = payload?.response?.candidates?.[0]?.finishReason;
            if (reason) finishReason = reason;
          } catch (err) {
            // 忽略无法解析的原始行
          }
        }
      }
    );

    const message = convertAntigravityNonStreamToClaude(
      fullContent,
      toolCalls,
      thinkingContent,
      req.body.model,
      finishReason
    );

    res.json(message);
    safeLog('info', 'Claude /v1/messages 非流式请求完成');
  } catch (error) {
    logger.error('Claude 非流式请求失败:', error.message);
    safeLog('error', `Claude /v1/messages 非流式错误: ${error.message}`);

    const status = error.message?.includes('token') ? 503 : 500;
    res.status(status).json({ error: error.message });
  }
});

router.get('/v1/models', async (req, res) => {
  idleManager.recordActivity();
  try {
    const models = await getAvailableModels();
    const data = (models?.data || []).map((modelItem) => {
      const id = modelItem?.id || modelItem;
      const createdAt = modelItem?.created
        ? new Date(modelItem.created * 1000).toISOString()
        : new Date().toISOString();
      return {
        id,
        type: 'model',
        display_name: modelItem?.display_name || id,
        created_at: createdAt
      };
    });

    res.json({ data, has_more: false });
    safeLog('info', 'Claude /v1/models 获取成功');
  } catch (error) {
    logger.error('获取 Claude 模型列表失败:', error.message);
    safeLog('error', `Claude /v1/models 错误: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

router.post('/v1/messages/count_tokens', (req, res) => {
  idleManager.recordActivity();
  safeLog('info', 'Claude /v1/messages/count_tokens 请求收到');

  const { messages = [], system, tools = [] } = req.body || {};

  const estimateTokens = () => {
    let chars = 0;
    const countText = (val) => {
      if (!val) return;
      if (typeof val === 'string') {
        chars += val.length;
      } else if (Array.isArray(val)) {
        val.forEach((item) => countText(item?.text || item?.content || item));
      } else if (typeof val === 'object') {
        Object.values(val).forEach((v) => countText(v));
      }
    };

    messages.forEach((m) => countText(m?.content));
    countText(system);
    tools.forEach((t) => {
      countText(t?.name);
      countText(t?.description);
      countText(t?.input_schema);
    });

    // 近似：4 字符 ≈ 1 token
    return Math.max(1, Math.ceil(chars / 4));
  };

  const inputTokens = estimateTokens();

  res.json({
    input_tokens: inputTokens
  });
});

// Claude Code 需要的用户与额度查询端点（轻量占位实现）
router.get('/v1/me', (req, res) => {
  idleManager.recordActivity();
  const id = 'user_default';
  res.json({
    id,
    type: 'user',
    display_name: 'Antigravity User',
    created_at: new Date().toISOString()
  });
});

router.get('/v1/organizations/:org_id/usage', (req, res) => {
  idleManager.recordActivity();
  res.json({
    object: 'usage',
    data: [
      {
        type: 'credit_balance',
        credit_balance: 1_000_000
      }
    ]
  });
});

router.get('/v1/key-info', (req, res) => {
  idleManager.recordActivity();
  res.json({
    keyInfo: {
      id: 'default-key',
      name: 'Antigravity Default Key',
      tokenLimit: 1_000_000,
      usage: { totalTokens: 0 }
    },
    timestamp: new Date().toISOString()
  });
});

router.get('/v1/usage', (req, res) => {
  idleManager.recordActivity();
  res.json({
    usage: {
      totalTokens: 0,
      dailyTokens: 0,
      monthlyTokens: 0
    },
    limits: {
      tokens: 1_000_000,
      requests: 0
    },
    timestamp: new Date().toISOString()
  });
});

export default router;
