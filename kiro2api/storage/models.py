"""
数据库模型定义
与 amazonq2api 的 Account 表结构保持一致
"""
from datetime import datetime
from typing import Optional
from sqlalchemy import String, Boolean, Integer, DateTime, Text, Index
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column
from sqlalchemy.dialects.postgresql import JSON


class Base(DeclarativeBase):
    pass


class Account(Base):
    """
    Kiro 账号记录
    字段与 amazonq2api 的 Prisma Account 模型保持一致
    """
    __tablename__ = "Account"

    id: Mapped[str] = mapped_column(String(30), primary_key=True)
    clientId: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    clientSecret: Mapped[str] = mapped_column(Text, nullable=False, default="")
    accessToken: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    refreshToken: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    label: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    savedAt: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    expiresIn: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    awsEmail: Mapped[Optional[str]] = mapped_column(String(255), nullable=True, unique=True)
    awsPassword: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    type: Mapped[str] = mapped_column(String(50), default="kiro")
    lastRefreshStatus: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    lastRefreshTime: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    other: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)
    createdAt: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updatedAt: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = (
        Index("idx_account_enabled", "enabled"),
        Index("idx_account_type", "type"),
        Index("idx_account_awsEmail", "awsEmail"),
    )

    def to_dict(self) -> dict:
        """转换为字典"""
        return {
            "id": self.id,
            "clientId": self.clientId,
            "clientSecret": self.clientSecret,
            "accessToken": self.accessToken,
            "refreshToken": self.refreshToken,
            "label": self.label,
            "savedAt": self.savedAt.isoformat() if self.savedAt else None,
            "expiresIn": self.expiresIn,
            "awsEmail": self.awsEmail,
            "awsPassword": self.awsPassword,
            "enabled": self.enabled,
            "type": self.type,
            "lastRefreshStatus": self.lastRefreshStatus,
            "lastRefreshTime": self.lastRefreshTime.isoformat() if self.lastRefreshTime else None,
            "other": self.other,
            "createdAt": self.createdAt.isoformat() if self.createdAt else None,
            "updatedAt": self.updatedAt.isoformat() if self.updatedAt else None,
        }
