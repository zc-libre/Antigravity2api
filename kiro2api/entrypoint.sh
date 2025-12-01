#!/bin/bash

# 智能Docker入口脚本
# 自动读取token并启动服务

echo "🚀 Ki2API 启动中..."

# 检查是否存在token文件
TOKEN_FILE="/root/.aws/sso/cache/kiro-auth-token.json"

if [ -f "$TOKEN_FILE" ]; then
    echo "📁 发现token文件，正在读取..."
    
    # 运行token读取脚本
    python token_reader.py
    
    if [ $? -eq 0 ]; then
        echo "✅ Token配置完成"
    else
        echo "⚠️  Token读取失败，继续启动（需要手动配置token）"
    fi
else
    echo "⚠️  未找到token文件: $TOKEN_FILE"
    echo "请确保已登录Kiro，或手动设置环境变量"
fi

# 检查环境变量
if [ -z "$KIRO_ACCESS_TOKEN" ] || [ -z "$KIRO_REFRESH_TOKEN" ]; then
    echo "⚠️  环境变量未设置，尝试从.env文件加载..."
    if [ -f ".env" ]; then
        export $(cat .env | xargs)
        echo "✅ 已从.env文件加载token"
    else
        echo "❌ 未找到token配置，服务可能无法正常工作"
        echo "请设置 KIRO_ACCESS_TOKEN 和 KIRO_REFRESH_TOKEN 环境变量"
    fi
fi

# 启动应用
echo "🎯 启动FastAPI服务..."
exec python app.py