# Amazon Q API 详细说明

## API 调用方式

Amazon Q 使用 **AWS SDK 风格** 的 API 调用，而不是标准的 REST API。

### Endpoint

```
https://q.us-east-1.amazonaws.com/
```

**注意**：这是根路径，不需要额外的路径（如 `/v1/conversations`）

### HTTP 方法

```
POST
```

### 关键请求头

```http
Host: q.us-east-1.amazonaws.com
Content-Type: application/x-amz-json-1.0
X-Amz-Target: AmazonCodeWhispererStreamingService.GenerateAssistantResponse
Authorization: Bearer <access_token>
Accept: */*
```

**重要说明**：
- `Content-Type` 必须是 `application/x-amz-json-1.0`（AWS JSON 协议）
- `X-Amz-Target` 指定要调用的服务方法
- `Authorization` 使用 Bearer token 认证

### 请求体格式

请求体是 JSON 格式，结构如下：

```json
{
  "conversationState": {
    "conversationId": "uuid",
    "history": [],
    "currentMessage": {
      "userInputMessage": {
        "content": "用户消息内容",
        "userInputMessageContext": {
          "envState": {
            "operatingSystem": "macos",
            "currentWorkingDirectory": "/path/to/dir"
          },
          "tools": []
        },
        "origin": "CLI",
        "modelId": "claude-sonnet-4.5",
        "images": [  // 可选，图片列表
          {
            "format": "png",
            "source": {
              "bytes": "base64_encoded_image_data"
            }
          }
        ]
      }
    },
    "chatTriggerType": "MANUAL"
  },
  "profileArn": "arn:aws:..." // 可选，组织账号需要
}
```

## 响应格式

### Event Stream 格式

Amazon Q 返回的是 **AWS Event Stream** 二进制格式，不是标准的 SSE 文本格式。

#### 消息结构

每个消息包含：

```
[Prelude: 12 bytes]
  - Total length (4 bytes, big-endian uint32)
  - Headers length (4 bytes, big-endian uint32)
  - Prelude CRC (4 bytes, big-endian uint32)

[Headers: variable length]
  - :event-type (string)
  - :content-type (string)
  - :message-type (string)

[Payload: variable length]
  - JSON 数据

[Message CRC: 4 bytes]
```

#### Header 格式

每个 header 的格式：

```
[Header name length: 1 byte]
[Header name: variable]
[Header value type: 1 byte] (7 = string)
[Header value length: 2 bytes, big-endian uint16]
[Header value: variable]
```

### 事件类型

#### 1. initial-response

对话开始事件，包含 conversation ID。

**Headers**:
```
:event-type: initial-response
:content-type: application/json
:message-type: event
```

**Payload**:
```json
{
  "conversationId": "uuid-string"
}
```

#### 2. assistantResponseEvent

助手响应事件，包含文本内容片段。

**Headers**:
```
:event-type: assistantResponseEvent
:content-type: application/json
:message-type: event
```

**Payload**:
```json
{
  "content": "文本片段"
}
```

**特点**：
- 每个事件包含一小段文本（可能是一个词或几个词）
- 多个事件组成完整的响应
- 流结束时没有特殊标记，连接关闭即表示结束

## Token 刷新

### Endpoint

```
https://oidc.us-east-1.amazonaws.com/token
```

### 请求格式

```http
POST /token
Content-Type: application/json

{
  "grant_type": "refresh_token",
  "refresh_token": "your_refresh_token",
  "client_id": "your_client_id",
  "client_secret": "your_client_secret"
}
```

### 响应格式

```json
{
  "access_token": "new_access_token",
  "refresh_token": "new_refresh_token",  // 可能是 refreshToken
  "expires_in": 3600,  // 可能是 expiresIn
  "token_type": "Bearer"
}
```

**注意**：字段名可能有变化（驼峰式或下划线式），代码中已处理。

## 与 Claude API 的映射

### 请求映射

| Claude API | Amazon Q API |
|-----------|-------------|
| `model` | `conversationState.currentMessage.userInputMessage.modelId` |
| `messages[-1].content` (文本) | `conversationState.currentMessage.userInputMessage.content` |
| `messages[-1].content` (图片) | `conversationState.currentMessage.userInputMessage.images` |
| `messages[:-1]` | `conversationState.history` |
| `tools` | `conversationState.currentMessage.userInputMessage.userInputMessageContext.tools` |
| `system` | 添加到 `content` 前面 |

#### 图片格式转换

Claude API 格式：
```json
{
  "type": "image",
  "source": {
    "type": "base64",
    "media_type": "image/png",
    "data": "base64_encoded_data"
  }
}
```

Amazon Q API 格式：
```json
{
  "format": "png",
  "source": {
    "bytes": "base64_encoded_data"
  }
}
```

### 响应映射

| Amazon Q Event | Claude API Event |
|---------------|-----------------|
| `initial-response` | `message_start` |
| （自动生成） | `content_block_start` |
| `assistantResponseEvent` | `content_block_delta` |
| （自动生成） | `content_block_stop` |
| （自动生成） | `message_delta` (stop) |

## 实现细节

### 1. Event Stream 解析

使用 `event_stream_parser.py` 模块：

```python
from event_stream_parser import EventStreamParser, extract_event_info

async for message in EventStreamParser.parse_stream(byte_stream):
    event_info = extract_event_info(message)
    # 处理事件
```

### 2. 事件转换

使用 `parser.py` 模块：

```python
from parser import parse_amazonq_event

event = parse_amazonq_event(event_info)
if isinstance(event, MessageStart):
    # 处理 message_start
elif isinstance(event, ContentBlockDelta):
    # 处理 content_block_delta
```

### 3. 流处理

使用 `stream_handler_new.py` 模块：

```python
from stream_handler_new import handle_amazonq_stream

async for claude_event in handle_amazonq_stream(byte_stream):
    # claude_event 是 Claude 格式的 SSE 事件字符串
    yield claude_event
```

## 注意事项

1. **字节流处理**：
   - 必须使用 `response.aiter_bytes()` 而不是 `response.aiter_lines()`
   - Event Stream 是二进制格式，不能按行处理

2. **请求头顺序**：
   - 虽然 HTTP 头部顺序通常不重要，但建议按照示例顺序设置
   - 特别是 `X-Amz-Target` 必须存在

3. **Content-Type**：
   - 必须是 `application/x-amz-json-1.0`
   - 不能使用 `application/json`

4. **事件补全**：
   - Amazon Q 不提供 `content_block_start` 和 `content_block_stop`
   - 代理服务会自动生成这些事件以保持 Claude API 兼容性

5. **Token 计数**：
   - 当前使用简化算法（4字符≈1token）
   - 建议后续集成 Anthropic 官方 tokenizer

## 调试建议

1. **查看原始字节流**：
   ```python
   async for chunk in response.aiter_bytes():
       print(f"Chunk: {chunk[:100]}")  # 打印前 100 字节
   ```

2. **查看解析后的消息**：
   ```python
   async for message in EventStreamParser.parse_stream(byte_stream):
       print(f"Headers: {message['headers']}")
       print(f"Payload: {message['payload']}")
   ```

3. **查看转换后的事件**：
   ```python
   event = parse_amazonq_event(event_info)
   print(f"Event type: {type(event).__name__}")
   ```

## 参考资料

- AWS Event Stream 规范：https://docs.aws.amazon.com/AmazonS3/latest/API/RESTSelectObjectAppendix.html
- Amazon Q CLI 文档：https://docs.aws.amazon.com/amazonq/
