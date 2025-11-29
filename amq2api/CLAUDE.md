# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

Amazon Q to Claude API Proxy - 将 Claude API 请求转换为 Amazon Q/CodeWhisperer 请求的代理服务。

## 核心架构

### 请求流程
```
Claude API 请求 → main.py → converter.py → Amazon Q API
                     ↓
                 auth.py (Token 管理)
                     ↓
Amazon Q Event Stream → event_stream_parser.py → parser.py → stream_handler_new.py → Claude SSE 响应
```

### 关键模块职责

- **main.py**: FastAPI 服务器,处理 `/v1/messages` 端点
- **converter.py**: 请求格式转换 (Claude → Amazon Q)
- **event_stream_parser.py**: 解析 AWS Event Stream 二进制格式
- **parser.py**: 事件类型转换 (Amazon Q → Claude)
- **stream_handler_new.py**: 流式响应处理和事件生成
- **message_processor.py**: 历史消息合并,确保 user-assistant 交替
- **auth.py**: Token 自动刷新机制
- **config.py**: 配置管理和 Token 缓存
- **models.py**: 数据结构定义

## 常用命令

### 启动服务
```bash
# 使用启动脚本(推荐)
./start.sh

# 或直接运行
python3 main.py
```

### 测试
```bash
# 运行所有测试
pytest

# 运行特定测试
pytest test_basic.py
pytest test_tool_use.py
pytest test_message_merging.py
```

### 健康检查
```bash
curl http://localhost:8080/health
```

## 关键技术细节

### Event Stream 格式
Amazon Q 返回 **AWS Event Stream 二进制格式**,不是标准 SSE:
- Prelude (12 bytes): total_length, headers_length, prelude_crc
- Headers: 键值对 (`:event-type`, `:content-type`, `:message-type`)
- Payload: JSON 数据
- Message CRC (4 bytes)

**重要**: 必须使用 `response.aiter_bytes()` 而非 `response.aiter_lines()`

### 模型映射
- `claude-sonnet-4.5` 或 `claude-sonnet-4-5` → `claude-sonnet-4.5`
- 其他所有模型 → `claude-sonnet-4`

### 工具描述限制
Amazon Q 的 `description` 字段限制 10240 字符。超长描述会:
1. 截断到 10100 字符
2. 添加提示: "...(Full description provided in TOOL DOCUMENTATION section)"
3. 完整描述添加到请求 content 的 TOOL DOCUMENTATION 部分

### 消息处理规则
1. **历史消息必须严格交替**: user → assistant → user → assistant
2. **连续用户消息会自动合并**: `message_processor.py` 处理
3. **tool_result 格式转换**: Claude 格式 → Amazon Q 格式 (`[{"text": "..."}]`)
4. **图片内容处理**:
   - Claude `type: image` 内容块自动提取并转换
   - 支持 currentMessage 和 history 中的图片
   - 格式转换: `media_type: "image/png"` → `format: "png"`

### Token 管理
- Token 缓存在 `~/.amazonq_token_cache.json`
- 提前 5 分钟自动刷新
- refresh_token 更新时自动保存到 `.env`

## 环境变量

必需:
- `AMAZONQ_REFRESH_TOKEN`: Amazon Q 刷新令牌
- `AMAZONQ_CLIENT_ID`: 客户端 ID
- `AMAZONQ_CLIENT_SECRET`: 客户端密钥

可选:
- `AMAZONQ_PROFILE_ARN`: Profile ARN (组织账号)
- `PORT`: 服务端口 (默认 8080)
- `AMAZONQ_API_ENDPOINT`: API 端点
- `AMAZONQ_TOKEN_ENDPOINT`: Token 端点

## 调试技巧

### 查看请求转换
在 `main.py:169` 有完整请求体日志输出

### 查看事件流
在 `stream_handler_new.py:94` 记录所有 Amazon Q 事件类型

### 查看历史消息处理
在 `main.py:116-127` 记录原始和处理后的历史消息摘要

## 常见问题

### Tool Use 事件处理
- `toolUseEvent` 通过流式传输 input 片段
- 需要累积所有片段直到收到 `stop: true`
- 去重机制防止重复处理相同 `toolUseId`

### Content-Type 要求
必须使用 `application/x-amz-json-1.0`,不能用 `application/json`

### 请求头要求
`X-Amz-Target: AmazonCodeWhispererStreamingService.GenerateAssistantResponse` 必须存在

## 代码修改注意事项

1. **修改事件处理**: 同时更新 `parser.py` 和 `stream_handler_new.py`
2. **修改请求转换**: 更新 `converter.py` 和对应的测试文件
3. **修改数据结构**: 更新 `models.py` 中的 dataclass
4. **添加新事件类型**: 在 `parse_amazonq_event()` 添加解析逻辑

## 参考文档

- API 详细说明: `API_DETAILS.md`
- 变更日志: `CHANGELOG.md`
- 使用说明: `README.md`
