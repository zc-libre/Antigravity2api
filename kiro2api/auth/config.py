"""
多账号认证配置模块
支持从 JSON 文件或环境变量加载多个 Kiro 账号配置
"""
import os
import json
import logging
from typing import List, Optional
from dataclasses import dataclass

logger = logging.getLogger(__name__)


@dataclass
class AuthConfig:
    """单个认证配置"""
    refresh_token: str
    access_token: Optional[str] = None
    disabled: bool = False
    name: Optional[str] = None  # 可选的配置名称，用于标识

    def __post_init__(self):
        if not self.refresh_token:
            raise ValueError("refresh_token 不能为空")


def load_auth_configs() -> List[AuthConfig]:
    """
    从环境变量加载认证配置
    
    支持两种格式：
    1. KIRO_AUTH_CONFIG 指向 JSON 配置文件路径
    2. KIRO_AUTH_CONFIG 直接为 JSON 字符串
    3. 向后兼容：使用单独的 KIRO_REFRESH_TOKEN 和 KIRO_ACCESS_TOKEN 环境变量
    
    JSON 格式示例：
    [
        {"refreshToken": "token1", "name": "account1"},
        {"refreshToken": "token2", "name": "account2", "disabled": false}
    ]
    """
    # 检查是否有新的 KIRO_AUTH_CONFIG 配置
    auth_config_env = os.getenv("KIRO_AUTH_CONFIG")
    
    if auth_config_env:
        logger.info("检测到 KIRO_AUTH_CONFIG 环境变量")
        return _load_from_json_config(auth_config_env)
    
    # 向后兼容：使用旧的环境变量
    logger.info("未找到 KIRO_AUTH_CONFIG，尝试使用旧的环境变量格式")
    return _load_legacy_config()


def _load_from_json_config(config_value: str) -> List[AuthConfig]:
    """
    从 JSON 配置加载
    
    Args:
        config_value: 可以是文件路径或 JSON 字符串
    """
    config_data = config_value
    
    # 检查是否为文件路径
    if os.path.isfile(config_value):
        logger.info(f"从文件加载认证配置: {config_value}")
        try:
            with open(config_value, 'r', encoding='utf-8') as f:
                config_data = f.read()
        except Exception as e:
            logger.error(f"读取配置文件失败: {e}")
            raise ValueError(f"无法读取配置文件 {config_value}: {e}")
    else:
        logger.debug("作为 JSON 字符串解析 KIRO_AUTH_CONFIG")
    
    # 解析 JSON
    try:
        parsed = json.loads(config_data)
    except json.JSONDecodeError as e:
        raise ValueError(f"JSON 解析失败: {e}")
    
    # 支持单个对象或数组
    if isinstance(parsed, dict):
        parsed = [parsed]
    
    if not isinstance(parsed, list):
        raise ValueError("KIRO_AUTH_CONFIG 必须是 JSON 对象或数组")
    
    configs = []
    for i, item in enumerate(parsed):
        try:
            config = _parse_single_config(item, i)
            if config and not config.disabled:
                configs.append(config)
                logger.info(f"加载配置 #{i + 1}: {config.name or 'unnamed'}")
            elif config and config.disabled:
                logger.info(f"跳过已禁用的配置 #{i + 1}: {config.name or 'unnamed'}")
        except Exception as e:
            logger.warning(f"解析配置 #{i + 1} 失败: {e}")
    
    if not configs:
        raise ValueError("没有找到有效的认证配置")
    
    logger.info(f"成功加载 {len(configs)} 个认证配置")
    return configs


def _parse_single_config(item: dict, index: int) -> Optional[AuthConfig]:
    """解析单个配置项"""
    if not isinstance(item, dict):
        raise ValueError(f"配置项必须是对象")
    
    # 支持 camelCase 和 snake_case
    refresh_token = item.get("refreshToken") or item.get("refresh_token")
    access_token = item.get("accessToken") or item.get("access_token")
    disabled = item.get("disabled", False)
    name = item.get("name", f"account_{index + 1}")
    
    if not refresh_token:
        raise ValueError("refreshToken 是必需的")
    
    return AuthConfig(
        refresh_token=refresh_token,
        access_token=access_token,
        disabled=disabled,
        name=name
    )


def _load_legacy_config() -> List[AuthConfig]:
    """
    加载旧格式的配置（向后兼容）
    使用 KIRO_REFRESH_TOKEN 和 KIRO_ACCESS_TOKEN 环境变量
    """
    refresh_token = os.getenv("KIRO_REFRESH_TOKEN")
    access_token = os.getenv("KIRO_ACCESS_TOKEN")
    
    if not refresh_token:
        raise ValueError(
            "未找到认证配置。请设置以下环境变量之一：\n"
            "1. KIRO_AUTH_CONFIG - JSON 配置文件路径或 JSON 字符串\n"
            "2. KIRO_REFRESH_TOKEN - 单账号 refresh token\n\n"
            "多账号配置示例：\n"
            'KIRO_AUTH_CONFIG=\'[{"refreshToken":"token1","name":"account1"},{"refreshToken":"token2","name":"account2"}]\''
        )
    
    logger.info("使用旧格式配置（单账号模式）")
    return [AuthConfig(
        refresh_token=refresh_token,
        access_token=access_token,
        name="default"
    )]

