FROM python:3.11-slim

WORKDIR /app

# Install system dependencies for Camoufox/Playwright
RUN apt-get update && apt-get install -y \
    gcc \
    curl \
    # Playwright/Camoufox dependencies
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
    libgtk-3-0 \
    && rm -rf /var/lib/apt/lists/*

RUN pip config set global.index-url https://pypi.tuna.tsinghua.edu.cn/simple

# Copy requirements and install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Download Camoufox browser
RUN python3 -c "from camoufox.sync_api import Camoufox; print('Camoufox ready')"

# Copy application code
COPY app.py config.py token_reader.py entrypoint.sh ./
COPY models/ ./models/
COPY auth/ ./auth/
COPY parsers/ ./parsers/
COPY services/ ./services/
COPY storage/ ./storage/
COPY browser/ ./browser/
COPY camoufox/ ./camoufox/
COPY oidc/ ./oidc/
COPY register/ ./register/

# Copy example config for multi-account setup
COPY auth_config.json.example ./

# Make entrypoint executable
RUN chmod +x entrypoint.sh

# Create .aws directory structure
RUN mkdir -p /root/.aws/sso/cache

# Expose port
EXPOSE 8989

# Health check
HEALTHCHECK --interval=30s --timeout=30s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:8989/health || exit 1

# Use entrypoint script for smart startup
ENTRYPOINT ["./entrypoint.sh"]