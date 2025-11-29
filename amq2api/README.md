# Amazon Q to Claude API Proxy

将 Claude API 请求转换为 Amazon Q/CodeWhisperer 请求的代理服务。

## 功能特性

- ✅ 完整的 Claude API 兼容接口
- ✅ 多账号管理和负载均衡
- ✅ 支持 Amazon Q 和 Gemini 双后端
- ✅ 自动 Token 刷新机制（JWT 过期检测）
- ✅ 账号封禁自动检测和禁用
- ✅ Web 管理界面（账号管理、批量导入/导出、健康检查）
- ✅ Gemini OAuth 凭证自动获取工具
- ✅ SSE 流式响应支持
- ✅ 请求/响应格式自动转换
- ✅ 完善的错误处理和日志

## 架构说明

### 请求流程
```
Claude API 请求 → main.py → converter.py → Amazon Q API
                     ↓
                 auth.py (Token 管理)
                     ↓
Amazon Q Event Stream → event_stream_parser.py → parser.py → stream_handler_new.py → Claude SSE 响应
```

### 核心模块

- **main.py** - FastAPI 服务器,处理 `/v1/messages` 和管理 API 端点
- **account_manager.py** - 多账号管理（SQLite 数据库）
- **auth.py** - Amazon Q Token 自动刷新机制（JWT 过期检测）
- **converter.py** - 请求格式转换 (Claude → Amazon Q)
- **event_stream_parser.py** - 解析 AWS Event Stream 二进制格式
- **parser.py** - 事件类型转换 (Amazon Q → Claude)
- **stream_handler_new.py** - 流式响应处理和事件生成
- **message_processor.py** - 历史消息合并,确保 user-assistant 交替
- **config.py** - 配置管理和 Token 缓存
- **models.py** - 数据结构定义
- **frontend/index.html** - Web 管理界面
- **gemini/** - Gemini 模块
  - **auth.py** - Gemini Token 管理
  - **converter.py** - 请求格式转换 (Claude → Gemini)
  - **handler.py** - Gemini 流式响应处理
  - **models.py** - Gemini 数据模型
- **gemini_oauth_client.py** - Gemini OAuth 凭证获取工具（独立脚本）

## 快速开始

### 使用 Docker（推荐）

```bash
# 1. 配置环境变量
cp .env.example .env
# 编辑 .env 填入你的 Amazon Q 凭证

# 2. 启动服务
docker compose up -d

# 3. 验证
curl http://localhost:8080/health
```

📖 **详细的 Docker 部署文档：[DOCKER_DEPLOY.md](DOCKER_DEPLOY.md)**

### 本地部署

#### 1. 安装依赖

```bash
# 创建虚拟环境
python3 -m venv venv

# 激活虚拟环境
source venv/bin/activate  # Linux/Mac
# 或
venv\Scripts\activate  # Windows

# 安装依赖
pip install -r requirements.txt
```

#### 2. 配置环境变量

```bash
# 复制配置模板
cp .env.example .env

# 编辑 .env 文件，填写以下信息：
# - AMAZONQ_REFRESH_TOKEN: 你的 Amazon Q refresh token
# - AMAZONQ_CLIENT_ID: 客户端 ID
# - AMAZONQ_CLIENT_SECRET: 客户端密钥
# - AMAZONQ_PROFILE_ARN: Profile ARN（组织账号需要，个人账号留空）
# - PORT: 服务端口（默认 8080）
```

#### 3. 启动服务

```bash
# 使用启动脚本（推荐）
chmod +x start.sh
./start.sh

# 或直接运行
python3 main.py
```

#### 4. 测试服务

```bash
# 健康检查
curl http://localhost:8080/health

# 发送测试请求
curl -X POST http://localhost:8080/v1/messages \
  -H "Content-Type: application/json" \
  -d '{
    "model": "claude-sonnet-4.5",
    "messages": [
      {
        "role": "user",
        "content": "Hello, how are you?"
      }
    ],
    "max_tokens": 1024,
    "stream": true
  }'
```

## 配置说明

### 环境变量

| 变量名 | 必需 | 默认值 | 说明 |
|--------|------|--------|------|
| `AMAZONQ_REFRESH_TOKEN` | ✅ | - | Amazon Q 刷新令牌 |
| `AMAZONQ_CLIENT_ID` | ✅ | - | 客户端 ID |
| `AMAZONQ_CLIENT_SECRET` | ✅ | - | 客户端密钥 |
| `AMAZONQ_PROFILE_ARN` | ❌ | 空 | Profile ARN（组织账号） |
| `PORT` | ❌ | 8080 | 服务监听端口 |
| `AMAZONQ_API_ENDPOINT` | ❌ | https://q.us-east-1.amazonaws.com/ | API 端点 |
| `AMAZONQ_TOKEN_ENDPOINT` | ❌ | https://oidc.us-east-1.amazonaws.com/token | Token 端点 |

## Gemini OAuth 凭证获取

### 使用独立脚本获取凭证

项目提供了独立的 OAuth 客户端脚本，用于获取 Gemini 的 OAuth 凭证：

```bash
# 安装依赖
pip install aiohttp httpx

# 运行脚本
python3 gemini_oauth_client.py
```

**脚本功能：**
1. 自动启动本地回调服务器（端口 63902）
2. 自动打开浏览器进行 Google 授权
3. 接收授权码并交换 tokens
4. 打印完整凭证信息（client_id、client_secret、refresh_token）
5. 可选保存到 `gemini_credentials.json` 文件

**获取到的凭证可用于：**
- 在 Web 管理界面创建 Gemini 账号
- 通过 API 添加 Gemini 账号（`type: "gemini"`）

### Gemini 账号配置

创建 Gemini 账号时需要提供：

```json
{
  "label": "Gemini 账号 1",
  "clientId": "xxxxxxxxxxxxxxxxxxxxxx.apps.googleusercontent.com",
  "clientSecret": "GOCSPX-xxxxxxxxxxxxxxxxxxxxxx",
  "refreshToken": "从 OAuth 流程获取的 refresh_token",
  "type": "gemini",
  "enabled": true
}
```

## 多账号管理

### Web 管理界面

访问 `http://localhost:8080/admin` 打开 Web 管理界面。

**⚠️ 管理页面鉴权：**

为了保护管理页面不被未授权访问，建议在 `.env` 文件中设置 `ADMIN_KEY`：

```bash
# .env
ADMIN_KEY=your_secret_admin_key_here
```

设置后，访问管理页面需要在 URL 中添加密钥参数：

```
http://localhost:8080/admin?key=your_secret_admin_key_here
```

如果不设置 `ADMIN_KEY`，管理页面将无需鉴权即可访问（仅适用于本地开发）。

**管理界面功能：**

- ✅ 账号列表查看（显示启用状态、Token 状态、封禁状态）
- ✅ 创建/编辑/删除账号
- ✅ 批量导入/导出账号
- ✅ 手动刷新 Token
- ✅ 测试所有启用账号
- ✅ 健康检查（实际调用 API 验证可用性）

### Gemini 投喂站

访问 `http://localhost:8080/donate` 打开 Gemini 投喂站页面。

**功能特性：**

- 🎁 一键投喂 Gemini 账号（通过 Google OAuth 授权）
- 📊 实时显示总 Credits、活跃账号数、总账号数
- 📋 账号列表展示（额度、重置时间、项目 ID、添加时间）
- 🔄 自动刷新（每 30 秒）
- ✅ 自动证账号可用性（获取项目 ID）
- 💾 自动导入到数据库

**投喂流程：**

1. 访问投喂站页面
2. 点击"投喂我的 Gemini 账号"按钮
3. 在 Google OAuth 页面授权
4. 系统自动验证账号并导入数据库
5. 重定向回投喂站，显示成功消息

**注意事项：**

- 投喂站使用固定的 Google OAuth Client ID 和 Secret
- 账号会自动添加到数据库，类型为 `gemini`
- 需要设置 `BASE_URL` 环境变量（生产环境）以确保 OAuth 回调正确

### 账号管理 API

#### GET /v2/accounts
列出所有账号

#### POST /v2/accounts
创建新账号

**请求体（Amazon Q）：**
```json
{
  "label": "账号标签",
  "clientId": "client_id",
  "clientSecret": "client_secret",
  "refreshToken": "refresh_token",
  "accessToken": "access_token",
  "type": "amazonq",
  "enabled": true
}
```

**请求体（Gemini）：**
```json
{
  "label": "Gemini 账号",
  "clientId": "xxxxxxxxxxxxxxxxxxxxxxxxxx.apps.googleusercontent.com",
  "clientSecret": "GOCSPX-xxxxxxxxxxxxxxxxxxxxx",
  "refreshToken": "从 OAuth 获取的 refresh_token",
  "type": "gemini",
  "enabled": true,
  "other": {
    "project": "your-gcp-project-id",
    "api_endpoint": "https://daily-cloudcode-pa.sandbox.googleapis.com"
  }
}
```

#### PATCH /v2/accounts/{account_id}
更新账号信息

#### DELETE /v2/accounts/{account_id}
删除账号

#### POST /v2/accounts/{account_id}/refresh
手动刷新账号 Token

### 账号封禁检测

系统会自动检测账号封禁状态（`TEMPORARILY_SUSPENDED` 错误）：

- ✅ 实时检测：API 请求返回 403 错误时自动检测
- ✅ 主动检测：健康检查时验证账号可用性
- ✅ 自动禁用：检测到封号后自动禁用账号
- ✅ 封禁信息：记录封禁时间和原因到数据库
- ✅ 前端显示：管理界面显示封禁警告

## API 接口

### POST /v1/messages

创建消息（Claude API 兼容，使用 Amazon Q 后端）

**请求体：**

```json
{
  "model": "claude-sonnet-4.5",
  "messages": [
    {
      "role": "user",
      "content": "你好"
    }
  ],
  "max_tokens": 4096,
  "temperature": 0.7,
  "stream": true,
  "system": "你是一个有帮助的助手"
}
```

**响应：**

流式 SSE 响应，格式与 Claude API 完全兼容。

### POST /v1/gemini/messages

创建消息（Claude API 兼容，使用 Gemini 后端）

**请求体：**

```json
{
  "model": "claude-sonnet-4.5",
  "messages": [
    {
      "role": "user",
      "content": "你好"
    }
  ],
  "max_tokens": 4096,
  "temperature": 0.7,
  "stream": true,
  "system": "你是一个有帮助的助手"
}
```

**请求头（可选）：**
- `X-Account-ID`: 指定使用的 Gemini 账号 ID（不指定则随机选择）

**响应：**

流式 SSE 响应，格式与 Claude API 完全兼容。

### GET /health

健康检查端点（实际调用 API 验证账号可用性）

**响应：**

```json
{
  "status": "healthy",
  "enabled_accounts": 3,
  "total_accounts": 5,
  "tested_account": "账号标签"
}
```

### GET /admin

Web 管理界面

## 工作流程

```
Claude Code 客户端
    ↓
    ↓ Claude API 格式请求
    ↓
代理服务 (main.py)
    ↓
    ├─→ 认证 (auth.py)
    │   └─→ 刷新 Token（如需要）
    ↓
    ├─→ 转换请求 (converter.py)
    │   └─→ Claude 格式 → CodeWhisperer 格式
    ↓
    ├─→ 发送到 Amazon Q API
    ↓
    ├─→ 接收 SSE 流
    ↓
    ├─→ 解析事件 (parser.py)
    │   └─→ CodeWhisperer 事件 → Claude 事件
    ↓
    ├─→ 流处理 (stream_handler.py)
    │   └─→ 累积响应、计算 tokens
    ↓
    └─→ 返回 Claude 格式 SSE 流
        ↓
Claude Code 客户端
```

## 注意事项

1. **Token 管理**
   - access_token 会自动刷新
   - 提前 5 分钟刷新以避免过期
   - refresh_token 如果更新会自动保存

2. **流式响应**
   - 当前仅支持流式响应（stream=true）
   - 非流式响应暂未实现

3. **Token 计数**
   - 使用简化的 token 计数（约 4 字符 = 1 token）
   - 建议集成 Anthropic 官方 tokenizer 以获得准确计数

4. **错误处理**
   - 所有错误都会记录到日志
   - HTTP 错误会返回适当的状态码
   - 上游 API 错误会透传给客户端

## 开发说明

### 项目结构

```
amq2api/
├── .env.example              # 环境变量模板
├── .gitignore               # Git 忽略文件
├── README.md                # 使用说明
├── DOCKER_DEPLOY.md         # Docker 部署文档
├── Dockerfile               # Docker 镜像构建
├── docker-compose.yml       # Docker Compose 配置
├── requirements.txt         # Python 依赖
├── start.sh                # 启动脚本
├── config.py               # 配置管理
├── auth.py                 # Amazon Q 认证模块
├── account_manager.py      # 多账号管理
├── models.py               # 数据结构
├── converter.py            # Amazon Q 请求转换
├── parser.py               # Amazon Q 事件解析
├── event_stream_parser.py  # AWS Event Stream 解析
├── stream_handler_new.py   # Amazon Q 流处理
├── message_processor.py    # 消息处理
├── main.py                 # 主服务
├── frontend/
│   └── index.html         # Web 管理界面
├── gemini/                 # Gemini 模块
│   ├── __init__.py
│   ├── auth.py            # Gemini Token 管理
│   ├── converter.py       # Gemini 请求转换
│   ├── handler.py         # Gemini 流处理
│   └── models.py          # Gemini 数据模型
└── gemini_oauth_client.py  # Gemini OAuth 凭证获取工具
```

### 扩展功能

如需添加新功能，可以：

1. **添加新的事件类型**
   - 在 `models.py` 中定义新的事件结构
   - 在 `parser.py` 中添加解析逻辑
   - 在 `stream_handler.py` 中添加处理逻辑

2. **支持非流式响应**
   - 在 `main.py` 中实现非流式响应逻辑
   - 累积完整响应后一次性返回

3. **添加缓存**
   - 实现对话历史缓存
   - 减少重复请求

## 故障排查

### 问题：Token 刷新失败

**解决方案：**
- 检查 `AMAZONQ_REFRESH_TOKEN` 是否正确
- 检查 `AMAZONQ_CLIENT_ID` 和 `AMAZONQ_CLIENT_SECRET` 是否正确
- 查看日志中的详细错误信息

### 问题：上游 API 返回错误

**解决方案：**
- 检查 `AMAZONQ_API_ENDPOINT` 是否正确
- 检查网络连接
- 查看日志中的详细错误信息

### 问题：流式响应中断

**解决方案：**
- 检查网络稳定性
- 增加超时时间（在 `main.py` 中调整 `timeout` 参数）
- 查看日志中的错误信息

## 许可证

MIT License

## 贡献

欢迎提交 Issue 和 Pull Request！
