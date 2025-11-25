import { randomUUID } from 'crypto';
import config from '../config/config.js';

function generateRequestId() {
  return `agent-${randomUUID()}`;
}

function generateSessionId() {
  return String(-Math.floor(Math.random() * 9e18));
}

function generateProjectId() {
  const adjectives = ['useful', 'bright', 'swift', 'calm', 'bold'];
  const nouns = ['fuze', 'wave', 'spark', 'flow', 'core'];
  const randomAdj = adjectives[Math.floor(Math.random() * adjectives.length)];
  const randomNoun = nouns[Math.floor(Math.random() * nouns.length)];
  const randomNum = Math.random().toString(36).substring(2, 7);
  return `${randomAdj}-${randomNoun}-${randomNum}`;
}
function extractImagesFromContent(content) {
  const result = { text: '', images: [] };

  // 如果content是字符串，直接返回
  if (typeof content === 'string') {
    result.text = content;
    return result;
  }

  // 如果content是数组（multimodal格式）
  if (Array.isArray(content)) {
    for (const item of content) {
      if (item.type === 'text') {
        result.text += item.text;
      } else if (item.type === 'image_url') {
        // 提取base64图片数据
        const imageUrl = item.image_url?.url || '';

        // 匹配 data:image/{format};base64,{data} 格式
        const match = imageUrl.match(/^data:image\/(\w+);base64,(.+)$/);
        if (match) {
          const format = match[1]; // 例如 png, jpeg, jpg
          const base64Data = match[2];
          result.images.push({
            inlineData: {
              mimeType: `image/${format}`,
              data: base64Data
            }
          })
        }
      }
    }
  }

  return result;
}
function handleUserMessage(extracted, antigravityMessages, enableThinking){
  const parts = [];
  if (extracted.text) {
    // 当开启思考且存在图片时，显式标记为非思考文本，避免 API 校验错误
    if (enableThinking && extracted.images.length > 0) {
      parts.push({ text: extracted.text, thought: false });
    } else {
      parts.push({ text: extracted.text });
    }
  }
  parts.push(...extracted.images);

  if (parts.length === 0) {
    parts.push({ text: "" });
  }

  antigravityMessages.push({
    role: "user",
    parts
  });
}
function handleAssistantMessage(message, antigravityMessages, isImageModel = false, enableThinking = false){
  const lastMessage = antigravityMessages[antigravityMessages.length - 1];
  const hasToolCalls = message.tool_calls && Array.isArray(message.tool_calls) && message.tool_calls.length > 0;
  const hasContent = message.content && (typeof message.content === 'string' ? message.content.trim() !== '' : true);
  
  // 安全处理 tool_calls，防止 undefined.map() 错误
  const toolCallsArray = Array.isArray(message.tool_calls) ? message.tool_calls : [];
  const antigravityTools = hasToolCalls ? toolCallsArray.map(toolCall => {
    let argsObj;
    try {
      argsObj = typeof toolCall.function.arguments === 'string'
        ? JSON.parse(toolCall.function.arguments)
        : toolCall.function.arguments;
    } catch (e) {
      argsObj = {};
    }
    return {
      functionCall: {
        id: toolCall.id,
        name: toolCall.function.name,
        args: argsObj
      }
    };
  }) : [];
  
  if (lastMessage?.role === "model" && hasToolCalls && !hasContent){
    lastMessage.parts.push(...antigravityTools);
  } else {
    const parts = [];
    if (hasContent) {
      let textContent = '';
      if (typeof message.content === 'string') {
        textContent = message.content;
      } else if (Array.isArray(message.content)) {
        textContent = message.content
          .filter(item => item.type === 'text')
          .map(item => item.text)
          .join('');
      }

      if (isImageModel) {
        // 图片模型：去掉 markdown 占位符，统一标记为思考块
        textContent = textContent.replace(/!\[.*?\]\(data:image\/[^)]+\)/g, '');
        textContent = textContent.replace(/\[图像生成完成[^\]]*\]/g, '');
        textContent = textContent.replace(/\n{3,}/g, '\n\n').trim();
        if (textContent) {
          parts.push({ text: textContent, thought: true });
        }
      } else {
        // 非图片模型：拆分 <think> 片段
        const thinkMatches = textContent.match(/<think>([\s\S]*?)<\/think>/g);
        if (thinkMatches) {
          for (const match of thinkMatches) {
            const thinkContent = match.replace(/<\/?think>/g, '').trim();
            if (thinkContent) {
              parts.push({ text: thinkContent, thought: true });
            }
          }
        }

        textContent = textContent.replace(/<think>[\s\S]*?<\/think>/g, '');
        textContent = textContent.replace(/\n{3,}/g, '\n\n').trim();

        if (textContent) {
          if (enableThinking && parts.length > 0) {
            parts.push({ text: textContent, thought: false });
          } else {
            parts.push({ text: textContent });
          }
        }
      }
    }

    parts.push(...antigravityTools);

    if (parts.length === 0) {
      parts.push({ text: "" });
    }

    antigravityMessages.push({
      role: "model",
      parts
    });
  }
}
function handleToolCall(message, antigravityMessages){
  // 从之前的 model 消息中找到对应的 functionCall name
  let functionName = '';
  for (let i = antigravityMessages.length - 1; i >= 0; i--) {
    if (antigravityMessages[i].role === 'model') {
      const parts = antigravityMessages[i].parts;
      for (const part of parts) {
        if (part.functionCall && part.functionCall.id === message.tool_call_id) {
          functionName = part.functionCall.name;
          break;
        }
      }
      if (functionName) break;
    }
  }
  
  const lastMessage = antigravityMessages[antigravityMessages.length - 1];
  const functionResponse = {
    functionResponse: {
      id: message.tool_call_id,
      name: functionName,
      response: {
        output: message.content
      }
    }
  };
  
  // 如果上一条消息是 user 且包含 functionResponse，则合并
  if (lastMessage?.role === "user" && lastMessage.parts.some(p => p.functionResponse)) {
    lastMessage.parts.push(functionResponse);
  } else {
    antigravityMessages.push({
      role: "user",
      parts: [functionResponse]
    });
  }
}
function openaiMessageToAntigravity(openaiMessages, enableThinking = false, modelName = ''){
  const antigravityMessages = [];
  const isImageModel = modelName.endsWith('-image');

  for (const message of openaiMessages) {
    if (message.role === "user" || message.role === "system") {
      const extracted = extractImagesFromContent(message.content);
      handleUserMessage(extracted, antigravityMessages, enableThinking);
    } else if (message.role === "assistant") {
      handleAssistantMessage(message, antigravityMessages, isImageModel, enableThinking);
    } else if (message.role === "tool") {
      handleToolCall(message, antigravityMessages);
    }
  }
  
  return antigravityMessages;
}
function generateGenerationConfig(parameters, enableThinking, actualModelName){
  const generationConfig = {
    topP: parameters.top_p ?? config.defaults.top_p,
    topK: parameters.top_k ?? config.defaults.top_k,
    temperature: parameters.temperature ?? config.defaults.temperature,
    candidateCount: 1,
    maxOutputTokens: parameters.max_tokens ?? config.defaults.max_tokens,
    stopSequences: [
      "<|user|>",
      "<|bot|>",
      "<|context_request|>",
      "<|endoftext|>",
      "<|end_of_turn|>"
    ]
  };

  // 部分图片模型不支持 thinkingConfig
  if (actualModelName !== 'gemini-2.5-flash-image') {
    generationConfig.thinkingConfig = {
      includeThoughts: enableThinking,
      thinkingBudget: enableThinking ? 1024 : 0
    };
  }

  if (enableThinking && actualModelName.includes("claude")){
    delete generationConfig.topP;
  }
  return generationConfig;
}

/**
 * Gemini API 不支持的 JSON Schema 关键字黑名单
 * 这些关键字会导致 Claude API 返回 "JSON schema is invalid" 错误
 */
const UNSUPPORTED_SCHEMA_KEYS = new Set([
  // 草案/元信息
  '$schema', '$id', '$defs', 'definitions',
  // 组合逻辑
  'allOf', 'anyOf', 'oneOf', 'not', 'if', 'then', 'else',
  // 正则/模式类
  'pattern', 'patternProperties', 'propertyNames',
  // 字符串约束（重点：minLength/maxLength 会导致 tools.10 错误）
  'minLength', 'maxLength',
  // 数组约束
  'minItems', 'maxItems', 'uniqueItems', 'contains',
  // 数值约束
  'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf',
  // 依赖相关
  'dependentSchemas', 'dependentRequired',
  // 评估相关
  'additionalItems', 'unevaluatedItems', 'unevaluatedProperties'
]);

/**
 * 规范化 JSON Schema，移除 Gemini 不支持的关键字
 * 只保留基本的 type/properties/required/items/enum/additionalProperties/description/format/default
 *
 * 这个函数解决了 "tools.10.custom.input_schema: JSON schema is invalid" 错误
 * 该错误是由于 TodoWrite 工具中使用了 minLength 等 Gemini 不支持的约束关键字
 */
function normalizeJsonSchema(schema) {
  if (!schema || typeof schema !== 'object') {
    return schema;
  }

  // 处理数组
  if (Array.isArray(schema)) {
    return schema.map(item => normalizeJsonSchema(item));
  }

  // 深拷贝对象
  const normalized = { ...schema };

  // 1. 删除黑名单中的所有关键字
  for (const key of Object.keys(normalized)) {
    if (UNSUPPORTED_SCHEMA_KEYS.has(key)) {
      delete normalized[key];
    }
  }

  // 2. 递归处理保留下来的 schema 相关字段
  // properties: 对象属性定义
  if (normalized.properties !== undefined) {
    if (typeof normalized.properties === 'object' && !Array.isArray(normalized.properties)) {
      const processed = {};
      for (const [propKey, propValue] of Object.entries(normalized.properties)) {
        processed[propKey] = normalizeJsonSchema(propValue);
      }
      normalized.properties = processed;
    }
  }

  // items: 数组项定义
  if (normalized.items !== undefined) {
    normalized.items = normalizeJsonSchema(normalized.items);
  }

  // additionalProperties: 额外属性定义
  if (normalized.additionalProperties !== undefined &&
      typeof normalized.additionalProperties === 'object') {
    normalized.additionalProperties = normalizeJsonSchema(normalized.additionalProperties);
  }

  return normalized;
}

function convertOpenAIToolsToAntigravity(openaiTools){
  // 安全处理 openaiTools，防止 undefined.map() 错误
  const toolsArray = Array.isArray(openaiTools) ? openaiTools : [];
  if (toolsArray.length === 0) return [];
  
  return toolsArray.map((tool) => {
    // 规范化 parameters，移除 Draft 7 特征和问题字段
    const normalizedParams = normalizeJsonSchema(tool.function.parameters);
    
    return {
      functionDeclarations: [
        {
          name: tool.function.name,
          description: tool.function.description,
          parameters: normalizedParams
        }
      ]
    };
  });
}
function generateRequestBody(openaiMessages,modelName,parameters,openaiTools){
  const isExplicitThinking = modelName.endsWith('-thinking');
  const actualModelName = isExplicitThinking ? modelName.slice(0, -9) : modelName;

  const supportsThinking = modelName.endsWith('-thinking') ||
    actualModelName === 'gemini-2.5-pro' ||
    actualModelName.startsWith('gemini-3-pro-') ||
    actualModelName === "rev19-uic3-1p" ||
    actualModelName === "gpt-oss-120b-medium";
  const enableThinking = supportsThinking;
  
  const requestBody = {
    project: generateProjectId(),
    requestId: generateRequestId(),
    request: {
      contents: openaiMessageToAntigravity(openaiMessages, enableThinking, actualModelName),
      systemInstruction: {
        role: "user",
        parts: [{ text: config.systemInstruction }]
      },
      generationConfig: generateGenerationConfig(parameters, enableThinking, actualModelName),
      sessionId: generateSessionId()
    },
    model: modelName,
    userAgent: "antigravity"
  };

  if (openaiTools && openaiTools.length > 0) {
    requestBody.request.tools = convertOpenAIToolsToAntigravity(openaiTools);
    requestBody.request.toolConfig = {
      functionCallingConfig: {
        mode: "VALIDATED"
      }
    };
  }

  return requestBody;
}
// HTML转义函数，防止XSS攻击
function escapeHtml(unsafe) {
  if (!unsafe) return '';
  return unsafe
    .toString()
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export{
  generateRequestId,
  generateSessionId,
  generateProjectId,
  generateRequestBody,
  escapeHtml
}
