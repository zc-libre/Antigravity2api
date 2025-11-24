# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

这是一个将 Google Antigravity API 转换为多种兼容格式的代理服务，支持：
- **OpenAI API 兼容格式**（`/v1/chat/completions`）
- **Claude Messages API 兼容格式**（`/claude/v1/messages`）
- 流式响应、工具调用、多账号管理
- Prompt Caching、Extended Thinking、Vision（多模态）

## 核心架构

### 1. 请求流程

#### OpenAI API 流程
- **入口**: `src/server/index.js` - Express 服务器，处理 `/v1/chat/completions` 和 `/v1/models` 端点
- **转换层**: `src/utils/utils.js` - 将 OpenAI 格式消息转换为 Antigravity 格式
- **API 客户端**: `src/api/client.js` - 调用 Google Antigravity API，处理流式响应
- **Token 管理**: `src/auth/token_manager.js` - 多账号轮换、自动刷新、失败处理

#### Claude API 流程
- **入口**: `src/routes/claude.js` - Claude Messages API 路由，处理 `/claude/v1/messages` 和 `/claude/v1/models` 端点
- **转换层**: `src/utils/claudeToAntigravity.js` - 双向转换 Claude Messages API 格式与 Antigravity 格式
- **API 客户端**: 复用 `src/api/client.js`，通过 `onRawLine` 回调支持自定义流式转换
- **Token 管理**: 复用现有的 Token 管理机制

### 2. 管理系统
- **管理路由**: `src/admin/routes.js` - 提供 Web 管理界面的 API
- **功能模块**:
  - `src/admin/key_manager.js` - API Key 管理和频率限制
  - `src/admin/token_admin.js` - Token 账号管理（增删改查、导入导出）
  - `src/admin/log_manager.js` - 系统日志管理
  - `src/admin/monitor.js` - 系统状态监控
  - `src/admin/session.js` - 管理员会话认证
  - `src/admin/settings_manager.js` - 系统设置管理

### 3. 关键转换逻辑

#### OpenAI 转换逻辑

**消息转换** (`src/utils/utils.js:132-146`):
- OpenAI 的 `user`/`system` 角色 → Antigravity 的 `user` 角色
- OpenAI 的 `assistant` 角色 → Antigravity 的 `model` 角色
- OpenAI 的 `tool` 角色 → Antigravity 的 `functionResponse`
- 支持多模态输入（文本 + Base64 图片）

**工具调用转换** (`src/utils/utils.js:171-184`):
- OpenAI 的 `tools` 数组 → Antigravity 的 `functionDeclarations`
- 自动处理工具调用的 ID 映射和参数转换

**思维链支持** (`src/utils/utils.js:186-192`):
- 模型名称以 `-thinking` 结尾或特定模型会启用思维链
- 在响应中包装 `<think>` 标签

#### Claude 转换逻辑

**请求转换** (`src/utils/claudeToAntigravity.js:convertClaudeRequestToAntigravity`):
- Claude `messages` → Antigravity `contents`
  - `user` 角色 → `user` 角色
  - `assistant` 角色 → `model` 角色
- Claude `system` → Antigravity `systemInstruction`
- Claude `tools` → Antigravity `functionDeclarations`
- Claude 多模态内容转换：
  - `type: "text"` → `parts[{text}]`
  - `type: "image"` → `parts[{inlineData: {mimeType, data}}]`
  - `type: "tool_use"` → `parts[{functionCall}]`
  - `type: "tool_result"` → `parts[{functionResponse}]`
- 支持 Prompt Caching：保留 `cache_control` 字段结构
- Extended Thinking：检测 `thinking` 参数并配置 `thinkingConfig`

**响应转换** (`src/utils/claudeToAntigravity.js:convertAntigravityStreamToClaude`):
- 流式：生成标准 Claude SSE 事件序列
  - `message_start` → 包含 message 元数据
  - `content_block_start` → 新内容块开始
  - `content_block_delta` → 增量内容更新
  - `content_block_stop` → 内容块结束
  - `message_delta` → 停止原因和 usage
  - `message_stop` → 流结束
- 非流式：构造完整的 Claude message 对象
- 停止原因映射：
  - Antigravity `STOP` → Claude `end_turn`
  - Antigravity `MAX_TOKENS` → Claude `max_tokens`
  - Antigravity `SAFETY` → Claude `stop_sequence`
  - 工具调用 → Claude `tool_calls`

### 4. Token 管理机制

**轮换策略** (`src/auth/token_manager.js:117-148`):
- 循环使用多个 Google 账号的 Token
- 自动检测过期并刷新（提前 5 分钟）
- 403 错误自动禁用账号并切换下一个
- 记录每个 Token 的使用统计

**数据存储**:
- `data/accounts.json` - Token 账号数据（access_token, refresh_token, expires_in, timestamp, enable）
- `data/keys.json` - API Key 数据
- `data/logs.json` - 系统日志

## 常用开发命令

```bash
# 启动服务（生产模式）
npm start

# 开发模式（自动重启）
npm run dev

# OAuth 登录获取新 Token
npm run login
```

## 配置文件

**config.json** - 主配置文件:
- `server.port` / `server.host` - 服务器监听配置
- `security.apiKey` - 主 API Key（不受频率限制）
- `security.adminPassword` - 管理后台密码
- `defaults.*` - 默认模型参数（temperature, top_p, top_k, max_tokens）
- `systemInstruction` - 系统提示词

## 安全注意事项

1. **硬编码凭证**: `src/auth/token_manager.js:9-10` 包含 Google OAuth CLIENT_ID 和 CLIENT_SECRET
2. **敏感数据**: `data/accounts.json` 包含 access_token 和 refresh_token，不应提交到版本控制
3. **API Key 验证**: 支持两层验证 - 配置文件中的主密钥和数据库中的多个密钥
4. **频率限制**: 仅对数据库中的 API Key 生效，主密钥不受限制

## API 端点

### OpenAI 兼容 API（需要 API Key）
- `GET /v1/models` - 获取可用模型列表（OpenAI 格式）
- `POST /v1/chat/completions` - 聊天补全（支持流式和非流式）

### Claude Messages API（需要 API Key）
- `GET /claude/v1/models` - 获取可用模型列表（Claude 格式）
- `POST /claude/v1/messages` - Claude 消息端点（支持流式和非流式）
  - 支持完整的 Claude Messages API 格式
  - 支持 Prompt Caching（`cache_control` 字段）
  - 支持 Extended Thinking（`thinking` 参数）
  - 支持 Vision（多模态图片）
  - 支持 Tool Use（工具调用）
- `POST /claude/v1/messages/count_tokens` - Token 计数（未实现，返回 501）

**Claude API 使用示例**：
```bash
# 非流式请求
curl -X POST 'http://localhost:8045/claude/v1/messages' \
  -H 'Authorization: Bearer YOUR_API_KEY' \
  -H 'Content-Type: application/json' \
  -d '{
    "model": "claude-sonnet-4-5",
    "max_tokens": 1024,
    "messages": [
      {"role": "user", "content": "Hello!"}
    ]
  }'

# 流式请求
curl -N -X POST 'http://localhost:8045/claude/v1/messages' \
  -H 'Authorization: Bearer YOUR_API_KEY' \
  -H 'Content-Type: application/json' \
  -d '{
    "model": "claude-sonnet-4-5",
    "max_tokens": 1024,
    "stream": true,
    "messages": [
      {"role": "user", "content": "Hello!"}
    ]
  }'
```

### 管理 API（需要管理员认证）
- `POST /admin/login` - 管理员登录
- `GET /admin/tokens` - 获取所有 Token 账号
- `POST /admin/keys/generate` - 生成新 API Key
- `GET /admin/logs` - 获取系统日志
- `GET /admin/status` - 获取系统状态

## 开发注意事项

1. **模块化原则**: 每个功能模块职责单一，避免跨模块直接访问数据
2. **错误处理**: Token 刷新失败会自动禁用账号，API 请求失败会返回详细错误信息
3. **日志记录**: 使用 `src/utils/logger.js` 统一日志格式，支持不同级别（info, warn, error）
4. **空闲管理**: `src/utils/idle_manager.js` 监控服务空闲状态，可用于自动休眠
5. **并发处理**: Token 轮换使用索引而非锁，适合高并发场景

## 扩展点

### OpenAI API 扩展
- **新增模型支持**: 修改 `src/utils/utils.js:186-192` 的思维链判断逻辑
- **自定义转换**: 修改 `src/utils/utils.js` 中的消息转换函数

### Claude API 扩展
- **新增转换规则**: 修改 `src/utils/claudeToAntigravity.js` 中的转换函数
- **自定义 SSE 事件**: 修改 `convertAntigravityStreamToClaude` 函数的事件生成逻辑
- **工具调用优化**: 扩展 `convertContentParts` 函数支持更复杂的工具调用场景
- **usage 字段映射**: 根据 Antigravity 实际返回字段调整 `mapUsage` 函数

### 通用扩展
- **新增管理功能**: 在 `src/admin/` 目录下添加新模块并注册到 `routes.js`
- **路由扩展**: 在 `src/routes/` 下添加新的 API 路由模块

## Claude Code 配置

如果您想使用 Claude Code 通过本服务访问 Antigravity，可以配置：

1. **启动服务**：`npm start`
2. **配置 Claude Code**：
   - Base URL: `http://localhost:8045/claude`
   - API Key: 配置文件中的 `security.apiKey` 或管理后台生成的密钥
3. **使用**：Claude Code 将通过本服务转发请求到 Antigravity API

**注意事项**：
- Claude Code 发送的是标准 Claude Messages API 格式
- 本服务会自动转换为 Antigravity 格式并处理响应
- 所有 Claude API 高级特性（Prompt Caching、Thinking、Vision、Tools）都得到支持
