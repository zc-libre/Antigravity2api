"""
Gemini OAuth2 Token 管理模块
"""
import logging
import httpx
from typing import Dict, Optional
from datetime import datetime, timedelta
from urllib.parse import unquote

logger = logging.getLogger(__name__)


class GeminiTokenManager:
    """Gemini Token 管理器"""

    def __init__(self, client_id: str, client_secret: str, refresh_token: str, api_endpoint: str):
        self.client_id = client_id
        self.client_secret = client_secret
        self.refresh_token = refresh_token
        self.api_endpoint = api_endpoint
        self.access_token: Optional[str] = None
        self.token_expires_at: Optional[datetime] = None
        self.project_id: Optional[str] = None
        self.token_endpoint = "https://oauth2.googleapis.com/token"

    async def get_access_token(self) -> str:
        """获取有效的 access token，如果过期则自动刷新"""
        if self.access_token and self.token_expires_at:
            if datetime.now() < self.token_expires_at - timedelta(minutes=5):
                return self.access_token

        await self.refresh_access_token()
        return self.access_token

    async def refresh_access_token(self) -> None:
        """刷新 access token"""
        logger.info("正在刷新 Gemini access token...")

        async with httpx.AsyncClient() as client:
            response = await client.post(
                self.token_endpoint,
                data={
                    "client_id": self.client_id,
                    "client_secret": self.client_secret,
                    "grant_type": "refresh_token",
                    "refresh_token": unquote(self.refresh_token)
                }
            )

            if response.status_code != 200:
                error_text = response.text
                logger.error(f"Token 刷新失败: {response.status_code} {error_text}")
                raise Exception(f"Token 刷新失败: {error_text}")

            token_data = response.json()
            self.access_token = token_data["access_token"]
            expires_in = token_data.get("expires_in", 3599)
            self.token_expires_at = datetime.now() + timedelta(seconds=expires_in)

            logger.info(f"Token 刷新成功，有效期至 {self.token_expires_at}")

    async def get_project_id(self) -> str:
        """获取 Gemini 项目 ID"""
        if self.project_id:
            return self.project_id

        token = await self.get_access_token()

        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"{self.api_endpoint}/v1internal:loadCodeAssist",
                json={"metadata": {"ideType": "ANTIGRAVITY"}},
                headers={
                    "Authorization": f"Bearer {token}",
                    "Content-Type": "application/json"
                }
            )

            if response.status_code != 200:
                error_text = response.text
                logger.error(f"获取项目 ID 失败: {response.status_code} {error_text}")
                raise Exception(f"获取项目 ID 失败: {error_text}")

            data = response.json()
            self.project_id = data.get("cloudaicompanionProject")

            if not self.project_id:
                raise Exception("无法从响应中获取项目 ID")

            logger.info(f"获取到项目 ID: {self.project_id}")
            return self.project_id

    async def get_auth_headers(self) -> Dict[str, str]:
        """获取认证请求头"""
        token = await self.get_access_token()
        return {
            "Authorization": f"Bearer {token}"
        }

    async def fetch_available_models(self, project_id: str) -> Dict:
        """获取可用模型和配额信息"""
        token = await self.get_access_token()

        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"{self.api_endpoint}/v1internal:fetchAvailableModels",
                json={"project": project_id},
                headers={
                    "Authorization": f"Bearer {token}",
                    "Content-Type": "application/json",
                    "User-Agent": "antigravity/1.11.3 darwin/arm64"
                }
            )

            if response.status_code != 200:
                error_text = response.text
                logger.error(f"获取模型列表失败: {response.status_code} {error_text}")
                raise Exception(f"获取模型列表失败: {error_text}")

            return response.json()