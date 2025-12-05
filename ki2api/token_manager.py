"""
Token management for multi-account authentication
"""
import os
import json
import time
import asyncio
import logging
import httpx
from pathlib import Path
from dataclasses import dataclass, field
from typing import List, Optional, Dict, Any

logger = logging.getLogger(__name__)

# Token refresh endpoints
SOCIAL_REFRESH_URL = "https://prod.us-east-1.auth.desktop.kiro.dev/refreshToken"
IDC_REFRESH_URL = "https://oidc.us-east-1.amazonaws.com/token"


# ============================================================================
# 多账号配置数据结构
# ============================================================================

@dataclass
class AuthConfig:
    """认证配置"""
    auth_type: str  # "Social" 或 "IdC"
    refresh_token: str
    client_id: Optional[str] = None  # IdC 认证需要
    client_secret: Optional[str] = None  # IdC 认证需要
    disabled: bool = False


@dataclass
class CachedToken:
    """缓存的 token 信息"""
    access_token: str
    config_index: int
    cached_at: float = field(default_factory=time.time)
    last_used: float = field(default_factory=time.time)
    is_exhausted: bool = False
    error_count: int = 0


def load_auth_configs() -> List[AuthConfig]:
    """
    从环境变量加载认证配置
    支持两种格式：
    1. JSON 字符串: KIRO_AUTH_TOKEN='[{"auth":"Social","refreshToken":"xxx"}]'
    2. 文件路径: KIRO_AUTH_TOKEN=/path/to/config.json
    3. 兼容旧格式: KIRO_REFRESH_TOKEN (单账号)
    """
    configs = []

    # 尝试从 KIRO_AUTH_TOKEN 加载（新格式）
    auth_token_env = os.getenv("KIRO_AUTH_TOKEN")
    if auth_token_env:
        try:
            # 检查是否为文件路径
            if os.path.isfile(auth_token_env):
                logger.info(f"从文件加载认证配置: {auth_token_env}")
                with open(auth_token_env, 'r', encoding='utf-8') as f:
                    config_data = json.load(f)
            else:
                # 作为 JSON 字符串解析
                config_data = json.loads(auth_token_env)

            # 统一处理为列表
            if isinstance(config_data, dict):
                config_data = [config_data]

            for item in config_data:
                if item.get("disabled", False):
                    continue

                auth_type = item.get("auth", "Social")
                refresh_token = item.get("refreshToken", "")

                if not refresh_token:
                    logger.warning("跳过缺少 refreshToken 的配置")
                    continue

                # IdC 认证需要额外字段
                if auth_type == "IdC":
                    client_id = item.get("clientId")
                    client_secret = item.get("clientSecret")
                    if not client_id or not client_secret:
                        logger.warning("IdC 认证缺少 clientId 或 clientSecret，跳过")
                        continue
                    configs.append(AuthConfig(
                        auth_type=auth_type,
                        refresh_token=refresh_token,
                        client_id=client_id,
                        client_secret=client_secret
                    ))
                else:
                    configs.append(AuthConfig(
                        auth_type=auth_type,
                        refresh_token=refresh_token
                    ))

            logger.info(f"成功加载 {len(configs)} 个认证配置")
            return configs

        except json.JSONDecodeError as e:
            logger.error(f"解析 KIRO_AUTH_TOKEN 失败: {e}")
        except Exception as e:
            logger.error(f"加载认证配置失败: {e}")

    # 兼容旧格式：从单独的环境变量加载
    refresh_token = os.getenv("KIRO_REFRESH_TOKEN")
    if refresh_token:
        logger.info("使用旧格式配置（单账号模式）")
        configs.append(AuthConfig(
            auth_type="Social",
            refresh_token=refresh_token
        ))
        return configs

    # 尝试从本地 token 文件读取
    token_file = Path.home() / ".aws" / "sso" / "cache" / "kiro-auth-token.json"
    if token_file.exists():
        try:
            with open(token_file, 'r', encoding='utf-8') as f:
                data = json.load(f)
            refresh_token = data.get("refreshToken")
            if refresh_token:
                logger.info(f"从本地 token 文件加载配置: {token_file}")
                configs.append(AuthConfig(
                    auth_type="Social",
                    refresh_token=refresh_token
                ))
                return configs
        except Exception as e:
            logger.warning(f"读取本地 token 文件失败: {e}")

    logger.warning("未找到任何认证配置")
    return configs


# ============================================================================
# 多账号 Token 管理器（支持轮询）
# ============================================================================

class TokenManager:
    """
    多账号 Token 管理器
    - 支持多个认证配置
    - 顺序轮询策略：当前账号失败或耗尽时，自动切换到下一个
    - 自动刷新 token
    - 线程安全
    """

    def __init__(self, configs: List[AuthConfig]):
        self.configs = configs
        self.tokens: Dict[int, CachedToken] = {}  # index -> CachedToken
        self.current_index = 0
        self.refresh_lock = asyncio.Lock()
        self.token_cache_ttl = 3500  # token 缓存时间（秒），略小于 1 小时

        logger.info(f"TokenManager 初始化，共 {len(configs)} 个认证配置")
        for i, cfg in enumerate(configs):
            logger.info(f"  配置 {i}: {cfg.auth_type} (refresh_token: {cfg.refresh_token[:20]}...)")

    async def refresh_single_token(self, config: AuthConfig, index: int) -> Optional[str]:
        """刷新单个账号的 token"""
        try:
            async with httpx.AsyncClient() as client:
                if config.auth_type == "Social":
                    # Social 认证刷新
                    response = await client.post(
                        SOCIAL_REFRESH_URL,
                        json={"refreshToken": config.refresh_token},
                        timeout=30
                    )
                elif config.auth_type == "IdC":
                    # IdC 认证刷新
                    response = await client.post(
                        IDC_REFRESH_URL,
                        data={
                            "grant_type": "refresh_token",
                            "client_id": config.client_id,
                            "client_secret": config.client_secret,
                            "refresh_token": config.refresh_token
                        },
                        headers={"Content-Type": "application/x-www-form-urlencoded"},
                        timeout=30
                    )
                else:
                    logger.error(f"未知的认证类型: {config.auth_type}")
                    return None

                response.raise_for_status()
                data = response.json()

                # 获取 access token
                access_token = data.get("accessToken") or data.get("access_token")
                if not access_token:
                    logger.error(f"刷新 token 响应中没有 accessToken: {data}")
                    return None

                # 缓存 token
                self.tokens[index] = CachedToken(
                    access_token=access_token,
                    config_index=index,
                    cached_at=time.time(),
                    last_used=time.time()
                )

                logger.info(f"配置 {index} ({config.auth_type}) token 刷新成功")
                return access_token

        except Exception as e:
            logger.error(f"配置 {index} token 刷新失败: {e}")
            # 标记为错误
            if index in self.tokens:
                self.tokens[index].error_count += 1
            return None

    async def get_token(self) -> Optional[str]:
        """
        获取可用的 token（顺序轮询策略）
        如果当前 token 无效，尝试刷新或切换到下一个
        """
        if not self.configs:
            logger.error("没有可用的认证配置")
            return None

        async with self.refresh_lock:
            # 尝试所有配置
            for attempt in range(len(self.configs)):
                idx = (self.current_index + attempt) % len(self.configs)
                config = self.configs[idx]

                # 检查是否有缓存的有效 token
                cached = self.tokens.get(idx)
                if cached:
                    # 检查是否过期
                    if time.time() - cached.cached_at < self.token_cache_ttl:
                        # 检查是否被标记为耗尽
                        if not cached.is_exhausted and cached.error_count < 3:
                            cached.last_used = time.time()
                            logger.debug(f"使用缓存的 token (配置 {idx})")
                            return cached.access_token

                # 尝试刷新 token
                logger.info(f"尝试刷新配置 {idx} 的 token...")
                token = await self.refresh_single_token(config, idx)
                if token:
                    self.current_index = idx
                    return token

            logger.error("所有配置的 token 都无法使用")
            return None

    def mark_token_exhausted(self, reason: str = "rate_limit"):
        """标记当前 token 为已耗尽，切换到下一个"""
        if self.current_index in self.tokens:
            self.tokens[self.current_index].is_exhausted = True
            logger.warning(f"配置 {self.current_index} 被标记为耗尽 (原因: {reason})")

        # 切换到下一个
        if len(self.configs) > 1:
            self.current_index = (self.current_index + 1) % len(self.configs)
            logger.info(f"切换到配置 {self.current_index}")

    def mark_token_error(self):
        """标记当前 token 出错"""
        if self.current_index in self.tokens:
            self.tokens[self.current_index].error_count += 1
            logger.warning(f"配置 {self.current_index} 错误次数: {self.tokens[self.current_index].error_count}")

    def reset_all_exhausted(self):
        """重置所有耗尽标记（用于周期性恢复）"""
        for token in self.tokens.values():
            token.is_exhausted = False
            token.error_count = 0
        logger.info("已重置所有配置的耗尽状态")

    def get_status(self) -> Dict[str, Any]:
        """获取 token 管理器状态"""
        status = {
            "total_configs": len(self.configs),
            "current_index": self.current_index,
            "tokens": {}
        }
        for idx, token in self.tokens.items():
            status["tokens"][idx] = {
                "cached_at": token.cached_at,
                "last_used": token.last_used,
                "is_exhausted": token.is_exhausted,
                "error_count": token.error_count,
                "age_seconds": int(time.time() - token.cached_at)
            }
        return status

