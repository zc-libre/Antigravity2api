import tokenManager from '../auth/token_manager.js';
import config from '../config/config.js';
import { getUserOrSharedToken } from '../admin/user_manager.js';
import logger from '../utils/logger.js';

export async function generateAssistantResponse(requestBody, tokenSource, callbackOrOptions) {
  // 参数归一化：兼容旧版 (requestBody, callback) 与新版 (requestBody, tokenSource, options)
  let onData = null;
  let onRawLine = null;

  // 如果第二个参数是函数，视为数据回调，tokenSource 置空
  if (typeof tokenSource === 'function') {
    onData = tokenSource;
    tokenSource = undefined;
  }

  if (typeof callbackOrOptions === 'function') {
    onData = callbackOrOptions;
  } else if (callbackOrOptions && typeof callbackOrOptions === 'object') {
    if (typeof callbackOrOptions.onData === 'function') onData = callbackOrOptions.onData;
    if (typeof callbackOrOptions.callback === 'function') onData = callbackOrOptions.callback;
    if (typeof callbackOrOptions.onRawLine === 'function') onRawLine = callbackOrOptions.onRawLine;
  }

  const emitData = (payload) => {
    if (typeof onData === 'function') {
      try {
        onData(payload);
      } catch (err) {
        logger.warn('处理数据回调失败', { error: err?.message || err });
      }
    }
  };

  const emitRawLine = (line) => {
    if (typeof onRawLine === 'function') {
      try {
        onRawLine(line);
      } catch (err) {
        logger.warn('处理原始流回调失败', { error: err?.message || err });
      }
    }
  };
  let token;

  if (tokenSource && tokenSource.type === 'user') {
    // 用户 API Key - 使用用户自己的 Token 或共享 Token
    token = await getUserOrSharedToken(tokenSource.userId);
    if (!token) {
      throw new Error('没有可用的 Token。请在用户中心添加 Google Token 或使用共享 Token');
    }
  } else {
    // 管理员密钥 - 使用管理员 Token 池
    token = await tokenManager.getToken();
    if (!token) {
      throw new Error('没有可用的token，请运行 npm run login 获取token');
    }
  }
  // 如果请求体未指定 project，优先使用 token 携带的 project_id
  if (!requestBody.project && token?.project_id) {
    requestBody.project = token.project_id;
  }
  
  const url = config.api.url;
  
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Host': config.api.host,
      'User-Agent': config.api.userAgent,
      'Authorization': `Bearer ${token.access_token}`,
      'Content-Type': 'application/json',
      'Accept-Encoding': 'gzip'
    },
    body: JSON.stringify(requestBody)
  });

  if (!response.ok) {
    const errorText = await response.text();
    if (response.status === 403) {
      tokenManager.disableCurrentToken(token);
      throw new Error(`该账号没有使用权限，已自动禁用。错误详情: ${errorText}`);
    }
    throw new Error(`API请求失败 (${response.status}): ${errorText}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let thinkingStarted = false;
  let toolCalls = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      buffer += decoder.decode();
    } else {
      buffer += decoder.decode(value, { stream: true });
    }

    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line.startsWith('data:')) continue;

      // 提供原始 SSE 行给上层（用于自定义转换）
      emitRawLine(line);

      const jsonStr = line.slice(5).trim();
      if (!jsonStr || jsonStr === '[DONE]' || jsonStr === 'data: [DONE]') continue;
      try {
        const data = JSON.parse(jsonStr);
        const parts = data.response?.candidates?.[0]?.content?.parts;
        if (parts) {
          for (const part of parts) {
            if (part.thought === true) {
              if (!thinkingStarted) {
                emitData({ type: 'thinking', content: '<think>\n' });
                thinkingStarted = true;
              }
              emitData({ type: 'thinking', content: part.text || '' });
            } else if (part.text !== undefined) {
              if (thinkingStarted) {
                emitData({ type: 'thinking', content: '\n</think>\n' });
                thinkingStarted = false;
              }
              emitData({ type: 'text', content: part.text });
            } else if (part.functionCall) {
              toolCalls.push({
                id: part.functionCall.id,
                type: 'function',
                function: {
                  name: part.functionCall.name,
                  arguments: JSON.stringify(part.functionCall.args)
                }
              });
            }
          }
        }

        // 当遇到 finishReason 时，发送所有收集的工具调用
        if (data.response?.candidates?.[0]?.finishReason && toolCalls.length > 0) {
          if (thinkingStarted) {
            emitData({ type: 'thinking', content: '\n</think>\n' });
            thinkingStarted = false;
          }
          emitData({ type: 'tool_calls', tool_calls: toolCalls });
          toolCalls = [];
        }
      } catch (e) {
        logger.warn('解析流数据失败', { line: jsonStr, error: e?.message || e });
      }
    }

    if (done) break;
  }

  // 处理未以换行结尾的残余数据
  const tail = buffer.trim();
  if (tail.startsWith('data:')) {
    emitRawLine(tail);
    const jsonStr = tail.slice(5).trim();
    if (jsonStr && jsonStr !== '[DONE]' && jsonStr !== 'data: [DONE]') {
      try {
        const data = JSON.parse(jsonStr);
        const parts = data.response?.candidates?.[0]?.content?.parts;
        if (parts) {
          for (const part of parts) {
            if (part.thought === true) {
              if (!thinkingStarted) {
                emitData({ type: 'thinking', content: '<think>\n' });
                thinkingStarted = true;
              }
              emitData({ type: 'thinking', content: part.text || '' });
            } else if (part.text !== undefined) {
              if (thinkingStarted) {
                emitData({ type: 'thinking', content: '\n</think>\n' });
                thinkingStarted = false;
              }
              emitData({ type: 'text', content: part.text });
            } else if (part.functionCall) {
              toolCalls.push({
                id: part.functionCall.id,
                type: 'function',
                function: {
                  name: part.functionCall.name,
                  arguments: JSON.stringify(part.functionCall.args)
                }
              });
            }
          }
        }

        if (data.response?.candidates?.[0]?.finishReason && toolCalls.length > 0) {
          if (thinkingStarted) {
            emitData({ type: 'thinking', content: '\n</think>\n' });
            thinkingStarted = false;
          }
          emitData({ type: 'tool_calls', tool_calls: toolCalls });
          toolCalls = [];
        }
      } catch (e) {
        logger.warn('解析残余数据失败', { line: jsonStr, error: e?.message || e });
      }
    }
  }
}

export async function getAvailableModels(tokenSource) {
  let token;

  if (tokenSource && tokenSource.type === 'user') {
    // 用户 API Key - 使用用户自己的 Token 或共享 Token
    token = await getUserOrSharedToken(tokenSource.userId);
    if (!token) {
      throw new Error('没有可用的 Token。请在用户中心添加 Google Token 或使用共享 Token');
    }
  } else {
    // 管理员密钥 - 使用管理员 Token 池
    token = await tokenManager.getToken();
    if (!token) {
      throw new Error('没有可用的token，请运行 npm run login 获取token');
    }
  }
  
  const response = await fetch(config.api.modelsUrl, {
    method: 'POST',
    headers: {
      'Host': config.api.host,
      'User-Agent': config.api.userAgent,
      'Authorization': `Bearer ${token.access_token}`,
      'Content-Type': 'application/json',
      'Accept-Encoding': 'gzip'
    },
    body: JSON.stringify({})
  });

  const data = await response.json();
  
  return {
    object: 'list',
    data: Object.keys(data.models).map(id => ({
      id,
      object: 'model',
      created: Math.floor(Date.now() / 1000),
      owned_by: 'google'
    }))
  };
}
