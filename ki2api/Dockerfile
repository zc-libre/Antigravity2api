FROM python:3.11-slim

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y \
    gcc \
    curl \
    && rm -rf /var/lib/apt/lists/*

RUN pip config set global.index-url https://pypi.tuna.tsinghua.edu.cn/simple

# Copy requirements and install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code (modular structure)
COPY app.py models.py parsers.py token_manager.py token_reader.py __init__.py entrypoint.sh ./

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