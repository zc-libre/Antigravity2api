#!/usr/bin/env python3
"""
自动读取Kiro token的脚本
在Docker容器启动时自动读取宿主机的token文件
"""

import os
import json
import sys
from pathlib import Path

def get_token_file_path():
    """获取token文件路径"""
    home = Path.home()
    return home / ".aws" / "sso" / "cache" / "kiro-auth-token.json"

def read_tokens():
    """读取token文件"""
    token_file = get_token_file_path()
    
    if not token_file.exists():
        print(f"❌ Token文件不存在: {token_file}")
        print("请确保已登录Kiro，或手动创建token文件")
        return None, None
    
    try:
        with open(token_file, 'r', encoding='utf-8') as f:
            data = json.load(f)
        
        access_token = data.get('accessToken')
        refresh_token = data.get('refreshToken')
        
        if not access_token or not refresh_token:
            print("❌ Token文件格式错误，缺少accessToken或refreshToken")
            return None, None
            
        return access_token, refresh_token
        
    except json.JSONDecodeError:
        print("❌ Token文件JSON格式错误")
        return None, None
    except Exception as e:
        print(f"❌ 读取token文件失败: {e}")
        return None, None

def create_env_file(access_token, refresh_token):
    """创建.env文件"""
    env_content = f"""# Kiro Token配置
# 自动生成于 {os.path.basename(__file__)}
KIRO_ACCESS_TOKEN={access_token}
KIRO_REFRESH_TOKEN={refresh_token}
"""
    
    with open('.env', 'w', encoding='utf-8') as f:
        f.write(env_content)
    
    print("✅ .env文件已创建/更新")

def main():
    """主函数"""
    print("🔍 正在读取Kiro token...")
    
    access_token, refresh_token = read_tokens()
    
    if access_token and refresh_token:
        create_env_file(access_token, refresh_token)
        print("✅ Token读取成功，服务即将启动...")
        return 0
    else:
        print("❌ 无法获取token，请检查：")
        print("1. 是否已登录Kiro (https://kiro.dev)")
        print("2. token文件是否存在: ~/.aws/sso/cache/kiro-auth-token.json")
        print("3. 或手动创建.env文件并设置token")
        return 1

if __name__ == "__main__":
    sys.exit(main())