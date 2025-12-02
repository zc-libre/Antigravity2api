import time
import logging
from fastapi import FastAPI, HTTPException, Depends

from config import MODEL_MAP
from models import ChatCompletionRequest
from auth import verify_api_key, token_manager
from services import create_non_streaming_response, create_streaming_response

# Configure logging
logging.basicConfig(level=logging.INFO)  # for dev
# logging.basicConfig(level=logging.WARNING)
logger = logging.getLogger(__name__)

# Initialize FastAPI app
app = FastAPI(
    title="Ki2API - Claude Sonnet 4 OpenAI Compatible API",
    description="OpenAI-compatible API for Claude Sonnet 4 via AWS CodeWhisperer with multi-account rotation support",
    version="3.1.0"
)


@app.get("/v1/models")
async def list_models(api_key: str = Depends(verify_api_key)):
    """List available models"""
    return {
        "object": "list",
        "data": [
            {
                "id": model_id,
                "object": "model",
                "created": int(time.time()),
                "owned_by": "ki2api"
            }
            for model_id in MODEL_MAP.keys()
        ]
    }


@app.post("/v1/chat/completions")
async def create_chat_completion(
    request: ChatCompletionRequest,
    api_key: str = Depends(verify_api_key)
):
    """Create a chat completion"""
    logger.info(f"📥 COMPLETE REQUEST: {request.model_dump_json(indent=2)}")

    # Validate messages have content
    for i, msg in enumerate(request.messages):
        if msg.content is None and msg.role != "assistant":
            logger.warning(f"Message {i} with role '{msg.role}' has None content")

    if request.model not in MODEL_MAP:
        raise HTTPException(
            status_code=400,
            detail={
                "error": {
                    "message": f"The model '{request.model}' does not exist or you do not have access to it.",
                    "type": "invalid_request_error",
                    "param": "model",
                    "code": "model_not_found"
                }
            }
        )

    # 根据请求类型调用相应的处理函数，实现真正的流式/非流式处理
    if request.stream:
        logger.info("🌊 使用真正的流式处理")
        return await create_streaming_response(request)
    else:
        logger.info("📄 使用非流式处理")
        return await create_non_streaming_response(request)


@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {"status": "healthy", "service": "Ki2API", "version": "3.1.0"}


@app.get("/v1/token/status")
async def token_status(api_key: str = Depends(verify_api_key)):
    """获取多账号 token 状态"""
    return {
        "status": "ok",
        "token_manager": token_manager.get_status()
    }


@app.post("/v1/token/reset")
async def reset_tokens(api_key: str = Depends(verify_api_key)):
    """重置所有 token 的耗尽状态"""
    token_manager.reset_all_exhausted()
    return {
        "status": "ok",
        "message": "All tokens have been reset",
        "token_manager": token_manager.get_status()
    }


@app.get("/")
async def root():
    """Root endpoint with service information"""
    return {
        "service": "Ki2API",
        "description": "OpenAI-compatible API for Claude Sonnet 4 via AWS CodeWhisperer with multi-account rotation support",
        "version": "3.1.0",
        "endpoints": {
            "models": "/v1/models",
            "chat": "/v1/chat/completions",
            "health": "/health",
            "token_status": "/v1/token/status",
            "token_reset": "/v1/token/reset"
        },
        "features": {
            "streaming": True,
            "tools": True,
            "multiple_models": True,
            "xml_tool_parsing": True,
            "auto_token_refresh": True,
            "null_content_handling": True,
            "tool_call_deduplication": True,
            "multi_account_rotation": True,
            "rate_limit_failover": True
        }
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8989)
