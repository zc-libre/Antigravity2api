# Ki2API - Claude Sonnet 4 OpenAI/Claude 兼容API

一个简单易用的Docker化OpenAI/Claude兼容API服务，专门用于Claude Sonnet 4.5模型。

## 功能特点

- 🐳 **Docker傻瓜式运行** - 一行命令启动服务
- 🔑 **固定API密钥** - 使用 `ki2api-key-2024`
- 🎯 **多模型支持** - 支持 `claude-sonnet-4-5-20250929` 等模型
- 🌐 **OpenAI兼容** - 完全兼容OpenAI API格式 (`/v1/chat/completions`)
- 🤖 **Claude兼容** - 完全兼容Claude API格式 (`/v1/messages`)
- 📡 **流式传输** - 支持SSE流式响应
- 🔄 **自动token刷新** - 支持token过期自动刷新
- 👥 **多账号轮询** - 支持配置多个账号自动轮询
- ⚡ **速率限制故障转移** - 429错误时自动切换账号

## 快速开始

### 单账号模式（向后兼容）

只需确保已登录Kiro，然后一键启动：

```bash
docker-compose up -d
```

服务将在 http://localhost:8989 启动

### 多账号模式（推荐）

#### 方式一：使用配置文件

1. 复制示例配置文件：
```bash
cp auth_config.json.example auth_config.json
```

2. 编辑 `auth_config.json`，填入你的 refresh token：
```json
[
  {
    "refreshToken": "your_first_refresh_token",
    "name": "account_1"
  },
  {
    "refreshToken": "your_second_refresh_token",
    "name": "account_2"
  }
]
```

3. 设置环境变量指向配置文件：
```bash
export KIRO_AUTH_CONFIG=/path/to/auth_config.json
```

#### 方式二：使用环境变量

直接设置 JSON 格式的环境变量：
```bash
export KIRO_AUTH_CONFIG='[{"refreshToken":"token1","name":"account1"},{"refreshToken":"token2","name":"account2"}]'
```

### 自动读取token

容器会自动读取你本地的token文件：
- **macOS/Linux**: `~/.aws/sso/cache/kiro-auth-token.json`
- **Windows**: `%USERPROFILE%\.aws\sso\cache\kiro-auth-token.json`

### 测试API

#### 获取模型列表
```bash
curl -H "Authorization: Bearer ki2api-key-2024" \
     http://localhost:8989/v1/models
```

#### 非流式对话
```bash
curl -X POST http://localhost:8989/v1/chat/completions \
  -H "Authorization: Bearer ki2api-key-2024" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "claude-sonnet-4-5-20250929",
    "messages": [
      {"role": "user", "content": "你好，请介绍一下自己"}
    ],
    "max_tokens": 1000
  }'
```

#### 流式对话
```bash
curl -X POST http://localhost:8989/v1/chat/completions \
  -H "Authorization: Bearer ki2api-key-2024" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "claude-sonnet-4-5-20250929",
    "messages": [
      {"role": "user", "content": "写一首关于春天的诗"}
    ],
    "stream": true,
    "max_tokens": 500
  }'
```

#### Claude API 格式（/v1/messages）
```bash
curl -X POST http://localhost:8989/v1/messages \
  -H "x-api-key: ki2api-key-2024" \
  -H "anthropic-version: 2023-06-01" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "claude-sonnet-4.5",
    "max_tokens": 1024,
    "messages": [
      {"role": "user", "content": "Hello, Claude!"}
    ]
  }'
```

#### Claude API 带工具调用
```bash
curl -X POST http://localhost:8989/v1/messages \
  -H "x-api-key: ki2api-key-2024" \
  -H "anthropic-version: 2023-06-01" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "claude-sonnet-4.5",
    "max_tokens": 1024,
    "tools": [
      {
        "name": "get_weather",
        "description": "Get the current weather in a given location",
        "input_schema": {
          "type": "object",
          "properties": {
            "location": {"type": "string"}
          },
          "required": ["location"]
        }
      }
    ],
    "messages": [
      {"role": "user", "content": "What is the weather in San Francisco?"}
    ]
  }'
```

#### 查看Token状态
```bash
curl -H "Authorization: Bearer ki2api-key-2024" \
     http://localhost:8989/v1/token/status
```

#### 重置Token状态
```bash
curl -X POST -H "Authorization: Bearer ki2api-key-2024" \
     http://localhost:8989/v1/token/reset
```

## Docker使用方法

### 使用Docker Compose（推荐）
```bash
# 启动服务
docker-compose up -d

# 查看日志
docker-compose logs -f

# 停止服务
docker-compose down
```

### 使用Docker命令
```bash
# 构建镜像
docker build -t ki2api .

# 运行容器（单账号模式）
docker run -d \
  -p 8989:8989 \
  -e KIRO_ACCESS_TOKEN=your_token \
  -e KIRO_REFRESH_TOKEN=your_refresh_token \
  --name ki2api \
  ki2api

# 运行容器（多账号模式）
docker run -d \
  -p 8989:8989 \
  -e KIRO_AUTH_CONFIG='[{"refreshToken":"token1"},{"refreshToken":"token2"}]' \
  --name ki2api \
  ki2api
```

## API端点

### OpenAI 兼容端点

#### GET /v1/models
获取可用模型列表

#### POST /v1/chat/completions
创建聊天完成（OpenAI格式）

### Claude 兼容端点

#### POST /v1/messages
创建消息（Claude API格式）

支持的功能：
- 流式响应 (SSE)
- 工具调用 (Tool Use)
- 系统提示 (System Prompt)
- 图片输入 (Images)
- 多轮对话

### 管理端点

#### GET /health
健康检查端点

#### GET /v1/token/status
获取多账号Token状态（需要认证）

#### POST /v1/token/reset
重置所有Token的耗尽状态（需要认证）

## 环境变量

| 变量名 | 默认值 | 说明 |
|--------|--------|------|
| API_KEY | ki2api-key-2024 | API访问密钥 |
| KIRO_AUTH_CONFIG | - | 多账号配置（JSON字符串或文件路径） |
| KIRO_ACCESS_TOKEN | - | 单账号访问令牌（向后兼容） |
| KIRO_REFRESH_TOKEN | - | 单账号刷新令牌（向后兼容） |

## 多账号配置说明

### 配置格式

```json
[
  {
    "refreshToken": "required_refresh_token",
    "name": "optional_account_name",
    "disabled": false
  }
]
```

### 字段说明

| 字段 | 必需 | 说明 |
|------|------|------|
| refreshToken | 是 | Kiro刷新令牌 |
| name | 否 | 账号名称，用于日志标识 |
| disabled | 否 | 是否禁用此账号（默认false） |

### 轮询策略

1. 按配置顺序依次使用账号
2. 当收到 429（速率限制）错误时，自动切换到下一个账号
3. 当收到 403 错误时，尝试刷新当前账号的token
4. 如果刷新失败，切换到下一个账号
5. 所有账号都不可用时返回错误

## 开发模式

### 本地运行
```bash
# 安装依赖
pip install -r requirements.txt

# 设置环境变量（单账号模式）
export KIRO_ACCESS_TOKEN=your_token
export KIRO_REFRESH_TOKEN=your_refresh_token

# 或者设置多账号配置
export KIRO_AUTH_CONFIG='[{"refreshToken":"token1"},{"refreshToken":"token2"}]'

# 启动服务
python app.py
```

## 故障排除

### 常见问题

1. **Token过期**
   - 确保refresh token有效
   - 重新获取最新的token

2. **连接失败**
   - 检查端口8989是否被占用
   - 确认Docker容器正常运行

3. **API返回401**
   - 确认使用了正确的API密钥：`ki2api-key-2024`
   - 检查token是否有效

4. **API返回429（速率限制）**
   - 配置多个账号实现自动故障转移
   - 等待一段时间后重试

### 查看日志
```bash
# Docker日志
docker-compose logs -f ki2api

# 本地日志
python app.py 2>&1 | tee ki2api.log
```

## 项目结构
```
kiro2api/
├── app.py                        # 主应用文件
├── config.py                     # 配置文件
├── auth/
│   ├── __init__.py
│   ├── api_key.py               # API密钥验证
│   ├── config.py                # 多账号配置加载
│   └── token_manager.py         # 多账号Token管理器
├── models/
│   ├── schemas.py               # OpenAI兼容数据模型
│   └── claude_schemas.py        # Claude API数据模型
├── services/
│   ├── request_builder.py       # OpenAI请求构建
│   ├── response_handler.py      # OpenAI响应处理
│   ├── claude_converter.py      # Claude请求转换器
│   └── claude_stream_handler.py # Claude流处理器
├── parsers/                      # 解析器
├── auth_config.json.example     # 多账号配置示例
├── Dockerfile                   # Docker镜像定义
├── docker-compose.yml           # Docker Compose配置
├── requirements.txt             # Python依赖
└── README.md                    # 本文档
```

## 许可证

MIT License
