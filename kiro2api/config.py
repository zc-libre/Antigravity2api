import os
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# API Key for authentication
API_KEY = os.getenv("API_KEY", "ki2api-key-2024")

# Legacy single account config (向后兼容)
# 新版本使用 KIRO_AUTH_CONFIG，见 auth/config.py
KIRO_ACCESS_TOKEN = os.getenv("KIRO_ACCESS_TOKEN")
KIRO_REFRESH_TOKEN = os.getenv("KIRO_REFRESH_TOKEN")

# Kiro/CodeWhisperer API endpoints
KIRO_BASE_URL = "https://codewhisperer.us-east-1.amazonaws.com/generateAssistantResponse"
PROFILE_ARN = "arn:aws:codewhisperer:us-east-1:699475941385:profile/EHGA3GRVQMUK"

# Model mapping
MODEL_MAP = {
    "claude-sonnet-4-5-20250929": "claude-sonnet-4.5",
    "claude-sonnet-4":  "claude-sonnet-4",
    "claude-opus-4-5-20251101":"claude-opus-4.5",
    "claude-haiku-4-5-20251001":"claude-haiku-4.5"
}
DEFAULT_MODEL = "claude-sonnet-4-5-20250929"
