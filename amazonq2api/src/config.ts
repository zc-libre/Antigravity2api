import dotenv from "dotenv";
import { ProxyManager } from "./utils/proxy.js";
import { LogLevel } from "./types/index.js";

dotenv.config();

export const OIDC_BASE = "https://oidc.us-east-1.amazonaws.com";
export const REGISTER_URL = `${OIDC_BASE}/client/register`;
export const DEVICE_AUTH_URL = `${OIDC_BASE}/device_authorization`;
export const TOKEN_URL = `${OIDC_BASE}/token`;
export const START_URL = "https://view.awsapps.com/start";

// Token 刷新用的 User-Agent（与 Python 版本保持一致）
export const USER_AGENT = "aws-sdk-rust/1.3.10 os/macos lang/rust/1.88.0";
export const X_AMZ_USER_AGENT = "aws-sdk-rust/1.3.10 ua/2.1 api/ssooidc/1.88.0 os/macos lang/rust/1.88.0 m/E app/AmazonQ-For-CLI";
export const AMZ_SDK_REQUEST = "attempt=1; max=3";

export interface GPTMailConfig {
    baseUrl: string;
    apiKey: string;
    emailPrefix?: string;
    emailDomain?: string;
    pollIntervalMs?: number;
    timeoutMs?: number;
}

export interface DatabaseConfig {
    url: string;
}

export interface AppConfig {
    headless: boolean;
    proxyManager: ProxyManager;
    logLevel: LogLevel;
    gptmail?: GPTMailConfig;
    database: DatabaseConfig;
}

/**
 * 读取环境变量生成运行配置。
 */
export function loadConfig(): AppConfig {
    // 默认打开可见浏览器窗口（headless: false），设置 HEADLESS=true 可切换到无头模式
    const headless = (process.env.HEADLESS ?? "false").toLowerCase() === "true";
    const proxyManager = ProxyManager.fromEnv();
    const logLevel = (process.env.LOG_LEVEL as LogLevel) ?? "info";
    const gptmailApiKey = process.env.GPTMAIL_API_KEY ?? process.env.GPTMAIL_KEY;
    const gptmail = gptmailApiKey
        ? {
              baseUrl: process.env.GPTMAIL_BASE_URL ?? "https://mail.chatgpt.org.uk",
              apiKey: gptmailApiKey,
              emailPrefix: process.env.GPTMAIL_EMAIL_PREFIX,
              emailDomain: process.env.GPTMAIL_EMAIL_DOMAIN,
              pollIntervalMs: parseNumberEnv(process.env.GPTMAIL_POLL_INTERVAL_MS),
              timeoutMs: parseNumberEnv(process.env.GPTMAIL_TIMEOUT_MS)
          }
        : undefined;

    // 数据库配置
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
        throw new Error("DATABASE_URL 环境变量未设置");
    }

    return {
        headless,
        proxyManager,
        logLevel,
        gptmail,
        database: {
            url: databaseUrl
        }
    };
}

function parseNumberEnv(value?: string): number | undefined {
    if (!value) {
        return undefined;
    }
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : undefined;
}
