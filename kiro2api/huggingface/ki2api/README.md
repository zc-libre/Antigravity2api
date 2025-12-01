---
title: Ki2API - Claude Sonnet 4 OpenAI Compatible API
emoji: 🤖
colorFrom: blue
colorTo: purple
sdk: docker
app_port: 7860
---

# Ki2API - Claude Sonnet 4 OpenAI Compatible API

OpenAI-compatible API for Claude Sonnet 4 via AWS CodeWhisperer. This service provides streaming support, tool calls, and multiple model access through a familiar OpenAI API interface.

## Features

- 🔄 **Streaming Support**: Real-time response streaming
- 🛠️ **Tool Calls**: Function calling capabilities
- 🎯 **Multiple Models**: Support for Claude Sonnet 4 and Claude 3.5 Haiku
- 🔧 **XML Tool Parsing**: Advanced tool call parsing
- 🔄 **Auto Token Refresh**: Automatic authentication token management
- 🛡️ **Null Content Handling**: Robust message processing
- 🔍 **Tool Call Deduplication**: Prevents duplicate function calls

## API Endpoints

- `GET /v1/models` - List available models
- `POST /v1/chat/completions` - Create chat completions
- `GET /health` - Health check
- `GET /` - Service information

## Environment Variables

Required environment variables:
- `API_KEY` - Bearer token for API authentication (default: ki2api-key-2024)
- `KIRO_ACCESS_TOKEN` - Kiro access token
- `KIRO_REFRESH_TOKEN` - Kiro refresh token

## Usage

```bash
curl -X POST https://your-space-url/v1/chat/completions \n  -H "Authorization: Bearer ki2api-key-2024" \n  -H "Content-Type: application/json" \n  -d '{
    "model": "claude-sonnet-4-5-20250929",
    "messages": [
      {"role": "user", "content": "Hello!"}
    ]
  }'
```

## Supported Models

- `claude-sonnet-4-5-20250929` - Claude Sonnet 4 (Latest)
- `claude-3-5-haiku-20241022` - Claude 3.5 Haiku

Built with FastAPI and optimized for Hugging Face Spaces deployment.