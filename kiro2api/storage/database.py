"""
数据库连接管理
"""
import os
import logging
from typing import AsyncGenerator
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker

from .models import Base

logger = logging.getLogger(__name__)

# 全局引擎和会话工厂
_engine = None
_async_session_factory = None


def get_database_url() -> str:
    """获取数据库连接 URL"""
    url = os.getenv("DATABASE_URL")
    if not url:
        raise ValueError("DATABASE_URL 环境变量未设置")

    # 将 postgresql:// 转换为 postgresql+asyncpg://
    if url.startswith("postgresql://"):
        url = url.replace("postgresql://", "postgresql+asyncpg://", 1)
    elif url.startswith("postgres://"):
        url = url.replace("postgres://", "postgresql+asyncpg://", 1)

    return url


async def init_db():
    """初始化数据库连接"""
    global _engine, _async_session_factory

    if _engine is not None:
        return

    database_url = get_database_url()
    logger.info(f"初始化数据库连接...")

    _engine = create_async_engine(
        database_url,
        echo=False,
        pool_size=5,
        max_overflow=10,
    )

    _async_session_factory = async_sessionmaker(
        _engine,
        class_=AsyncSession,
        expire_on_commit=False,
    )

    # 注意：不自动创建表，使用与 amazonq2api 相同的数据库
    # 表结构由 Prisma 管理
    logger.info("数据库连接初始化完成")


async def close_db():
    """关闭数据库连接"""
    global _engine, _async_session_factory

    if _engine is not None:
        await _engine.dispose()
        _engine = None
        _async_session_factory = None
        logger.info("数据库连接已关闭")


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    """获取数据库会话"""
    if _async_session_factory is None:
        await init_db()

    async with _async_session_factory() as session:
        try:
            yield session
        finally:
            await session.close()
