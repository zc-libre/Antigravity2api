#!/bin/sh
# ============================================
# Amazon Q API - 容器启动脚本
# ============================================
# 在启动应用前执行数据库迁移

set -e

echo "🔄 Waiting for database to be ready..."

# 等待数据库连接可用
until nc -z postgres 5432 2>/dev/null; do
  echo "⏳ Database is unavailable - sleeping"
  sleep 2
done

echo "✅ Database is up!"

echo "🔄 Running database migrations..."

# 运行 Prisma 迁移
# 使用 db push 进行开发/简单部署（自动同步 schema）
# 生产环境建议使用 migrate deploy
npx prisma db push --skip-generate

echo "✅ Database migrations completed!"

echo "🚀 Starting Amazon Q API server..."

# 启动应用
exec npx tsx src/server.ts

