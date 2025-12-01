/**
 * 账号管理模块
 * 负责账号的读取、随机选择、状态更新
 * 使用 Prisma 进行数据库操作
 */

import { PrismaStore, AccountInput, AccountUpdate, Account } from "../storage/prisma-store.js";
import { logger } from "../utils/logger.js";

// 重新导出 Account 类型以保持兼容性
export type { Account };

/**
 * 账号管理器
 * 基于 Prisma 的数据库实现
 */
export class AccountManager {
    private readonly store: PrismaStore;

    constructor() {
        this.store = new PrismaStore();
    }

    /**
     * 获取所有账号
     */
    async listAllAccounts(): Promise<Account[]> {
        return await this.store.findAll();
    }

    /**
     * 获取所有启用的账号
     */
    async listEnabledAccounts(accountType?: string): Promise<Account[]> {
        return await this.store.findEnabled(accountType);
    }

    /**
     * 随机选择一个可用账号
     */
    async getRandomAccount(accountType: string = "amazonq"): Promise<Account | null> {
        const account = await this.store.findRandomEnabled(accountType);

        if (!account) {
            logger.warn(`没有可用的 ${accountType} 账号`);
            return null;
        }

        logger.info(`随机选择账号: ${account.label || account.awsEmail || account.id}`);
        return account;
    }

    /**
     * 根据 ID 获取账号
     */
    async getAccount(accountId: string): Promise<Account | null> {
        return await this.store.findById(accountId);
    }

    /**
     * 根据邮箱获取账号
     */
    async getAccountByEmail(email: string): Promise<Account | null> {
        return await this.store.findByEmail(email);
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
        const updates: AccountUpdate = {
            accessToken,
            lastRefreshStatus: status,
            lastRefreshTime: new Date()
        };

        if (refreshToken) {
            updates.refreshToken = refreshToken;
        }

        const account = await this.store.update(accountId, updates);

        if (!account) {
            logger.warn(`账号不存在: ${accountId}`);
            return null;
        }

        return account;
    }

    /**
     * 更新账号状态
     */
    async updateAccount(
        accountId: string,
        updates: Partial<AccountUpdate>
    ): Promise<Account | null> {
        const account = await this.store.update(accountId, updates);

        if (!account) {
            logger.warn(`账号不存在: ${accountId}`);
            return null;
        }

        return account;
    }

    /**
     * 更新刷新状态
     */
    async updateRefreshStatus(accountId: string, status: string): Promise<void> {
        await this.updateAccount(accountId, {
            lastRefreshStatus: status,
            lastRefreshTime: new Date()
        });
    }

    /**
     * 禁用账号
     */
    async disableAccount(accountId: string, reason?: string): Promise<void> {
        const updates: AccountUpdate = {
            enabled: false
        };

        if (reason) {
            const currentAccount = await this.getAccount(accountId);
            const existingOther = (currentAccount?.other as Record<string, unknown>) || {};
            updates.other = {
                ...existingOther,
                disabledReason: reason,
                disabledAt: new Date().toISOString()
            };
        }

        await this.updateAccount(accountId, updates);
        logger.info(`账号已禁用: ${accountId}, 原因: ${reason || "未知"}`);
    }

    /**
     * 启用账号
     */
    async enableAccount(accountId: string): Promise<void> {
        await this.updateAccount(accountId, { enabled: true });
        logger.info(`账号已启用: ${accountId}`);
    }

    /**
     * 添加新账号
     */
    async addAccount(accountData: AccountInput): Promise<Account> {
        const account = await this.store.create(accountData);
        logger.info(`新账号已添加: ${account.label || account.awsEmail || account.id}`);
        return account;
    }

    /**
     * 删除账号
     */
    async deleteAccount(accountId: string): Promise<boolean> {
        const result = await this.store.delete(accountId);

        if (result) {
            logger.info(`账号已删除: ${accountId}`);
        }

        return result;
    }

    /**
     * 统计账号数量
     */
    async countAccounts(enabled?: boolean): Promise<number> {
        return await this.store.count(enabled);
    }

    /**
     * 批量添加账号（用于数据迁移）
     */
    async addAccountsBatch(accounts: AccountInput[]): Promise<number> {
        return await this.store.createMany(accounts);
    }

    /**
     * 强制刷新缓存（保留接口兼容，数据库模式下无需操作）
     */
    invalidateCache(): void {
        // 数据库模式下不需要缓存刷新
        logger.debug("invalidateCache 调用（数据库模式下忽略）");
    }
}

// 默认账号管理器实例
let defaultAccountManager: AccountManager | null = null;

/**
 * 获取默认账号管理器
 */
export function getAccountManager(): AccountManager {
    if (!defaultAccountManager) {
        defaultAccountManager = new AccountManager();
    }
    return defaultAccountManager;
}

/**
 * 初始化账号管理器
 * @deprecated 数据库模式下不再需要传入文件路径，保留此函数仅为兼容性
 */
export function initAccountManager(_filePath?: string): AccountManager {
    if (!defaultAccountManager) {
        defaultAccountManager = new AccountManager();
    }
    return defaultAccountManager;
}
