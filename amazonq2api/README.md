# Amazon Q TS 全自动登录 - Web API 版

基于 TypeScript 的 Amazon Q OIDC 设备授权与浏览器自动化实现，提供 **Web API 接口** 进行账号注册管理。

## 快速开始

1. 安装依赖

    ```bash
    pnpm install
    # 或
    npm install
    ```

2. 配置环境变量

    ```bash
    cp .env.example .env
    # 按需填写配置项
    ```

    必要的环境变量：
    - `GPTMAIL_API_KEY`: GPTMail 临时邮箱 API Key
    - `GPTMAIL_BASE_URL`: GPTMail API 地址（默认 https://mail.chatgpt.org.uk）
    
    可选配置：
    - `PORT`: Web 服务端口（默认 3000）
    - `HEADLESS`: 是否无头模式（默认 false）
    - `HTTP_PROXY`: HTTP 代理地址
    - `PROXY_LIST`: 代理列表文件路径
    - `OUTPUT_FILE`: 账号存储文件路径（默认 output/accounts.ndjson）
    - `LOG_LEVEL`: 日志级别（debug|info|warn|error）

3. 启动 Web 服务

    ```bash
    npm start
    # 或开发模式（热重载）
    npm run dev
    ```

4. 调用 API 创建注册任务

    ```bash
    # 创建注册任务
    curl -X POST http://localhost:3000/api/register \
      -H "Content-Type: application/json" \
      -d '{"label": "测试账号"}'
    ```

## API 接口说明

### 健康检查

```
GET /health
```

返回服务状态、当前运行任务和队列长度。

### 创建注册任务

```
POST /api/register
Content-Type: application/json

{
  "label": "账号标签（可选）",
  "password": "指定密码（可选，不填自动生成）",
  "fullName": "注册用全名（可选）",
  "headless": true,
  "maxRetries": 3
}
```

**响应示例：**
```json
{
  "success": true,
  "taskId": "uuid-xxxxx",
  "message": "注册任务已创建",
  "position": 1
}
```

### 查询任务状态

```
GET /api/register/:taskId
```

**响应示例：**
```json
{
  "success": true,
  "task": {
    "id": "uuid-xxxxx",
    "status": "running",
    "createdAt": "2024-01-01T00:00:00.000Z",
    "startedAt": "2024-01-01T00:00:01.000Z",
    "label": "测试账号",
    "queuePosition": null
  }
}
```

任务状态（`status`）说明：
- `pending`: 等待执行
- `running`: 正在执行
- `completed`: 执行完成
- `failed`: 执行失败

### 列出所有任务

```
GET /api/tasks
```

### 取消等待中的任务

```
DELETE /api/register/:taskId
```

### 获取已注册账号列表

```
GET /api/accounts
```

### 获取账号详情

```
GET /api/accounts/:email
```

返回完整的账号信息，包括：
- `email`: 邮箱地址
- `password`: 密码
- `clientId`: OIDC 客户端 ID
- `clientSecret`: OIDC 客户端密钥
- `accessToken`: 访问令牌
- `refreshToken`: 刷新令牌

## 运行模式

### Web API 模式（推荐）

```bash
npm start        # 生产模式
npm run dev      # 开发模式（热重载）
```

### CLI 模式（单次执行）

```bash
npm run start:cli
```

## 目录结构

```
src/
├── server.ts          # Web API 服务入口
├── index.ts           # 核心注册逻辑
├── config.ts          # 配置管理
├── browser/           # Camoufox 浏览器自动化
├── oidc/              # OIDC 客户端、设备授权、Token
├── storage/           # NDJSON 文件存储
├── types/             # 类型定义
└── utils/             # 工具函数（日志、重试、代理）
```

## 设计要点

- **Web API 接口**：提供 RESTful API 管理注册任务
- **任务队列**：支持并发请求，任务按顺序执行
- **头部一致性**：所有 OIDC 请求使用与原版完全一致的 User-Agent
- **并行授权**：浏览器自动化与 Token 轮询并行执行
- **严格类型**：TypeScript 严格模式，完整类型定义
- **存储可靠**：NDJSON 原子追加写入
- **代理支持**：支持 HTTP 代理和代理轮换

## 注意事项

- 避免滥用，自动化登录可能违反服务条款，请自行评估
- 建议使用代理并适当间隔调用，降低风控概率
- Camoufox 初次运行会自动下载浏览器，可能需要数分钟
