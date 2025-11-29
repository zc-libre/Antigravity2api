/**
 * 认证模块
 * 负责 Token 刷新和管理（支持多账号）
 */

import { v4 as uuidv4 } from "uuid";
import { logger } from "../utils/logger.js";
import { Account, AccountManager, getAccountManager } from "./account-manager.js";
import { TOKEN_URL, USER_AGENT, X_AMZ_USER_AGENT, AMZ_SDK_REQUEST } from "../config.js";

/**
 * 请求超时时间（毫秒）
 */
const REQUEST_TIMEOUT_MS = 30000;

/**
 * Token 刷新失败异常
 */
export class TokenRefreshError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "TokenRefreshError";
    }
}

/**
 * 无可用账号异常
 */
export class NoAccountAvailableError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "NoAccountAvailableError";
    }
}

/**
 * 解析 JWT token 获取过期时间
 */
export function parseJwtExpiration(token: string): Date | null {
    try {
        const parts = token.split(".");
        if (parts.length !== 3) {
            return null;
        }

        // 解析 payload (base64url 编码)
        let payload = parts[1]!;
        // 补齐 base64 padding
        payload = payload.replace(/-/g, "+").replace(/_/g, "/");
        while (payload.length % 4) {
            payload += "=";
        }

        const decoded = Buffer.from(payload, "base64").toString("utf8");
        const tokenData = JSON.parse(decoded);

        if (tokenData.exp) {
            return new Date(tokenData.exp * 1000);
        }
        return null;
    } catch (error) {
        logger.warn(`解析 JWT token 失败: ${error}`);
        return null;
    }
}

/**
 * 检查 JWT token 是否过期
 * 注意：与 Python 版本保持一致，解析失败时不视为过期
 */
export function isTokenExpired(token: string): boolean {
    const expiration = parseJwtExpiration(token);
    if (!expiration) {
        // 与 Python 版本保持一致：解析失败时不视为过期
        // 避免不必要的 token 刷新
        return false;
    }
    return new Date() >= expiration;
}

/**
 * 刷新指定账号的 access_token
 */
export async function refreshAccountToken(
    account: Account,
    accountManager?: AccountManager
): Promise<Account> {
    const accountId = account.id || "unknown";

    if (!account.clientId || !account.clientSecret || !account.refreshToken) {
        logger.error(`账号 ${accountId} 缺少必需的刷新凭证`);
        if (accountManager) {
            await accountManager.updateRefreshStatus(accountId, "failed_missing_credentials");
        }
        throw new TokenRefreshError("账号缺少 clientId/clientSecret/refreshToken");
    }

    try {
        logger.info(`开始刷新账号 ${accountId} 的 access_token`);

        // 创建带超时的 AbortController
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

        let response: Response;
        try {
            response = await fetch(TOKEN_URL, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "User-Agent": USER_AGENT,
                    "X-Amz-User-Agent": X_AMZ_USER_AGENT,
                    "Amz-Sdk-Request": AMZ_SDK_REQUEST,
                    "Amz-Sdk-Invocation-Id": uuidv4(),
                    Accept: "*/*",
                    "Accept-Encoding": "gzip, deflate, br"
                },
                body: JSON.stringify({
                    grantType: "refresh_token",
                    refreshToken: account.refreshToken,
                    clientId: account.clientId,
                    clientSecret: account.clientSecret
                }),
                signal: controller.signal
            });
        } finally {
            clearTimeout(timeoutId);
        }

        if (!response.ok) {
            const errorText = await response.text();
            logger.error(`账号 ${accountId} Token 刷新失败 - HTTP 错误: ${response.status}`);
            if (accountManager) {
                await accountManager.updateRefreshStatus(accountId, `failed_${response.status}`);
            }
            throw new TokenRefreshError(`HTTP 错误: ${response.status} - ${errorText}`);
        }

        const responseData = await response.json();
        const newAccessToken = responseData.accessToken;
        const newRefreshToken = responseData.refreshToken || account.refreshToken;

        if (!newAccessToken) {
            throw new TokenRefreshError("响应中缺少 accessToken");
        }

        // 更新账号（优先返回持久化后的最新状态，与 Python 版本保持一致）
        let updatedAccount: Account = {
            ...account,
            accessToken: newAccessToken,
            refreshToken: newRefreshToken,
            lastRefreshStatus: "success",
            lastRefreshTime: new Date().toISOString()
        };

        // 如果提供了 accountManager，保存更新
        if (accountManager && account.id) {
            const persistedAccount = await accountManager.updateAccountTokens(
                account.id,
                newAccessToken,
                newRefreshToken,
                "success"
            );
            if (persistedAccount) {
                updatedAccount = persistedAccount;
            }
        }

        logger.info(`账号 ${accountId} Token 刷新成功`);
        return updatedAccount;
    } catch (error) {
        if (error instanceof TokenRefreshError) {
            throw error;
        }
        
        // 区分网络错误和其他错误（与 Python 版本保持一致）
        if (error instanceof Error) {
            if (error.name === "AbortError") {
                logger.error(`账号 ${accountId} Token 刷新失败 - 请求超时`);
                if (accountManager && account.id) {
                    await accountManager.updateRefreshStatus(account.id, "failed_timeout");
                }
                throw new TokenRefreshError("请求超时");
            }
            
            if (error.name === "TypeError" && error.message.includes("fetch")) {
                logger.error(`账号 ${accountId} Token 刷新失败 - 网络错误: ${error.message}`);
                if (accountManager && account.id) {
                    await accountManager.updateRefreshStatus(account.id, "failed_network");
                }
                throw new TokenRefreshError(`网络错误: ${error.message}`);
            }
        }
        
        logger.error(`账号 ${accountId} Token 刷新失败 - 未知错误: ${error}`);
        if (accountManager && account.id) {
            await accountManager.updateRefreshStatus(account.id, "failed_unknown");
        }
        throw new TokenRefreshError(`未知错误: ${error}`);
    }
}

/**
 * 获取一个随机账号及其有效的 access_token
 */
export async function getAccountWithToken(
    accountManager: AccountManager
): Promise<{ account: Account; accessToken: string }> {
    const account = await accountManager.getRandomAccount("amazonq");

    if (!account) {
        throw new NoAccountAvailableError("没有可用的账号");
    }

    let accessToken = account.accessToken;
    let tokenExpired = false;

    // 检查 JWT token 是否过期
    if (accessToken) {
        tokenExpired = isTokenExpired(accessToken);
        if (tokenExpired) {
            logger.info(`账号 ${account.id} 的 accessToken 已过期`);
        }
    }

    // 如果没有 access_token 或 token 已过期，尝试刷新
    if (!accessToken || tokenExpired) {
        logger.info(`账号 ${account.id} 需要刷新 token`);
        const refreshedAccount = await refreshAccountToken(account, accountManager);
        accessToken = refreshedAccount.accessToken;

        if (!accessToken) {
            throw new TokenRefreshError("刷新后仍无法获取 accessToken");
        }

        return { account: refreshedAccount, accessToken };
    }

    return { account, accessToken };
}

/**
 * 为指定账号获取认证头
 */
export async function getAuthHeadersForAccount(
    account: Account,
    accountManager?: AccountManager
): Promise<Record<string, string>> {
    let accessToken = account.accessToken;
    let tokenExpired = false;

    // 检查 JWT token 是否过期
    if (accessToken) {
        tokenExpired = isTokenExpired(accessToken);
        if (tokenExpired) {
            logger.info(`账号 ${account.id} 的 accessToken 已过期`);
        }
    }

    // 如果没有 access_token 或 token 已过期，尝试刷新
    if (!accessToken || tokenExpired) {
        logger.info(`账号 ${account.id} 需要刷新 token`);
        const refreshedAccount = await refreshAccountToken(account, accountManager);
        accessToken = refreshedAccount.accessToken;

        if (!accessToken) {
            throw new TokenRefreshError("刷新后仍无法获取 accessToken");
        }
    }

    return {
        Authorization: `Bearer ${accessToken}`
    };
}

/**
 * 获取认证头，支持多账号随机选择
 */
export async function getAuthHeadersWithRetry(
    accountManager: AccountManager
): Promise<{ account: Account; headers: Record<string, string> }> {
    const { account, accessToken } = await getAccountWithToken(accountManager);

    return {
        account,
        headers: {
            Authorization: `Bearer ${accessToken}`
        }
    };
}

/**
 * 构建完整的 Amazon Q 请求头
 */
export function buildAmazonQHeaders(authHeaders: Record<string, string>): Record<string, string> {
    return {
        ...authHeaders,
        "Content-Type": "application/x-amz-json-1.0",
        "X-Amz-Target": "AmazonCodeWhispererStreamingService.GenerateAssistantResponse",
        "User-Agent":
            "aws-sdk-rust/1.3.9 ua/2.1 api/codewhispererstreaming/0.1.11582 os/macos lang/rust/1.87.0 md/appVersion-1.19.3 app/AmazonQ-For-CLI",
        "X-Amz-User-Agent":
            "aws-sdk-rust/1.3.9 ua/2.1 api/codewhispererstreaming/0.1.11582 os/macos lang/rust/1.87.0 m/F app/AmazonQ-For-CLI",
        "X-Amzn-Codewhisperer-Optout": "true",
        "Amz-Sdk-Request": "attempt=1; max=3",
        "Amz-Sdk-Invocation-Id": uuidv4(),
        Accept: "*/*",
        "Accept-Encoding": "gzip, deflate, br"
    };
}

