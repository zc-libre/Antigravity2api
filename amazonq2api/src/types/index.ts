/**
 * 全局通用类型定义。
 */
export type LogLevel = "debug" | "info" | "warn" | "error";

/**
 * OIDC 客户端注册凭据。
 */
export interface OIDCClientCredentials {
    clientId: string;
    clientSecret: string;
    clientSecretExpiresAt?: number;
}

/**
 * 设备授权响应。
 */
export interface DeviceAuthorization {
    deviceCode: string;
    userCode: string;
    verificationUri: string;
    verificationUriComplete: string;
    expiresIn: number;
    interval: number;
}

/**
 * Token 返回结构。
 */
export interface TokenResponse {
    accessToken: string;
    refreshToken?: string;
    tokenType: string;
    expiresIn: number;
    idToken?: string;
}

/**
 * 账号存储结构。
 */
export interface AccountRecord {
    clientId: string;
    clientSecret: string;
    accessToken: string;
    refreshToken?: string;
    label?: string;
    savedAt: string;
    expiresIn?: number;
    awsEmail?: string;
    awsPassword?: string;
}

/**
 * 重试配置。
 */
export interface RetryOptions {
    maxRetries: number;
    baseDelayMs: number;
    backoffFactor?: number;
    maxDelayMs?: number;
}

/**
 * 代理配置。
 */
export interface ProxyConfig {
    httpProxy?: string;
    rotateList?: string[];
}
