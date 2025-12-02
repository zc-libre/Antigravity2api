"""
账号存储层
提供 Account 的 CRUD 操作
"""
import logging
import secrets
import string
from datetime import datetime
from typing import Optional, List

from sqlalchemy import select, update, delete, func
from sqlalchemy.ext.asyncio import AsyncSession

from .models import Account
from .database import get_db

logger = logging.getLogger(__name__)


def generate_cuid() -> str:
    """生成类似 cuid 的 ID"""
    # 简化版 cuid: 时间戳 + 随机字符
    timestamp = hex(int(datetime.utcnow().timestamp() * 1000))[2:]
    random_part = ''.join(secrets.choice(string.ascii_lowercase + string.digits) for _ in range(12))
    return f"c{timestamp}{random_part}"[:25]


class AccountStore:
    """账号存储器"""

    def __init__(self, session: AsyncSession):
        self.session = session

    async def create(
        self,
        refresh_token: str,
        name: Optional[str] = None,
        enabled: bool = True,
        access_token: Optional[str] = None,
    ) -> Account:
        """创建账号"""
        account = Account(
            id=generate_cuid(),
            clientId="",
            clientSecret="",
            refreshToken=refresh_token,
            accessToken=access_token,
            label=name,
            enabled=enabled,
            type="kiro",
            savedAt=datetime.utcnow(),
            createdAt=datetime.utcnow(),
            updatedAt=datetime.utcnow(),
        )

        self.session.add(account)
        await self.session.commit()
        await self.session.refresh(account)

        logger.info(f"账号已创建: {account.id} (label: {account.label})")
        return account

    async def find_by_id(self, id: str) -> Optional[Account]:
        """根据 ID 获取账号"""
        result = await self.session.execute(
            select(Account).where(Account.id == id)
        )
        return result.scalar_one_or_none()

    async def find_all(self, type: str = "kiro") -> List[Account]:
        """获取所有指定类型的账号"""
        result = await self.session.execute(
            select(Account)
            .where(Account.type == type)
            .order_by(Account.createdAt.desc())
        )
        return list(result.scalars().all())

    async def find_enabled(self, type: str = "kiro") -> List[Account]:
        """获取所有启用的账号"""
        result = await self.session.execute(
            select(Account)
            .where(Account.type == type, Account.enabled == True)
            .order_by(Account.createdAt.desc())
        )
        return list(result.scalars().all())

    async def update(
        self,
        id: str,
        enabled: Optional[bool] = None,
        label: Optional[str] = None,
        access_token: Optional[str] = None,
        refresh_token: Optional[str] = None,
        last_refresh_status: Optional[str] = None,
        last_refresh_time: Optional[datetime] = None,
    ) -> Optional[Account]:
        """更新账号"""
        updates = {"updatedAt": datetime.utcnow()}

        if enabled is not None:
            updates["enabled"] = enabled
        if label is not None:
            updates["label"] = label
        if access_token is not None:
            updates["accessToken"] = access_token
        if refresh_token is not None:
            updates["refreshToken"] = refresh_token
        if last_refresh_status is not None:
            updates["lastRefreshStatus"] = last_refresh_status
        if last_refresh_time is not None:
            updates["lastRefreshTime"] = last_refresh_time

        await self.session.execute(
            update(Account).where(Account.id == id).values(**updates)
        )
        await self.session.commit()

        return await self.find_by_id(id)

    async def delete(self, id: str) -> bool:
        """删除账号"""
        result = await self.session.execute(
            delete(Account).where(Account.id == id)
        )
        await self.session.commit()

        deleted = result.rowcount > 0
        if deleted:
            logger.info(f"账号已删除: {id}")
        return deleted

    async def count(self, type: str = "kiro", enabled: Optional[bool] = None) -> int:
        """统计账号数量"""
        query = select(func.count(Account.id)).where(Account.type == type)
        if enabled is not None:
            query = query.where(Account.enabled == enabled)

        result = await self.session.execute(query)
        return result.scalar_one()
