import { loadConfig, AppConfig } from "./config.js";
import { AccountRecord } from "./types/index.js";
import { registerClient } from "./oidc/client.js";
import { startDeviceAuthorization } from "./oidc/device-auth.js";
import { pollForTokens } from "./oidc/token.js";
import { FileStore } from "./storage/file-store.js";
import { logger } from "./utils/logger.js";
import { withRetry } from "./utils/retry.js";
import { registerWithCamoufox, ensureCamoufoxInstalled } from "./browser/camoufox-bridge.js";

interface AutoRegisterOptions {
    /** 密码（可选，未提供时自动生成） */
    password?: string;
    /** 注册用全名（可选） */
    fullName?: string;
    /** 是否无头模式 */
    headless?: boolean;
    /** 标签 */
    label?: string;
    /** 最大重试次数 */
    maxRetries?: number;
    /** 配置（可选） */
    config?: AppConfig;
}

/**
 * 全自动注册 Amazon Q 账号，返回存储后的账号记录。
 * 
 * 流程说明：
 * 1. 先注册 OIDC 客户端并获取设备授权码
 * 2. 使用 Camoufox 打开设备验证链接
 * 3. 使用临时邮箱自动完成注册+授权
 */
export async function autoRegister(options: AutoRegisterOptions = {}): Promise<AccountRecord> {
    const config = options.config ?? loadConfig();
    const fileStore = new FileStore(config.outputFile);

    const maxRetries = options.maxRetries ?? 3;
    const headless = options.headless ?? config.headless;
    const label = options.label ?? `Auto-${Date.now()}`;

    if (!config.gptmail) {
        throw new Error("未配置 GPTMail API，无法使用临时邮箱注册模式");
    }

    const execute = async (): Promise<AccountRecord> => {
        // 第一步：先获取设备授权码（不需要浏览器）
        const { clientId, clientSecret } = await registerClient(config.proxyManager);
        const deviceAuth = await startDeviceAuthorization(clientId, clientSecret, config.proxyManager);
        logger.info("设备授权已获取", { verificationUrl: deviceAuth.verificationUriComplete });

        // 创建一个可控的 Token 轮询函数
        const startTokenPolling = (timeoutSec: number) => pollForTokens(
            clientId,
            clientSecret,
            deviceAuth.deviceCode,
            deviceAuth.interval,
            deviceAuth.expiresIn,
            config.proxyManager,
            timeoutSec
        );

        // 开始初始 Token 轮询（10 分钟超时，不阻塞）
        let tokenPromise = startTokenPolling(600);
        let tokenError: Error | null = null;
        
        // 捕获 Token 轮询错误，但不让它中断主流程
        tokenPromise = tokenPromise.catch((err) => {
            tokenError = err;
            logger.warn("Token 轮询超时，等待浏览器流程完成后重试");
            return null as any;
        });

        // 确保 Camoufox 已安装（未安装时自动安装）
        await ensureCamoufoxInstalled();

        // 使用 Camoufox 注册
        const proxy = config.proxyManager.getNextProxy();
        
        const result = await registerWithCamoufox(
            deviceAuth.verificationUriComplete,
            {
                gptmail: config.gptmail,
                password: options.password,
                fullName: options.fullName,
                headless,
                proxy: proxy ?? undefined
            }
        );

        if (!result.success) {
            throw new Error(`Camoufox 注册失败: ${result.message} (${result.errorCode})`);
        }

        const finalCredentials = {
            email: result.email!,
            password: result.password!
        };

        logger.info("Camoufox 注册成功", { email: finalCredentials.email });

        // 等待 Token（如果初始轮询已完成）
        let tokens = await tokenPromise;
        
        // 如果初始轮询超时了，浏览器流程已完成，再次尝试获取 Token
        if (!tokens && tokenError) {
            logger.info("浏览器流程已完成，重新开始 Token 轮询");
            tokens = await startTokenPolling(120);  // 再给 2 分钟
        }
        
        if (!tokens) {
            throw new Error("无法获取 Token，授权可能未完成");
        }

        const account: AccountRecord = {
            clientId,
            clientSecret,
            accessToken: tokens.accessToken,
            refreshToken: tokens.refreshToken,
            savedAt: new Date().toISOString(),
            label,
            expiresIn: tokens.expiresIn,
            awsEmail: finalCredentials.email,
            awsPassword: finalCredentials.password
        };

        await fileStore.append(account);
        logger.info("自动注册完成");
        return account;
    };

    return withRetry(execute, {
        maxRetries,
        baseDelayMs: 2_000,
        backoffFactor: 2,
        maxDelayMs: 15_000
    });
}

async function main(): Promise<void> {
    const config = loadConfig();

    const account = await autoRegister({
        fullName: process.env.AWS_FULL_NAME,
        password: process.env.AWS_PASSWORD,
        headless: config.headless,
        label: `Temp-${Date.now()}`,
        config
    });

    logger.info("结果", account);
}

if (import.meta.url === `file://${process.argv[1]}`) {
    main().catch((error) => {
        logger.error("执行失败", { error: error instanceof Error ? error.message : String(error) });
        process.exitCode = 1;
    });
}
