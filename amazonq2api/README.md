# Amazon Q TS 全自动登录 - Web API 版

基于 TypeScript 的 Amazon Q OIDC 设备授权与浏览器自动化实现，提供 **Web API 接口** 进行账号注册管理。

## 快速开始

### 1. 安装依赖

```bash
pnpm install
# 或
npm install
```

### 2. 配置数据库

本项目使用 PostgreSQL 数据库存储账号数据。

**方式一：使用 Docker Compose（推荐）**

```bash
# 启动 PostgreSQL 和应用服务
docker compose up -d
```

**方式二：使用现有 PostgreSQL 实例**

设置 `DATABASE_URL` 环境变量：

```bash
export DATABASE_URL="postgresql://user:password@localhost:5432/amazonq?schema=public"
```

### 3. 初始化数据库

```bash
# 推送 schema 到数据库
pnpm run db:push

# 或使用迁移（生产环境推荐）
pnpm run db:migrate
```

### 4. 配置环境变量

创建 `.env` 文件并配置以下变量：

```bash
# 数据库配置（必需）
DATABASE_URL=postgresql://amazonq:amazonq_secret@localhost:5432/amazonq?schema=public

# GPTMail 配置（自动注册必需）
GPTMAIL_API_KEY=your-api-key
GPTMAIL_BASE_URL=https://mail.chatgpt.org.uk

# 可选配置
PORT=3000
HEADLESS=false
LOG_LEVEL=info
API_KEY=your-optional-api-key
```

### 5. 启动服务

```bash
pnpm start
# 或开发模式（热重载）
pnpm run dev
```

### 6. 数据迁移（从旧版本升级）

如果之前使用文件存储（accounts.ndjson），可以迁移数据到数据库：

```bash
# 迁移 output/accounts.ndjson 中的数据
pnpm run migrate:data output/accounts.ndjson
```

## 环境变量说明

| 变量名 | 说明 | 必需 | 默认值 |
|--------|------|------|--------|
| `DATABASE_URL` | PostgreSQL 连接字符串 | 是 | - |
| `PORT` | Web 服务端口 | 否 | `3000` |
| `HEADLESS` | 无头浏览器模式 | 否 | `false` |
| `LOG_LEVEL` | 日志级别 (debug/info/warn/error) | 否 | `info` |
| `API_KEY` | API 访问密钥（不设置则无需验证） | 否 | - |
| `GPTMAIL_API_KEY` | GPTMail API 密钥 | 自动注册必需 | - |
| `GPTMAIL_BASE_URL` | GPTMail API 地址 | 否 | `https://mail.chatgpt.org.uk` |
| `HTTP_PROXY` | HTTP 代理地址 | 否 | - |

## API 接口说明

### 健康检查

```
GET /health
```

返回服务状态、数据库连接状态和账号统计。

### 账号管理

#### 获取账号列表

```
GET /api/accounts
```

#### 获取账号详情

```
GET /api/accounts/:id
```

支持按 ID 或邮箱查询。

#### 更新账号

```
PATCH /api/accounts/:id
Content-Type: application/json

{
  "enabled": true,
  "label": "新标签"
}
```

#### 删除账号

```
DELETE /api/accounts/:id
```

### 注册任务

#### 创建注册任务

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

#### 查询任务状态

```
GET /api/register/:taskId
```

任务状态说明：
- `pending`: 等待执行
- `running`: 正在执行
- `completed`: 执行完成
- `failed`: 执行失败

#### 获取任务日志（支持 SSE）

```
GET /api/register/:taskId/logs
Accept: text/event-stream  # 实时推送
```

#### 列出所有任务

```
GET /api/tasks
```

#### 取消任务

```
DELETE /api/register/:taskId
```

### Claude API 代理

#### 发送消息

```
POST /v1/messages
Content-Type: application/json
x-api-key: your-api-key  # 如果设置了 API_KEY

{
  "model": "claude-sonnet-4.5",
  "messages": [...]
}
```

#### 列出模型

```
GET /v1/models
```

## 数据库命令

```bash
# 生成 Prisma Client
pnpm run db:generate

# 开发环境迁移
pnpm run db:migrate

# 生产环境迁移
pnpm run db:migrate:prod

# 推送 schema（不生成迁移文件）
pnpm run db:push

# 打开 Prisma Studio
pnpm run db:studio

# 迁移旧数据
pnpm run migrate:data [ndjson文件路径]
```

## Docker 部署

### 使用 Docker Compose（推荐）

1. 创建 `.env` 文件：

```bash
# PostgreSQL 配置
POSTGRES_USER=amazonq
POSTGRES_PASSWORD=amazonq_secret
POSTGRES_DB=amazonq

# 应用配置
PORT=3000
HEADLESS=true
LOG_LEVEL=info
GPTMAIL_API_KEY=your-api-key
```

2. 启动服务：

```bash
docker compose up -d
```

3. 查看日志：

```bash
docker compose logs -f amazonq2api
```

4. 运行数据库迁移：

```bash
docker compose exec amazonq2api npx prisma migrate deploy
```

### 数据持久化

数据库数据存储在 Docker 卷 `amazonq2api-postgres-data` 中。

## 目录结构

```
src/
├── server.ts              # Web API 服务入口
├── index.ts               # 核心注册逻辑
├── config.ts              # 配置管理
├── browser/               # Camoufox 浏览器自动化
├── oidc/                  # OIDC 客户端、设备授权、Token
├── proxy/                 # Claude API 代理
│   ├── account-manager.ts # 账号管理（使用 Prisma）
│   ├── auth.ts            # 认证和 Token 刷新
│   └── ...
├── storage/
│   ├── prisma-store.ts    # Prisma 数据库存储层
│   └── file-store.ts      # 旧版文件存储（已弃用）
├── types/                 # 类型定义
└── utils/                 # 工具函数
prisma/
└── schema.prisma          # 数据库模型定义
scripts/
└── migrate-data.ts        # 数据迁移脚本
```

## 注意事项

- 避免滥用，自动化登录可能违反服务条款，请自行评估
- 建议使用代理并适当间隔调用，降低风控概率
- Camoufox 初次运行会自动下载浏览器，可能需要数分钟
- **Docker 部署必须使用无头模式** (`HEADLESS=true`)
- 数据库密码请在生产环境中使用强密码
