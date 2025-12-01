import { loadConfig, AppConfig } from "./config.js";
import { AccountRecord } from "./types/index.js";
import { registerClient } from "./oidc/client.js";
import { startDeviceAuthorization } from "./oidc/device-auth.js";
import { pollForTokens } from "./oidc/token.js";
import { PrismaStore } from "./storage/prisma-store.js";
import { logger } from "./utils/logger.js";
import { withRetry } from "./utils/retry.js";
import { registerWithCamoufox, ensureCamoufoxInstalled } from "./browser/camoufox-bridge.js";

export interface AutoRegisterOptions {
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
    /** 进度回调（可选） */
    onProgress?: (step: string, percent: number, message?: string) => void;
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
    const prismaStore = new PrismaStore();

    const maxRetries = options.maxRetries ?? 3;
    const headless = options.headless ?? config.headless;
    const label = options.label ?? `Auto-${Date.now()}`;

    if (!config.gptmail) {
        throw new Error("未配置 GPTMail API，无法使用临时邮箱注册模式");
    }

    const onProgress = options.onProgress ?? (() => {});

    const execute = async (): Promise<AccountRecord> => {
        // 第一步：先获取设备授权码（不需要浏览器）
        onProgress("注册 OIDC 客户端", 5, "正在注册 OIDC 客户端...");
        const { clientId, clientSecret } = await registerClient(config.proxyManager);
        
        onProgress("获取设备授权", 10, "正在获取设备授权码...");
        const deviceAuth = await startDeviceAuthorization(clientId, clientSecret, config.proxyManager);
        logger.info("设备授权已获取", { verificationUrl: deviceAuth.verificationUriComplete });
        onProgress("设备授权成功", 15, `获取验证链接: ${deviceAuth.verificationUriComplete.substring(0, 50)}...`);

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
        onProgress("检查浏览器环境", 20, "正在检查 Camoufox 浏览器环境...");
        await ensureCamoufoxInstalled();
        onProgress("浏览器环境就绪", 25, "Camoufox 浏览器已就绪");

        // 使用 Camoufox 注册
        const proxy = config.proxyManager.getNextProxy();
        
        onProgress("启动浏览器注册", 30, "正在启动浏览器进行自动注册...");
        
        const result = await registerWithCamoufox(
            deviceAuth.verificationUriComplete,
            {
                gptmail: config.gptmail!, // 已在上方检查过不为 undefined
                password: options.password,
                fullName: options.fullName,
                headless,
                proxy: proxy ?? undefined,
                onProgress: (step, message) => {
                    // 浏览器注册过程占 30% - 80%
                    const browserSteps: Record<string, number> = {
                        "init": 35,
                        "navigate": 40,
                        "create_email": 45,
                        "fill_email": 50,
                        "submit_email": 55,
                        "verify_email": 60,
                        "fill_profile": 65,
                        "fill_password": 70,
                        "submit_register": 75,
                        "authorize": 80,
                        "done": 85
                    };
                    const percent = browserSteps[step] ?? 50;
                    onProgress(step, percent, message);
                }
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
        onProgress("浏览器注册完成", 85, `注册邮箱: ${finalCredentials.email}`);

        // 等待 Token（如果初始轮询已完成）
        onProgress("获取访问令牌", 90, "正在等待获取访问令牌...");
        let tokens = await tokenPromise;
        
        // 如果初始轮询超时了，浏览器流程已完成，再次尝试获取 Token
        if (!tokens && tokenError) {
            logger.info("浏览器流程已完成，重新开始 Token 轮询");
            onProgress("重试获取令牌", 92, "Token 轮询超时，重新尝试获取...");
            tokens = await startTokenPolling(120);  // 再给 2 分钟
        }
        
        if (!tokens) {
            throw new Error("无法获取 Token，授权可能未完成");
        }
        
        onProgress("令牌获取成功", 95, "成功获取访问令牌");

        // 保存到数据库
        onProgress("保存账号信息", 98, "正在保存账号信息到数据库...");
        const savedAccount = await prismaStore.create({
            clientId,
            clientSecret,
            accessToken: tokens.accessToken,
            refreshToken: tokens.refreshToken,
            savedAt: new Date(),
            label,
            expiresIn: tokens.expiresIn,
            awsEmail: finalCredentials.email,
            awsPassword: finalCredentials.password
        });

        logger.info("自动注册完成", { id: savedAccount.id });
        onProgress("完成", 100, "自动注册流程完成");

        // 返回兼容的 AccountRecord 格式
        const account: AccountRecord = {
            clientId: savedAccount.clientId,
            clientSecret: savedAccount.clientSecret,
            accessToken: savedAccount.accessToken || "",
            refreshToken: savedAccount.refreshToken ?? undefined,
            savedAt: savedAccount.savedAt.toISOString(),
            label: savedAccount.label ?? undefined,
            expiresIn: savedAccount.expiresIn ?? undefined,
            awsEmail: savedAccount.awsEmail ?? undefined,
            awsPassword: savedAccount.awsPassword ?? undefined
        };

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

// CLI 模式入口
if (import.meta.url === `file://${process.argv[1]}`) {
    main().catch((error) => {
        logger.error("执行失败", { error: error instanceof Error ? error.message : String(error) });
        process.exitCode = 1;
    });
}
