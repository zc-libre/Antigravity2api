#!/usr/bin/env python3
"""
Gemini OAuth 凭证获取客户端
独立脚本，用于获取 Gemini 的 client_id, client_secret, refresh_token
"""
import asyncio
import webbrowser
from aiohttp import web
import secrets
from urllib.parse import urlencode
import httpx

# Antigravity 应用的 OAuth 配置
GOOGLE_CLIENT_ID = "自己填写自己的.apps.googleusercontent.com"
GOOGLE_CLIENT_SECRET = "GOCSPX-自己填写自己的"
GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
CALLBACK_PORT = 63902

SCOPES = [
    "https://www.googleapis.com/auth/cloud-platform",
    "https://www.googleapis.com/auth/userinfo.email",
    "https://www.googleapis.com/auth/userinfo.profile",
    "https://www.googleapis.com/auth/cclog",
    "https://www.googleapis.com/auth/experimentsandconfigs"
]

# 全局变量存储授权码
auth_code = None
auth_error = None


async def handle_callback(request):
    """处理 OAuth 回调"""
    global auth_code, auth_error

    code = request.query.get('code')
    error = request.query.get('error')

    if error:
        auth_error = error
        html = f"""
        <!DOCTYPE html>
        <html>
        <head><title>认证失败</title></head>
        <body style="font-family: Arial; text-align: center; padding: 50px;">
            <h1 style="color: red;">❌ 认证失败</h1>
            <p>错误: {error}</p>
            <p>您可以关闭此窗口了</p>
        </body>
        </html>
        """
    else:
        auth_code = code
        html = """
        <!DOCTYPE html>
        <html>
        <head><title>认证成功</title></head>
        <body style="font-family: Arial; text-align: center; padding: 50px;">
            <h1 style="color: #4CAF50;">✓ 认证成功</h1>
            <p>您可以关闭此窗口了</p>
        </body>
        </html>
        """

    return web.Response(text=html, content_type='text/html')


async def start_callback_server():
    """启动回调服务器"""
    app = web.Application()
    app.router.add_get('/oauth-callback', handle_callback)

    runner = web.AppRunner(app)
    await runner.setup()
    site = web.TCPSite(runner, 'localhost', CALLBACK_PORT)
    await site.start()

    print(f"✓ 回调服务器已启动: http://localhost:{CALLBACK_PORT}")
    return runner


async def exchange_code_for_tokens(code, client_secret):
    """交换授权码获取 tokens"""
    async with httpx.AsyncClient() as client:
        response = await client.post(
            GOOGLE_TOKEN_URL,
            data={
                "client_id": GOOGLE_CLIENT_ID,
                "client_secret": client_secret,
                "code": code,
                "grant_type": "authorization_code",
                "redirect_uri": f"http://localhost:{CALLBACK_PORT}/oauth-callback"
            },
            headers= {
                'x-goog-api-client': 'gl-node/22.18.0',
                'User-Agent': 'google-api-nodejs-client/10.3.0'
            }
        )

        if response.status_code != 200:
            raise Exception(f"Token 交换失败: {response.text}")

        return response.json()


async def main():
    """主函数"""
    print("=" * 60)
    print("Antigravity OAuth 凭证获取工具")
    print("=" * 60)
    print()

    # 生成状态码
    state = secrets.token_urlsafe(32)

    # 构建授权 URL
    params = {
        "client_id": GOOGLE_CLIENT_ID,
        "redirect_uri": f"http://localhost:{CALLBACK_PORT}/oauth-callback",
        "response_type": "code",
        "scope": " ".join(SCOPES),
        "access_type": "offline",
        "prompt": "consent",
        "state": state
    }
    auth_url = f"{GOOGLE_AUTH_URL}?{urlencode(params)}"

    # 启动回调服务器
    runner = await start_callback_server()

    print()
    print("步骤 1: 请在浏览器中完成 Google 授权")
    print("-" * 60)
    print(f"授权 URL: {auth_url}")
    print()

    # 自动打开浏览器
    try:
        webbrowser.open(auth_url)
        print("✓ 已自动打开浏览器")
    except:
        print("⚠ 无法自动打开浏览器，请手动复制上面的 URL 到浏览器中")

    print()
    print("等待授权完成...")
    print()

    # 等待授权完成
    while auth_code is None and auth_error is None:
        await asyncio.sleep(0.5)

    # 停止服务器
    await runner.cleanup()

    if auth_error:
        print(f"❌ 授权失败: {auth_error}")
        return

    print("✓ 授权成功，已获取授权码")

    # 交换 tokens (公开客户端不需要 client_secret)
    print("步骤 2: 交换授权码获取 tokens...")
    print("-" * 60)

    try:
        tokens = await exchange_code_for_tokens(auth_code, GOOGLE_CLIENT_SECRET)

        print("✓ 成功获取 tokens!")
        print()
        print("=" * 60)
        print("凭证信息")
        print("=" * 60)
        print()
        print(f"Client ID:")
        print(f"  {GOOGLE_CLIENT_ID}")
        print()
        print(f"Client Secret:")
        print(f"  {GOOGLE_CLIENT_SECRET}")
        print()
        print(f"Refresh Token:")
        print(f"  {tokens.get('refresh_token', '未获取到 refresh_token')}")
        print()
        print(f"Access Token:")
        print(f"  {tokens.get('access_token', 'N/A')[:50]}...")
        print()
        print(f"Expires In:")
        print(f"  {tokens.get('expires_in', 'N/A')} 秒")
        print()
        print("=" * 60)
        print()

        # 保存到文件
        save = input("是否保存凭证到文件? (y/n): ").strip().lower()
        if save == 'y':
            import json
            credentials = {
                "client_id": GOOGLE_CLIENT_ID,
                "client_secret": GOOGLE_CLIENT_SECRET,
                "refresh_token": tokens.get('refresh_token'),
                "access_token": tokens.get('access_token'),
                "expires_in": tokens.get('expires_in')
            }

            filename = "gemini_credentials.json"
            with open(filename, 'w') as f:
                json.dump(credentials, f, indent=2)

            print(f"✓ 凭证已保存到: {filename}")

    except Exception as e:
        print(f"❌ 获取 tokens 失败: {e}")


if __name__ == "__main__":
    asyncio.run(main())
