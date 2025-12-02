# ============================================
# Amazon Q to API - Docker 镜像
# ============================================
# 
# 构建镜像:
#   docker build -t amazonq2api .
# 
# 运行容器:
#   docker run -d --name amazonq2api \
#     -p 3000:3000 \
#     -e GPTMAIL_API_KEY=your-key \
#     -e HEADLESS=true \
#     amazonq2api
#
# 或使用 .env 文件:
#   docker run -d --name amazonq2api \
#     -p 3000:3000 \
#     --env-file .env \
#     amazonq2api
# ============================================

# 使用 Node.js 20 作为基础镜像（基于 Debian Bookworm）
FROM node:20-bookworm-slim AS base

# 设置环境变量
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    # Playwright 浏览器路径
    PLAYWRIGHT_BROWSERS_PATH=/app/browsers \
    # Camoufox 缓存目录
    CAMOUFOX_DATA_DIR=/app/.camoufox \
    # 默认无头模式
    HEADLESS=true \
    # Node.js 生产模式
    NODE_ENV=production \
    # 端口
    PORT=3000

# 安装系统依赖
RUN apt-get update && apt-get install -y --no-install-recommends \
    # Python 相关
    python3 \
    python3-pip \
    python3-venv \
    # 构建工具
    build-essential \
    # 浏览器依赖（Playwright/Camoufox 需要）
    libnss3 \
    libnspr4 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdrm2 \
    libdbus-1-3 \
    libxkbcommon0 \
    libatspi2.0-0 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxrandr2 \
    libgbm1 \
    libasound2 \
    libpango-1.0-0 \
    libcairo2 \
    # X11 相关（无头模式也需要）
    libx11-6 \
    libx11-xcb1 \
    libxcb1 \
    libxext6 \
    # 字体
    fonts-liberation \
    fonts-noto-cjk \
    # 网络工具
    ca-certificates \
    wget \
    curl \
    netcat-openbsd \
    # 清理
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# 创建 Python 虚拟环境链接
RUN ln -sf /usr/bin/python3 /usr/bin/python

# 设置工作目录
WORKDIR /app

# ============================================
# Node.js 依赖安装阶段
# ============================================
FROM base AS node-deps

# 复制 package.json 和 lock 文件
COPY package.json package-lock.json* pnpm-lock.yaml* ./

# 安装 Node.js 依赖
RUN npm install --omit=dev || npm install

# ============================================
# Python 依赖安装阶段
# ============================================
FROM base AS python-deps

# 创建 Python 虚拟环境
RUN python3 -m venv /app/camoufox/.venv

# 复制 Python 依赖文件
COPY camoufox/requirements.txt /app/camoufox/

# 安装 Python 依赖
RUN /app/camoufox/.venv/bin/pip install --upgrade pip \
    && /app/camoufox/.venv/bin/pip install -r /app/camoufox/requirements.txt

# 预下载 Camoufox 浏览器和扩展
RUN /app/camoufox/.venv/bin/python -c "from camoufox.sync_api import Camoufox; print('Camoufox core ready')"

# 下载并验证扩展
RUN /app/camoufox/.venv/bin/python -c "\
import os, shutil; \
from camoufox.addons import get_addon_path, maybe_download_addons, DefaultAddons; \
addon_path = get_addon_path('UBO'); \
manifest_path = os.path.join(addon_path, 'manifest.json'); \
os.path.exists(addon_path) and not os.path.exists(manifest_path) and shutil.rmtree(addon_path); \
addon_list = []; \
maybe_download_addons([DefaultAddons.UBO], addon_list); \
print('Extensions ready') \
"

# ============================================
# 最终运行阶段
# ============================================
FROM base AS runtime

# 创建非 root 用户
RUN groupadd --gid 1000 appuser \
    && useradd --uid 1000 --gid appuser --shell /bin/bash --create-home appuser

# 设置工作目录
WORKDIR /app

# 从 node-deps 阶段复制 node_modules
COPY --from=node-deps /app/node_modules ./node_modules

# 从 python-deps 阶段复制 Python 虚拟环境
COPY --from=python-deps /app/camoufox/.venv ./camoufox/.venv

# 从 python-deps 阶段复制 Camoufox 浏览器缓存
# Camoufox 默认将浏览器下载到用户目录下
COPY --from=python-deps /root/.local /home/appuser/.local
COPY --from=python-deps /root/.cache /home/appuser/.cache

# 复制项目源代码
COPY --chown=appuser:appuser . .

# 创建输出目录
RUN mkdir -p /app/output && chown -R appuser:appuser /app

# 设置目录权限
RUN chown -R appuser:appuser /home/appuser

# 切换到非 root 用户
USER appuser

# 暴露端口
EXPOSE 3000

# 健康检查
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
    CMD curl -f http://localhost:${PORT}/health || exit 1

# 确保 entrypoint 脚本可执行
RUN chmod +x /app/entrypoint.sh

# 使用 entrypoint 脚本启动（会先运行数据库迁移）
ENTRYPOINT ["/app/entrypoint.sh"]
