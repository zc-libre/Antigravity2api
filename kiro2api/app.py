import time
import json
import logging
import httpx
from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException, Depends
from fastapi.responses import StreamingResponse
from fastapi.middleware.cors import CORSMiddleware

from config import MODEL_MAP, KIRO_BASE_URL
from models import ChatCompletionRequest
from models.claude_schemas import ClaudeRequest
from auth import verify_api_key, token_manager
from services import create_non_streaming_response, create_streaming_response
from services.claude_converter import convert_claude_to_codewhisperer_request
from services.claude_stream_handler import ClaudeStreamHandler
from storage import init_db, close_db, AccountStore, get_db

# Configure logging
logging.basicConfig(level=logging.INFO)  # for dev
# logging.basicConfig(level=logging.WARNING)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """应用生命周期管理"""
    # 启动时初始化数据库
    await init_db()
    logger.info("数据库连接已初始化")
    yield
    # 关闭时清理数据库连接
    await close_db()
    logger.info("数据库连接已关闭")


# Initialize FastAPI app
app = FastAPI(
    title="Ki2API - Claude Sonnet 4 OpenAI/Claude Compatible API",
    description="OpenAI/Claude-compatible API for Claude Sonnet 4 via AWS CodeWhisperer with multi-account rotation support",
    version="3.3.0",
    lifespan=lifespan
)

# 添加 CORS 中间件
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
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
    return {"status": "healthy", "service": "Ki2API", "version": "3.2.0"}


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


# ============================================================================
# Claude API 兼容端点
# ============================================================================

@app.post("/v1/messages")
async def create_message(
    request: ClaudeRequest,
    api_key: str = Depends(verify_api_key)
):
    """
    Claude API 兼容的消息创建端点
    参考 amazonq2api 模块实现
    """
    logger.info(f"📥 收到 Claude API 请求: model={request.model}, stream={request.stream}")
    logger.debug(f"📥 完整请求: {request.model_dump_json(indent=2)}")
    
    try:
        # 转换为 CodeWhisperer 请求
        codewhisperer_request = convert_claude_to_codewhisperer_request(request)
        logger.debug(f"🔄 转换后的请求: {json.dumps(codewhisperer_request, indent=2, ensure_ascii=False)[:2000]}...")
        
        # 获取 token
        token = await token_manager.get_token()
        if not token:
            raise HTTPException(
                status_code=401,
                detail={
                    "type": "error",
                    "error": {
                        "type": "authentication_error",
                        "message": "No access token available. Please check your KIRO_AUTH_CONFIG configuration."
                    }
                }
            )
        
        headers = {
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
            "Accept": "text/event-stream"
        }
        
        # 流式响应
        async def generate_stream():
            handler = ClaudeStreamHandler(request.model, request)
            max_retries = 3
            
            timeout = httpx.Timeout(connect=30.0, read=None, write=30.0, pool=30.0)
            
            async with httpx.AsyncClient(timeout=timeout) as client:
                current_headers = headers.copy()
                
                for attempt in range(max_retries):
                    try:
                        async with client.stream(
                            "POST",
                            KIRO_BASE_URL,
                            headers=current_headers,
                            json=codewhisperer_request
                        ) as response:
                            logger.info(f"📤 STREAM RESPONSE STATUS: {response.status_code} (attempt {attempt + 1})")
                            
                            # 处理 403 - 刷新 token 并重试
                            if response.status_code == 403 and attempt < max_retries - 1:
                                logger.info("收到403响应，尝试刷新token...")
                                new_token = await token_manager.refresh_tokens()
                                if new_token:
                                    current_headers["Authorization"] = f"Bearer {new_token}"
                                    continue
                                else:
                                    token_manager.mark_token_error()
                                    new_token = await token_manager.get_token()
                                    if new_token:
                                        current_headers["Authorization"] = f"Bearer {new_token}"
                                        continue
                                    yield f'event: error\ndata: {{"type":"error","error":{{"type":"authentication_error","message":"Token refresh failed"}}}}\n\n'
                                    return
                            
                            # 处理 429 - 速率限制
                            if response.status_code == 429:
                                logger.warning("收到429响应（速率限制），尝试切换账号...")
                                token_manager.mark_token_exhausted("rate_limit_429")
                                
                                if attempt < max_retries - 1:
                                    new_token = await token_manager.get_token()
                                    if new_token:
                                        current_headers["Authorization"] = f"Bearer {new_token}"
                                        logger.info("已切换到新账号，重试请求...")
                                        continue
                                
                                yield f'event: error\ndata: {{"type":"error","error":{{"type":"rate_limit_error","message":"All accounts rate limited. Please try again later."}}}}\n\n'
                                return
                            
                            if response.status_code != 200:
                                error_text = await response.aread()
                                logger.error(f"API 错误: {response.status_code} - {error_text}")
                                yield f'event: error\ndata: {{"type":"error","error":{{"type":"api_error","message":"API error: {response.status_code}"}}}}\n\n'
                                return
                            
                            # 真正的流式处理
                            async for chunk in response.aiter_bytes():
                                for event in handler.handle_chunk(chunk):
                                    yield event
                            
                            # 发送收尾事件
                            for event in handler.finalize():
                                yield event
                            
                            return  # 成功完成
                    
                    except httpx.HTTPStatusError as e:
                        logger.error(f"HTTP ERROR in stream: {e}")
                        yield f'event: error\ndata: {{"type":"error","error":{{"type":"api_error","message":"{str(e)}"}}}}\n\n'
                        return
                    except Exception as e:
                        logger.error(f"Stream error: {e}")
                        import traceback
                        traceback.print_exc()
                        yield f'event: error\ndata: {{"type":"error","error":{{"type":"internal_error","message":"{str(e)}"}}}}\n\n'
                        return
        
        return StreamingResponse(
            generate_stream(),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "Content-Type": "text/event-stream",
                "X-Accel-Buffering": "no"
            }
        )
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"处理请求时发生错误: {e}")
        import traceback
        traceback.print_exc()
        raise HTTPException(
            status_code=500,
            detail={
                "type": "error",
                "error": {
                    "type": "internal_error",
                    "message": f"Internal server error: {str(e)}"
                }
            }
        )


# ============================================================================
# 账号管理 API 端点
# ============================================================================

from sqlalchemy.ext.asyncio import AsyncSession


async def get_db_session():
    """获取数据库会话的依赖"""
    async for session in get_db():
        yield session


@app.get("/api/accounts")
async def list_accounts(session: AsyncSession = Depends(get_db_session)):
    """获取所有 Kiro 账号"""
    store = AccountStore(session)
    accounts = await store.find_all(type="kiro")
    return {
        "success": True,
        "total": len(accounts),
        "accounts": [
            {
                "id": acc.id,
                "email": acc.awsEmail,
                "label": acc.label,
                "savedAt": acc.savedAt.isoformat() if acc.savedAt else None,
                "enabled": acc.enabled,
                "type": acc.type,
                "lastRefreshStatus": acc.lastRefreshStatus,
                "lastRefreshTime": acc.lastRefreshTime.isoformat() if acc.lastRefreshTime else None,
                "hasRefreshToken": bool(acc.refreshToken),
            }
            for acc in accounts
        ]
    }


@app.get("/api/accounts/{account_id}")
async def get_account_detail(
    account_id: str,
    session: AsyncSession = Depends(get_db_session)
):
    """获取账号详情"""
    store = AccountStore(session)
    account = await store.find_by_id(account_id)

    if not account:
        raise HTTPException(status_code=404, detail="账号不存在")

    return {
        "success": True,
        "account": {
            "id": account.id,
            "email": account.awsEmail,
            "password": account.awsPassword,
            "clientId": account.clientId,
            "clientSecret": account.clientSecret,
            "accessToken": account.accessToken,
            "refreshToken": account.refreshToken,
            "label": account.label,
            "savedAt": account.savedAt.isoformat() if account.savedAt else None,
            "expiresIn": account.expiresIn,
            "enabled": account.enabled,
            "type": account.type,
            "lastRefreshStatus": account.lastRefreshStatus,
            "lastRefreshTime": account.lastRefreshTime.isoformat() if account.lastRefreshTime else None,
        }
    }


from pydantic import BaseModel
from typing import Optional


class CreateAccountRequest(BaseModel):
    """创建账号请求"""
    refreshToken: str
    name: Optional[str] = None
    enabled: bool = True


class UpdateAccountRequest(BaseModel):
    """更新账号请求"""
    enabled: Optional[bool] = None
    label: Optional[str] = None


@app.post("/api/accounts")
async def create_account(
    request: CreateAccountRequest,
    session: AsyncSession = Depends(get_db_session)
):
    """创建新账号"""
    store = AccountStore(session)
    account = await store.create(
        refresh_token=request.refreshToken,
        name=request.name,
        enabled=request.enabled,
    )

    return {
        "success": True,
        "account": {
            "id": account.id,
            "label": account.label,
            "enabled": account.enabled,
            "type": account.type,
        }
    }


@app.patch("/api/accounts/{account_id}")
async def update_account(
    account_id: str,
    request: UpdateAccountRequest,
    session: AsyncSession = Depends(get_db_session)
):
    """更新账号"""
    store = AccountStore(session)
    account = await store.update(
        id=account_id,
        enabled=request.enabled,
        label=request.label,
    )

    if not account:
        raise HTTPException(status_code=404, detail="账号不存在")

    return {
        "success": True,
        "account": {
            "id": account.id,
            "email": account.awsEmail,
            "label": account.label,
            "enabled": account.enabled,
        }
    }


@app.delete("/api/accounts/{account_id}")
async def delete_account(
    account_id: str,
    session: AsyncSession = Depends(get_db_session)
):
    """删除账号"""
    store = AccountStore(session)
    deleted = await store.delete(account_id)

    if not deleted:
        raise HTTPException(status_code=404, detail="账号不存在")

    return {
        "success": True,
        "message": "账号已删除"
    }


@app.get("/")
async def root():
    """Root endpoint with service information"""
    return {
        "service": "Ki2API",
        "description": "OpenAI/Claude-compatible API for Claude Sonnet 4 via AWS CodeWhisperer with multi-account rotation support",
        "version": "3.3.0",
        "endpoints": {
            "models": "/v1/models",
            "chat": "/v1/chat/completions",
            "messages": "/v1/messages",
            "health": "/health",
            "token_status": "/v1/token/status",
            "token_reset": "/v1/token/reset",
            "accounts": "/api/accounts"
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
            "rate_limit_failover": True,
            "claude_api_compatible": True,
            "database_storage": True
        }
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8989)
