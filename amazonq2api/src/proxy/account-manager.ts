/**
 * 账号管理模块
 * 负责账号的读取、随机选择、状态更新
 */

import fs from "fs";
import path from "path";
import { logger } from "../utils/logger.js";

/**
 * 账号记录接口
 */
export interface Account {
    id?: string;
    clientId: string;
    clientSecret: string;
    accessToken?: string;
    refreshToken?: string;
    label?: string;
    savedAt?: string;
    expiresIn?: number;
    awsEmail?: string;
    awsPassword?: string;
    enabled?: boolean;
    type?: string;
    other?: Record<string, unknown>;
    lastRefreshStatus?: string;
    lastRefreshTime?: string;
}

/**
 * 账号管理器
 */
export class AccountManager {
    private readonly filePath: string;
    private accounts: Account[] = [];
    private lastLoadTime: number = 0;
    private readonly cacheTimeMs: number = 5000; // 5秒缓存

    constructor(filePath: string) {
        this.filePath = filePath;
    }

    /**
     * 从文件加载账号列表
     */
    async loadAccounts(): Promise<Account[]> {
        const now = Date.now();
        // 使用缓存
        if (this.accounts.length > 0 && now - this.lastLoadTime < this.cacheTimeMs) {
            return this.accounts;
        }

        if (!fs.existsSync(this.filePath)) {
            logger.warn(`账号文件不存在: ${this.filePath}`);
            return [];
        }

        try {
            const content = await fs.promises.readFile(this.filePath, "utf8");
            this.accounts = content
                .split(/\r?\n/)
                .filter(line => line.trim().length > 0)
                .map((line, index) => {
                    const account = JSON.parse(line) as Account;
                    // 生成 ID（如果没有）
                    if (!account.id) {
                        account.id = `acc_${index}_${Date.now()}`;
                    }
                    // 默认启用
                    if (account.enabled === undefined) {
                        account.enabled = true;
                    }
                    // 默认类型
                    if (!account.type) {
                        account.type = "amazonq";
                    }
                    return account;
                });

            this.lastLoadTime = now;
            logger.info(`加载了 ${this.accounts.length} 个账号`);
            return this.accounts;
        } catch (error) {
            logger.error(`读取账号文件失败: ${error}`);
            return [];
        }
    }

    /**
     * 获取所有账号
     */
    async listAllAccounts(): Promise<Account[]> {
        return await this.loadAccounts();
    }

    /**
     * 获取所有启用的账号
     */
    async listEnabledAccounts(accountType?: string): Promise<Account[]> {
        const accounts = await this.loadAccounts();
        return accounts.filter(acc => {
            const enabled = acc.enabled !== false;
            const typeMatch = !accountType || acc.type === accountType;
            return enabled && typeMatch;
        });
    }

    /**
     * 随机选择一个可用账号
     */
    async getRandomAccount(accountType: string = "amazonq"): Promise<Account | null> {
        const enabledAccounts = await this.listEnabledAccounts(accountType);

        if (enabledAccounts.length === 0) {
            logger.warn(`没有可用的 ${accountType} 账号`);
            return null;
        }

        // 随机选择
        const randomIndex = Math.floor(Math.random() * enabledAccounts.length);
        const account = enabledAccounts[randomIndex]!;
        logger.info(`随机选择账号: ${account.label || account.awsEmail || account.id}`);
        return account;
    }

    /**
     * 根据 ID 获取账号
     */
    async getAccount(accountId: string): Promise<Account | null> {
        const accounts = await this.loadAccounts();
        const account = accounts.find(acc => acc.id === accountId);
        return account ?? null;
    }

    /**
     * 根据邮箱获取账号
     */
    async getAccountByEmail(email: string): Promise<Account | null> {
        const accounts = await this.loadAccounts();
        const account = accounts.find(acc => acc.awsEmail === email);
        return account ?? null;
    }

    /**
     * 更新账号的 token
     */
    async updateAccountTokens(
        accountId: string,
        accessToken: string,
        refreshToken?: string,
        status: string = "success"
    ): Promise<Account | null> {
        const accounts = await this.loadAccounts();
        const index = accounts.findIndex(acc => acc.id === accountId);

        if (index === -1) {
            logger.warn(`账号不存在: ${accountId}`);
            return null;
        }

        // 更新账号
        const account = accounts[index]!;
        account.accessToken = accessToken;
        if (refreshToken) {
            account.refreshToken = refreshToken;
        }
        account.lastRefreshStatus = status;
        account.lastRefreshTime = new Date().toISOString();

        // 保存到文件
        await this.saveAccounts(accounts);
        this.accounts = accounts;

        return account;
    }

    /**
     * 更新账号状态
     */
    async updateAccount(
        accountId: string,
        updates: Partial<Account>
    ): Promise<Account | null> {
        const accounts = await this.loadAccounts();
        const index = accounts.findIndex(acc => acc.id === accountId);

        if (index === -1) {
            logger.warn(`账号不存在: ${accountId}`);
            return null;
        }

        // 更新账号
        const account = accounts[index]!;
        Object.assign(account, updates);

        // 保存到文件
        await this.saveAccounts(accounts);
        this.accounts = accounts;

        return account;
    }

    /**
     * 更新刷新状态
     */
    async updateRefreshStatus(accountId: string, status: string): Promise<void> {
        await this.updateAccount(accountId, {
            lastRefreshStatus: status,
            lastRefreshTime: new Date().toISOString()
        });
    }

    /**
     * 禁用账号
     */
    async disableAccount(accountId: string, reason?: string): Promise<void> {
        const updates: Partial<Account> = {
            enabled: false
        };

        if (reason) {
            const currentAccount = await this.getAccount(accountId);
            updates.other = {
                ...(currentAccount?.other || {}),
                disabledReason: reason,
                disabledAt: new Date().toISOString()
            };
        }

        await this.updateAccount(accountId, updates);
        logger.info(`账号已禁用: ${accountId}, 原因: ${reason || "未知"}`);
    }

    /**
     * 保存账号列表到文件
     */
    private async saveAccounts(accounts: Account[]): Promise<void> {
        try {
            const dir = path.dirname(this.filePath);
            await fs.promises.mkdir(dir, { recursive: true });

            const content = accounts.map(acc => JSON.stringify(acc)).join("\n") + "\n";
            await fs.promises.writeFile(this.filePath, content, "utf8");
            logger.debug(`账号列表已保存: ${this.filePath}`);
        } catch (error) {
            logger.error(`保存账号文件失败: ${error}`);
            throw error;
        }
    }

    /**
     * 添加新账号
     */
    async addAccount(account: Account): Promise<Account> {
        const accounts = await this.loadAccounts();

        // 生成 ID
        if (!account.id) {
            account.id = `acc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        }

        // 设置默认值
        if (account.enabled === undefined) {
            account.enabled = true;
        }
        if (!account.type) {
            account.type = "amazonq";
        }
        if (!account.savedAt) {
            account.savedAt = new Date().toISOString();
        }

        accounts.push(account);
        await this.saveAccounts(accounts);
        this.accounts = accounts;

        logger.info(`新账号已添加: ${account.label || account.awsEmail || account.id}`);
        return account;
    }

    /**
     * 删除账号
     */
    async deleteAccount(accountId: string): Promise<boolean> {
        const accounts = await this.loadAccounts();
        const index = accounts.findIndex(acc => acc.id === accountId);

        if (index === -1) {
            return false;
        }

        accounts.splice(index, 1);
        await this.saveAccounts(accounts);
        this.accounts = accounts;

        logger.info(`账号已删除: ${accountId}`);
        return true;
    }

    /**
     * 强制刷新缓存
     */
    invalidateCache(): void {
        this.lastLoadTime = 0;
    }
}

// 默认账号管理器实例
let defaultAccountManager: AccountManager | null = null;

/**
 * 获取默认账号管理器
 */
export function getAccountManager(filePath?: string): AccountManager {
    if (!defaultAccountManager && filePath) {
        defaultAccountManager = new AccountManager(filePath);
    }
    if (!defaultAccountManager) {
        throw new Error("AccountManager 未初始化，请先提供 filePath");
    }
    return defaultAccountManager;
}

/**
 * 初始化账号管理器
 */
export function initAccountManager(filePath: string): AccountManager {
    defaultAccountManager = new AccountManager(filePath);
    return defaultAccountManager;
}

