/**
 * Camoufox Python 桥接器
 * 通过子进程调用 Python Camoufox 脚本完成注册
 */
import { spawn } from "child_process";
import path from "path";
import { fileURLToPath } from "url";
import { logger } from "../utils/logger.js";
import { GPTMailConfig } from "../config.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface CamoufoxOptions {
    /** 是否无头模式 */
    headless?: boolean;
    /** 代理服务器 */
    proxy?: string;
    /** Python 可执行文件路径（默认使用 camoufox/.venv/bin/python） */
    pythonPath?: string;
    /** 超时时间（毫秒） */
    timeoutMs?: number;
}

export interface CamoufoxRegistrationOptions extends CamoufoxOptions {
    /** GPTMail 配置 */
    gptmail: GPTMailConfig;
    /** 密码（可选，未提供时由 Python 自动生成） */
    password?: string;
    /** 显示名称 */
    fullName?: string;
}

export interface CamoufoxResult {
    success: boolean;
    message: string;
    errorCode?: string;
    /** 注册成功时返回的邮箱 */
    email?: string;
    /** 注册成功时返回的密码 */
    password?: string;
}

/**
 * 使用 Camoufox 完成设备授权注册
 */
export async function registerWithCamoufox(
    verificationUrl: string,
    options: CamoufoxRegistrationOptions
): Promise<CamoufoxResult> {
    const camoufoxDir = path.resolve(__dirname, "../../camoufox");
    const scriptPath = path.join(camoufoxDir, "login_handler.py");
    const defaultPythonPath = path.join(camoufoxDir, ".venv/bin/python");
    
    const pythonPath = options.pythonPath ?? defaultPythonPath;
    const timeoutMs = options.timeoutMs ?? 300_000; // 注册流程需要 5 分钟
    
    const args = [
        scriptPath,
        "--url", verificationUrl,
        "--mode", "register",
        "--gptmail-url", options.gptmail.baseUrl,
        "--gptmail-key", options.gptmail.apiKey,
        "--json"
    ];
    
    // 密码可选，未提供时由 Python 自动生成
    if (options.password) {
        args.push("--password", options.password);
    }
    
    if (options.gptmail.emailPrefix) {
        args.push("--email-prefix", options.gptmail.emailPrefix);
    }
    
    if (options.gptmail.emailDomain) {
        args.push("--email-domain", options.gptmail.emailDomain);
    }
    
    if (options.fullName) {
        args.push("--full-name", options.fullName);
    }
    
    if (options.headless) {
        args.push("--headless");
    }
    
    if (options.proxy) {
        args.push("--proxy", options.proxy);
    }
    
    logger.info("启动 Camoufox 注册", { verificationUrl: verificationUrl.slice(0, 50) + "..." });
    
    return new Promise((resolve, reject) => {
        const process = spawn(pythonPath, args, {
            cwd: camoufoxDir,
            env: { 
                ...globalThis.process.env,
                PYTHONUNBUFFERED: "1"  // 实时输出
            }
        });
        
        let stdout = "";
        let stderr = "";
        
        const timeout = setTimeout(() => {
            process.kill("SIGTERM");
            reject(new Error(`Camoufox 注册超时 (${timeoutMs}ms)`));
        }, timeoutMs);
        
        process.stdout.on("data", (data) => {
            const text = data.toString();
            stdout += text;
            // 实时输出日志
            for (const line of text.split("\n")) {
                const trimmed = line.trim();
                if (trimmed && !trimmed.startsWith("{")) {
                    logger.info("[Camoufox]", { output: trimmed });
                }
            }
        });
        
        process.stderr.on("data", (data) => {
            stderr += data.toString();
            logger.warn("[Camoufox stderr]", { output: data.toString().trim() });
        });
        
        process.on("close", (code) => {
            clearTimeout(timeout);
            
            try {
                const lines = stdout.trim().split("\n");
                const jsonLine = lines.find(line => line.trim().startsWith("{"));
                
                if (jsonLine) {
                    const result = JSON.parse(jsonLine) as CamoufoxResult;
                    logger.info("Camoufox 注册完成", { 
                        success: result.success, 
                        message: result.message,
                        email: result.email
                    });
                    resolve(result);
                    return;
                }
            } catch (e) {
                // JSON 解析失败
            }
            
            if (code === 0) {
                resolve({ success: true, message: "注册成功" });
            } else {
                resolve({
                    success: false,
                    message: stderr || stdout || `进程退出码: ${code}`,
                    errorCode: "PROCESS_EXIT"
                });
            }
        });
        
        process.on("error", (error) => {
            clearTimeout(timeout);
            
            if ((error as NodeJS.ErrnoException).code === "ENOENT") {
                reject(new Error(`未找到 Python 环境，请先运行: cd camoufox && bash setup.sh`));
            } else {
                reject(error);
            }
        });
    });
}

/**
 * 检查 Camoufox 环境是否已安装（包括扩展验证）
 */
export async function checkCamoufoxInstalled(): Promise<boolean> {
    const camoufoxDir = path.resolve(__dirname, "../../camoufox");
    const pythonPath = path.join(camoufoxDir, ".venv/bin/python");
    
    // 完整验证脚本：检查导入 + 尝试启动浏览器（会验证扩展）
    const verifyScript = `
from camoufox.sync_api import Camoufox
with Camoufox(headless=True) as browser:
    page = browser.new_page()
    page.goto('about:blank')
print('ok')
`;
    
    return new Promise((resolve) => {
        const process = spawn(pythonPath, ["-c", verifyScript], {
            cwd: camoufoxDir,
            timeout: 30000  // 30秒超时
        });
        
        let stdout = "";
        
        process.stdout.on("data", (data) => {
            stdout += data.toString();
        });
        
        process.on("close", (code) => {
            resolve(code === 0 && stdout.includes("ok"));
        });
        
        process.on("error", () => {
            resolve(false);
        });
    });
}

/**
 * 自动安装 Camoufox 环境
 */
export async function installCamoufox(): Promise<void> {
    const camoufoxDir = path.resolve(__dirname, "../../camoufox");
    const setupScript = path.join(camoufoxDir, "setup.sh");
    
    logger.info("开始自动安装 Camoufox...");
    
    return new Promise((resolve, reject) => {
        const process = spawn("bash", [setupScript], {
            cwd: camoufoxDir,
            stdio: "pipe",
            env: {
                ...globalThis.process.env,
                // 确保非交互式
                DEBIAN_FRONTEND: "noninteractive"
            }
        });
        
        process.stdout.on("data", (data) => {
            const text = data.toString().trim();
            if (text) {
                logger.info("[Camoufox 安装]", { output: text });
            }
        });
        
        process.stderr.on("data", (data) => {
            const text = data.toString().trim();
            if (text) {
                logger.warn("[Camoufox 安装]", { output: text });
            }
        });
        
        process.on("close", (code) => {
            if (code === 0) {
                logger.info("Camoufox 安装完成");
                resolve();
            } else {
                reject(new Error(`Camoufox 安装失败，退出码: ${code}`));
            }
        });
        
        process.on("error", (error) => {
            reject(new Error(`Camoufox 安装脚本执行失败: ${error.message}`));
        });
    });
}

/**
 * 确保 Camoufox 已安装，如果未安装则自动安装
 */
export async function ensureCamoufoxInstalled(): Promise<void> {
    const installed = await checkCamoufoxInstalled();
    if (!installed) {
        logger.info("检测到 Camoufox 未安装，开始自动安装...");
        await installCamoufox();
        
        // 安装后再次验证
        const verifyInstalled = await checkCamoufoxInstalled();
        if (!verifyInstalled) {
            throw new Error("Camoufox 自动安装后验证失败，请手动运行: cd camoufox && bash setup.sh");
        }
    }
}
