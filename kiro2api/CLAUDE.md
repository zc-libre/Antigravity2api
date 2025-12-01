# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

高性能 AI API 代理服务器，桥接 Anthropic/OpenAI API 与 AWS CodeWhisperer。支持流式响应、工具调用、多账号池管理。

## 代码探索规范

**⚠️ 强制要求：优先使用 Serena MCP 工具进行代码探索和编辑**

- **代码探索**: 使用 `mcp__serena__get_symbols_overview` 获取文件概览，然后使用 `mcp__serena__find_symbol` 精确读取符号
- **代码搜索**: 使用 `mcp__serena__search_for_pattern` 进行模式搜索
- **代码编辑**: 使用 `mcp__serena__replace_symbol_body`、`insert_after_symbol`、`insert_before_symbol` 进行符号级编辑
- **依赖分析**: 使用 `mcp__serena__find_referencing_symbols` 查找引用关系

**禁止**: 直接使用 `Read` 工具读取整个 Go 源代码文件，除非是配置文件（`.json`、`.yaml`、`.env`）或文档文件（`.md`）。

## 开发命令

```bash
# 编译和运行
go build -o kiro2api main.go
./kiro2api

# 测试
go test ./...                          # 运行所有测试
go test ./parser -v                    # 单包测试(详细输出)
go test ./... -bench=. -benchmem       # 基准测试

# 代码质量
go vet ./...                           # 静态检查
go fmt ./...                           # 格式化
golangci-lint run                      # Linter

# 运行模式
GIN_MODE=debug LOG_LEVEL=debug ./kiro2api  # 开发模式
GIN_MODE=release ./kiro2api                # 生产模式

# 生产构建
go build -ldflags="-s -w" -o kiro2api main.go
```

## 技术栈

- **Go**: 1.24.0
- **Web**: gin-gonic/gin v1.11.0
- **JSON**: bytedance/sonic v1.14.1

## 核心架构

**请求流程**：认证 → 请求分析 → 格式转换 → 流处理 → 响应转换

**包职责**：
- `server/` - HTTP 服务器、路由、处理器、中间件
- `converter/` - API 格式转换（Anthropic ↔ OpenAI ↔ CodeWhisperer）
- `parser/` - EventStream 解析、工具调用处理、会话管理
- `auth/` - Token 管理（顺序选择策略、并发控制、使用限制监控）
- `utils/` - 请求分析、Token 估算、HTTP 工具
- `types/` - 数据结构定义
- `logger/` - 结构化日志
- `config/` - 配置常量和模型映射

**关键实现**：
- Token 管理：顺序选择策略，支持 Social/IdC 双认证
- 流式优化：零延迟传输，直接内存分配（已移除对象池）
- 智能超时：根据 MaxTokens、内容长度、工具使用动态调整
- EventStream 解析：`CompliantEventStreamParser`（BigEndian 格式）

## 开发原则

**内存管理**：
- 已移除 `sync.Pool` 对象池（KISS + YAGNI）
- 直接使用 `bytes.NewBuffer(nil)`、`strings.Builder`、`make([]byte, size)`
- 信任 Go 1.24 GC 和逃逸分析
- 仅在 QPS > 1000 且对象 > 10KB 时考虑对象池

**代码质量**：
- 遵循 KISS、YAGNI、DRY、SOLID 原则
- 避免过度抽象和预先优化
- 定期清理死代码和未使用功能
- 所有包测试通过率 100%

**最近重构**（2025-10）：
- 删除 1101 行死代码（6.8%）
- 简化配置管理（`config/constants.go`、`config/tuning.go`）
- 修复并发测试问题

详见 memory: `refactoring_dead_code_removal_2025_10_08`

## 环境配置

详见 `.env.example` 和 `auth_config.json.example`。

**Token 配置方式**：
- JSON 字符串：`KIRO_AUTH_TOKEN='[{"auth":"Social","refreshToken":"xxx"}]'`
- 文件路径：`KIRO_AUTH_TOKEN=/path/to/auth_config.json`（推荐）

**配置字段**：`auth`（Social/IdC）、`refreshToken`、`clientId`、`clientSecret`、`disabled`

**关键环境变量**：
- `KIRO_CLIENT_TOKEN` - API 认证密钥
- `PORT` - 服务端口（默认 8080）
- `LOG_LEVEL` - 日志级别（debug/info/warn/error）
- `LOG_FORMAT` - 日志格式（text/json）

## 快速测试

```bash
# 启动服务
./kiro2api

# 测试 API
curl -X POST http://localhost:8080/v1/messages \
  -H "Authorization: Bearer 123456" \
  -H "Content-Type: application/json" \
  -d '{"model":"claude-sonnet-4-20250514","max_tokens":100,"messages":[{"role":"user","content":"测试"}]}'
```
