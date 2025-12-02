"""
多账号 Token 管理器
实现轮询选择策略、token 缓存和自动刷新

支持两种数据源：
1. 数据库（优先）- 从 PostgreSQL 读取 type='kiro' 的账号
2. 配置文件（回退）- 从环境变量或 JSON 文件读取
"""
import os
import time
import asyncio
import logging
import httpx
from typing import Optional, List
from dataclasses import dataclass, field
from datetime import datetime, timedelta

from .config import AuthConfig, load_auth_configs

logger = logging.getLogger(__name__)


@dataclass
class CachedToken:
    """缓存的 Token 信息"""
    config: AuthConfig
    access_token: str
    cached_at: datetime = field(default_factory=datetime.now)
    last_used: datetime = field(default_factory=datetime.now)
    expires_at: Optional[datetime] = None
    is_exhausted: bool = False  # 标记 token 是否已耗尽（429 错误）
    error_count: int = 0  # 连续错误计数

    def is_expired(self, ttl_seconds: int = 3300) -> bool:
        """检查 token 是否过期（默认 55 分钟）"""
        if self.expires_at:
            return datetime.now() >= self.expires_at
        return (datetime.now() - self.cached_at).total_seconds() > ttl_seconds

    def is_usable(self) -> bool:
        """检查 token 是否可用"""
        return not self.is_exhausted and not self.is_expired() and self.error_count < 3


class MultiAccountTokenManager:
    """
    多账号 Token 管理器

    功能：
    - 支持多个 Kiro 账号配置
    - 轮询策略选择可用 token
    - 自动刷新过期 token
    - 错误处理和故障转移
    - 支持从数据库或配置文件加载账号
    """

    REFRESH_URL = "https://prod.us-east-1.auth.desktop.kiro.dev/refreshToken"
    TOKEN_TTL_SECONDS = 3300  # 55 分钟 TTL

    def __init__(self):
        self.configs: List[AuthConfig] = []
        self.cached_tokens: dict[str, CachedToken] = {}
        self.current_index: int = 0
        self.refresh_lock = asyncio.Lock()
        self._initialized = False
        self._use_database = False  # 是否使用数据库

    async def initialize(self):
        """初始化管理器，加载配置并预热 token"""
        if self._initialized:
            return

        try:
            # 优先尝试从数据库加载
            db_configs = await self._load_from_database()
            if db_configs:
                self.configs = db_configs
                self._use_database = True
                logger.info(f"TokenManager 从数据库加载了 {len(self.configs)} 个账号")
            else:
                # 回退到配置文件
                self.configs = load_auth_configs()
                logger.info(f"TokenManager 从配置文件加载了 {len(self.configs)} 个账号")

            # 预热第一个 token
            await self._warmup_first_token()
            self._initialized = True

        except Exception as e:
            logger.error(f"TokenManager 初始化失败: {e}")
            raise

    async def _load_from_database(self) -> List[AuthConfig]:
        """从数据库加载账号配置"""
        try:
            # 检查是否配置了数据库
            database_url = os.getenv("DATABASE_URL")
            if not database_url:
                logger.debug("未配置 DATABASE_URL，跳过数据库加载")
                return []

            # 动态导入以避免循环依赖
            from storage import init_db, get_db, AccountStore

            await init_db()

            async for session in get_db():
                store = AccountStore(session)
                accounts = await store.find_enabled(type="kiro")

                configs = []
                for acc in accounts:
                    if acc.refreshToken:
                        configs.append(AuthConfig(
                            refresh_token=acc.refreshToken,
                            access_token=acc.accessToken,
                            disabled=not acc.enabled,
                            name=acc.label or acc.id,
                        ))

                return configs
        except Exception as e:
            logger.warning(f"从数据库加载账号失败: {e}，将回退到配置文件")
            return []

    async def reload_from_database(self):
        """重新从数据库加载账号配置（用于账号变更后刷新）"""
        if not self._use_database:
            logger.warning("当前未使用数据库模式，无法重新加载")
            return False

        try:
            db_configs = await self._load_from_database()
            if db_configs:
                self.configs = db_configs
                self.current_index = 0
                logger.info(f"已重新加载 {len(self.configs)} 个账号配置")
                return True
            return False
        except Exception as e:
            logger.error(f"重新加载账号配置失败: {e}")
            return False

    async def _warmup_first_token(self):
        """预热第一个 token"""
        if not self.configs:
            return
        
        config = self.configs[0]
        try:
            token = await self._refresh_single_token(config)
            if token:
                self.cached_tokens[config.name] = CachedToken(
                    config=config,
                    access_token=token
                )
                logger.info(f"预热 token 成功: {config.name}")
        except Exception as e:
            logger.warning(f"预热 token 失败: {e}")
    
    async def get_token(self) -> Optional[str]:
        """
        获取可用的 access token
        
        使用轮询策略：
        1. 从当前索引开始查找可用 token
        2. 如果当前 token 不可用，切换到下一个
        3. 自动刷新过期的 token
        """
        if not self._initialized:
            await self.initialize()
        
        if not self.configs:
            logger.error("没有可用的认证配置")
            return None
        
        # 尝试所有配置
        for _ in range(len(self.configs)):
            config = self.configs[self.current_index]
            cache_key = config.name
            
            # 检查缓存
            cached = self.cached_tokens.get(cache_key)
            
            if cached and cached.is_usable():
                # 使用缓存的 token
                cached.last_used = datetime.now()
                logger.debug(f"使用缓存 token: {config.name}")
                return cached.access_token
            
            # 需要刷新 token
            try:
                new_token = await self._refresh_single_token(config)
                if new_token:
                    self.cached_tokens[cache_key] = CachedToken(
                        config=config,
                        access_token=new_token
                    )
                    logger.info(f"刷新 token 成功: {config.name}")
                    return new_token
            except Exception as e:
                logger.warning(f"刷新 token 失败 ({config.name}): {e}")
            
            # 当前配置失败，切换到下一个
            self._move_to_next()
        
        logger.error("所有 token 都不可用")
        return None
    
    async def refresh_tokens(self) -> Optional[str]:
        """
        刷新当前 token（用于 403 错误后的重试）
        """
        async with self.refresh_lock:
            if not self.configs:
                return None
            
            config = self.configs[self.current_index]
            
            try:
                new_token = await self._refresh_single_token(config)
                if new_token:
                    self.cached_tokens[config.name] = CachedToken(
                        config=config,
                        access_token=new_token
                    )
                    # 更新环境变量（向后兼容）
                    os.environ["KIRO_ACCESS_TOKEN"] = new_token
                    logger.info(f"token 刷新成功: {config.name}")
                    return new_token
            except Exception as e:
                logger.error(f"token 刷新失败: {e}")
            
            return None
    
    async def _refresh_single_token(self, config: AuthConfig) -> Optional[str]:
        """刷新单个账号的 token"""
        if not config.refresh_token:
            logger.error(f"配置 {config.name} 没有 refresh_token")
            return None
        
        try:
            async with httpx.AsyncClient() as client:
                response = await client.post(
                    self.REFRESH_URL,
                    json={"refreshToken": config.refresh_token},
                    timeout=30
                )
                response.raise_for_status()
                
                data = response.json()
                access_token = data.get("accessToken")
                
                if not access_token:
                    logger.error(f"刷新响应中没有 accessToken: {data}")
                    return None
                
                return access_token
                
        except httpx.HTTPStatusError as e:
            logger.error(f"刷新 token HTTP 错误: {e.response.status_code}")
            raise
        except Exception as e:
            logger.error(f"刷新 token 失败: {e}")
            raise
    
    def mark_token_exhausted(self, reason: str = "unknown"):
        """
        标记当前 token 为已耗尽（通常因为 429 错误）
        并切换到下一个账号
        """
        if not self.configs:
            return
        
        config = self.configs[self.current_index]
        cache_key = config.name
        
        if cache_key in self.cached_tokens:
            self.cached_tokens[cache_key].is_exhausted = True
            logger.warning(f"Token 已耗尽 ({config.name}): {reason}")
        
        # 切换到下一个账号
        self._move_to_next()
        logger.info(f"切换到下一个账号: {self.configs[self.current_index].name}")
    
    def mark_token_error(self):
        """标记当前 token 出现错误"""
        if not self.configs:
            return
        
        config = self.configs[self.current_index]
        cache_key = config.name
        
        if cache_key in self.cached_tokens:
            self.cached_tokens[cache_key].error_count += 1
            if self.cached_tokens[cache_key].error_count >= 3:
                logger.warning(f"Token 错误次数过多，标记为不可用: {config.name}")
                self._move_to_next()
    
    def reset_all_exhausted(self):
        """重置所有 token 的耗尽状态（可用于定时任务）"""
        for cached in self.cached_tokens.values():
            cached.is_exhausted = False
            cached.error_count = 0
        logger.info("已重置所有 token 的状态")
    
    def _move_to_next(self):
        """移动到下一个配置"""
        if len(self.configs) > 1:
            self.current_index = (self.current_index + 1) % len(self.configs)
    
    def get_status(self) -> dict:
        """获取 token 管理器状态（用于健康检查）"""
        return {
            "total_configs": len(self.configs),
            "current_index": self.current_index,
            "current_account": self.configs[self.current_index].name if self.configs else None,
            "cached_tokens": {
                name: {
                    "is_usable": cached.is_usable(),
                    "is_exhausted": cached.is_exhausted,
                    "error_count": cached.error_count,
                    "cached_at": cached.cached_at.isoformat(),
                    "last_used": cached.last_used.isoformat(),
                }
                for name, cached in self.cached_tokens.items()
            }
        }


# 全局单例实例
token_manager = MultiAccountTokenManager()


# 向后兼容的包装类
class TokenManager:
    """向后兼容的 TokenManager 包装器"""
    
    def __init__(self):
        self._manager = token_manager
    
    def get_token(self) -> Optional[str]:
        """同步获取 token（使用事件循环）"""
        try:
            loop = asyncio.get_event_loop()
            if loop.is_running():
                # 如果已经在异步上下文中，创建一个任务
                import concurrent.futures
                with concurrent.futures.ThreadPoolExecutor() as pool:
                    future = pool.submit(asyncio.run, self._manager.get_token())
                    return future.result()
            else:
                return loop.run_until_complete(self._manager.get_token())
        except RuntimeError:
            # 没有事件循环，创建一个新的
            return asyncio.run(self._manager.get_token())
    
    async def refresh_tokens(self) -> Optional[str]:
        """刷新 token"""
        return await self._manager.refresh_tokens()
