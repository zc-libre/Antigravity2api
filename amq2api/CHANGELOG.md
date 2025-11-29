# 更新日志

## 2025-11-09 - System Prompt 处理 + Token 统计优化

### 重大修复

1. **System Prompt 数组格式支持**
   - 修复 system prompt 为数组格式时的解析问题
   - 正确提取数组中所有文本块的内容
   - 确保 TodoWrite 等工具使用指令被正确传递给模型

2. **Token 统计优化**
   - 使用 tiktoken 精确计算 token 数量
   - 支持小模型返回 `input_tokens=0` 避免累积
   - 通过环境变量 `ZERO_INPUT_TOKEN_MODELS` 自定义小模型列表
   - 修复 tool_result content 格式处理问题

3. **事件流优化**
   - 修复 ping 事件位置(在 message_start 之后)
   - 修复 ping 事件格式(`{"type":"ping"}`)
   - 修复文本块和 tool use 块之间的 content_block_stop 缺失问题
   - 在 message_delta 中同时返回 input_tokens 和 output_tokens

### 变更内容

**修改的文件:**
- `models.py`: system 字段类型改为 `Union[str, List[Dict[str, Any]]]`
- `converter.py`: 正确处理数组格式的 system prompt
- `stream_handler_new.py`:
  - 添加 `_estimate_input_tokens()` 方法
  - 添加 `_is_small_model_request()` 方法
  - 修复 content_block_stop 发送逻辑
  - 使用 tiktoken 计算 token
- `parser.py`:
  - 修复 `build_claude_message_stop_event()` 返回 input_tokens
  - 修复 `build_claude_ping_event()` 格式
- `config.py`: 添加 `zero_input_token_models` 配置
- `main.py`: 传递 request_data 用于 token 估算
- `requirements.txt`: 添加 tiktoken 依赖

### 配置说明

**新增环境变量:**
```bash
# 指定哪些模型返回 input_tokens=0 (逗号分隔)
ZERO_INPUT_TOKEN_MODELS=haiku,opus
```

### 修复的问题

1. ✅ System prompt 数组格式导致模型无法理解系统指令
2. ✅ input_tokens 计算失败 (sequence item 0: expected str instance, list found)
3. ✅ 小模型请求导致 Claude Code 显示 input_token 不准确
4. ✅ 文本块和 tool use 块之间缺少 content_block_stop
5. ✅ ping 事件位置和格式不符合官方 API
6. ✅ message_delta 缺少 input_tokens

## 2025-11-07 - Event Stream 支持 + API 修复

### 重大更新

根据实际的 Amazon Q API 请求/响应格式，实现了完整的支持：
1. **AWS Event Stream** 二进制响应格式解析
2. **AWS SDK 风格** 的 API 调用方式

### 变更内容

1. **新增模块**：
   - `event_stream_parser.py` - AWS Event Stream 二进制格式解析器
   - `stream_handler_new.py` - 新的流处理器，支持 Event Stream
   - `test_event_stream.py` - Event Stream 解析器测试脚本

2. **更新模块**：
   - `parser.py` - 添加 `parse_amazonq_event()` 函数处理 Amazon Q 特定事件
   - `main.py` - 修复 API endpoint 和请求头，使用字节流（`aiter_bytes`）
   - `auth.py` - 移除 Content-Type，由 main.py 设置

3. **API 调用修复**：
   - **Endpoint**: `https://q.us-east-1.amazonaws.com/` （根路径）
   - **关键请求头**:
     - `Content-Type: application/x-amz-json-1.0`
     - `X-Amz-Target: AmazonCodeWhispererStreamingService.GenerateAssistantResponse`
     - `Authorization: Bearer <token>`

4. **事件格式变化**：
   - **旧格式**（假设）：标准 SSE 文本格式
   - **新格式**（实际）：AWS Event Stream 二进制格式

### Amazon Q 事件类型

根据实际响应，Amazon Q 使用以下事件类型：

| 事件类型 | 说明 | 转换为 Claude 事件 |
|---------|------|-------------------|
| `initial-response` | 对话开始，包含 `conversationId` | `message_start` |
| `assistantResponseEvent` | 文本内容片段，包含 `content` 字段 | `content_block_delta` |

### Event Stream 格式说明

AWS Event Stream 是一种二进制协议，结构如下：

```
[Prelude: 12 bytes]
  - Total length (4 bytes)
  - Headers length (4 bytes)
  - Prelude CRC (4 bytes)
[Headers: variable]
  - :event-type
  - :content-type
  - :message-type
[Payload: variable]
  - JSON 数据
[Message CRC: 4 bytes]
```

### 测试

运行 Event Stream 解析器测试：

```bash
python3 test_event_stream.py
```

### 注意事项

1. **字节流处理**：
   - 使用 `response.aiter_bytes()` 而不是 `response.aiter_lines()`
   - 解析器会自动处理消息边界

2. **事件简化**：
   - Amazon Q 不提供 `content_block_start` 事件，代理会自动生成
   - Amazon Q 不提供 `content_block_stop` 事件，代理会在流结束时生成
   - Amazon Q 不提供 `index` 字段，默认使用 0

3. **Token 计数**：
   - 仍使用简化算法（4字符≈1token）
   - 建议后续集成 Anthropic 官方 tokenizer

### 兼容性

- 保留了旧的 `stream_handler.py`（标准 SSE 格式）
- 新的 `stream_handler_new.py` 处理 Event Stream 格式
- `main.py` 默认使用新的处理器

### 下一步

- [ ] 测试完整的请求/响应流程
- [ ] 处理可能的其他事件类型（如 error、tool_use 等）
- [ ] 优化 Token 计数算法
- [ ] 添加更多错误处理
