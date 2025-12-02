# AI2API - 统一 AI API 代理平台

一个集成多种 AI 服务的统一 API 代理平台，提供 OpenAI 兼容的 API 接口。

## 🎯 包含服务

| 服务 | 端口 | 描述 |
|------|------|------|
| **Frontend** | 80 | React 前端 + Nginx 反向代理 |
| **Antigravity** | 8045 | Claude API 代理服务 |
| **Amazon Q** | 3000 | Amazon Q 开发者版 API 代理 |
| **Kiro** | 8989 | Kiro (AWS) API 代理 |

## 🚀 快速开始

### 1. 配置环境变量

```bash
# 复制环境变量模板
cp .env.example .env

# 编辑配置
vim .env
```

### 2. 配置各服务

```bash
# Antigravity 需要配置 config.json
cp antigravity/config.example.json antigravity/config.json
vim antigravity/config.json
```

### 3. 启动所有服务

```bash
# 构建并启动所有服务
docker compose up -d --build

# 查看服务状态
docker compose ps

# 查看日志
docker compose logs -f
```

### 4. 访问服务

- **前端管理界面**: http://localhost
- **Antigravity API**: http://localhost:8045
- **Amazon Q API**: http://localhost:3000
- **Kiro API**: http://localhost:8989

## 📦 单独启动服务

```bash
# 只启动 Antigravity
docker compose up -d antigravity

# 启动 Antigravity + 前端
docker compose up -d antigravity frontend

# 只启动 Kiro
docker compose up -d kiro2api
```

## 🔧 服务管理

```bash
# 停止所有服务
docker compose down

# 重启某个服务
docker compose restart amazonq2api

# 重新构建某个服务
docker compose up -d --build kiro2api

# 查看某个服务的日志
docker compose logs -f antigravity

# 进入容器
docker compose exec kiro2api /bin/sh
```

## 🌐 API 端点

### 通过前端 Nginx 代理访问

| 路径前缀 | 目标服务 | 示例 |
|----------|----------|------|
| `/antigravity/api/*` | Antigravity | `/antigravity/api/v1/chat/completions` |
| `/amazonq/api/*` | Amazon Q | `/amazonq/api/accounts` |
| `/amazonq/health` | Amazon Q | 健康检查 |
| `/kiro/api/*` | Kiro | `/kiro/api/accounts` |
| `/kiro/v1/*` | Kiro | `/kiro/v1/chat/completions` |
| `/kiro/health` | Kiro | 健康检查 |

### 直接访问各服务 API

```bash
# Antigravity - Claude API
curl http://localhost:8045/v1/chat/completions \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model": "claude-sonnet-4-20250514", "messages": [{"role": "user", "content": "Hello"}]}'

# Kiro API
curl http://localhost:8989/v1/chat/completions \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model": "kiro", "messages": [{"role": "user", "content": "Hello"}]}'

# Amazon Q API
curl http://localhost:3000/v1/chat/completions \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model": "amazon-q", "messages": [{"role": "user", "content": "Hello"}]}'
```

## 📁 目录结构

```
ai2api/
├── docker-compose.yml      # 统一 Docker Compose 配置
├── .env.example            # 环境变量模板
├── frontend/               # React 前端
│   ├── Dockerfile
│   ├── nginx.conf
│   └── src/
├── antigravity/            # Claude API 代理
│   ├── Dockerfile
│   ├── config.json
│   └── src/
├── amazonq2api/            # Amazon Q API 代理
│   ├── Dockerfile
│   └── src/
└── kiro2api/               # Kiro API 代理
    ├── Dockerfile
    └── *.py
```

## 🔐 安全建议

1. **修改默认密码**: 确保修改 `.env` 中的 `POSTGRES_PASSWORD`
2. **API 密钥**: 为各服务配置 API 认证密钥
3. **防火墙**: 生产环境建议只暴露前端端口 (80)，其他服务通过内部网络访问
4. **HTTPS**: 生产环境建议配置 SSL/TLS

## 📝 注意事项

- **PostgreSQL**: Amazon Q 服务依赖 PostgreSQL 数据库
- **数据持久化**: 数据保存在 Docker 卷中，使用 `docker compose down -v` 会删除数据
- **首次启动**: 首次启动可能需要较长时间来构建镜像
- **资源需求**: Amazon Q 服务需要至少 2GB 内存

## 🐛 故障排除

```bash
# 检查服务健康状态
docker compose ps

# 查看详细日志
docker compose logs --tail=100 服务名

# 检查网络连接
docker compose exec frontend ping kiro2api

# 重建所有镜像
docker compose build --no-cache
```

## 📄 License

MIT

