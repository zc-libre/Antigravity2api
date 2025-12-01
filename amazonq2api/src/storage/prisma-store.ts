/**
 * Prisma 数据库存储层
 * 提供 Account 的 CRUD 操作
 */

import { PrismaClient, Account } from "../generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";
import { logger } from "../utils/logger.js";

// Prisma Client 单例
let prismaClient: PrismaClient | null = null;

// PostgreSQL 连接池
let pool: pg.Pool | null = null;

/**
 * 获取 Prisma Client 单例
 * Prisma 7 需要使用适配器连接数据库
 */
export function getPrismaClient(): PrismaClient {
    if (!prismaClient) {
        const databaseUrl = process.env.DATABASE_URL;
        if (!databaseUrl) {
            throw new Error("DATABASE_URL 环境变量未设置");
        }

        // 创建 PostgreSQL 连接池
        pool = new pg.Pool({
            connectionString: databaseUrl
        });

        // 创建 Prisma 适配器
        const adapter = new PrismaPg(pool);

        // 使用适配器创建 Prisma Client
        prismaClient = new PrismaClient({ adapter });
    }
    return prismaClient;
}

/**
 * 关闭数据库连接
 */
export async function closePrismaClient(): Promise<void> {
    if (prismaClient) {
        await prismaClient.$disconnect();
        prismaClient = null;
    }
    if (pool) {
        await pool.end();
        pool = null;
    }
    logger.info("数据库连接已关闭");
}

/**
 * 账号记录类型（用于创建/更新）
 */
export interface AccountInput {
    clientId: string;
    clientSecret: string;
    accessToken?: string;
    refreshToken?: string;
    label?: string;
    savedAt?: Date;
    expiresIn?: number;
    awsEmail?: string;
    awsPassword?: string;
    enabled?: boolean;
    type?: string;
    lastRefreshStatus?: string;
    lastRefreshTime?: Date;
    other?: Record<string, unknown>;
}

/**
 * 账号更新类型
 */
export interface AccountUpdate {
    clientId?: string;
    clientSecret?: string;
    accessToken?: string;
    refreshToken?: string;
    label?: string;
    expiresIn?: number;
    awsEmail?: string;
    awsPassword?: string;
    enabled?: boolean;
    type?: string;
    lastRefreshStatus?: string;
    lastRefreshTime?: Date;
    other?: Record<string, unknown>;
}

/**
 * Prisma 存储器
 * 提供账号的数据库 CRUD 操作
 */
export class PrismaStore {
    private prisma: PrismaClient;

    constructor() {
        this.prisma = getPrismaClient();
    }

    /**
     * 创建账号
     */
    async create(data: AccountInput): Promise<Account> {
        const account = await this.prisma.account.create({
            data: {
                clientId: data.clientId,
                clientSecret: data.clientSecret,
                accessToken: data.accessToken,
                refreshToken: data.refreshToken,
                label: data.label,
                savedAt: data.savedAt ?? new Date(),
                expiresIn: data.expiresIn,
                awsEmail: data.awsEmail,
                awsPassword: data.awsPassword,
                enabled: data.enabled ?? true,
                type: data.type ?? "amazonq",
                lastRefreshStatus: data.lastRefreshStatus,
                lastRefreshTime: data.lastRefreshTime,
                other: data.other as object
            }
        });

        logger.info("账号已创建", { id: account.id, email: account.awsEmail });
        return account;
    }

    /**
     * 根据 ID 获取账号
     */
    async findById(id: string): Promise<Account | null> {
        return await this.prisma.account.findUnique({
            where: { id }
        });
    }

    /**
     * 根据邮箱获取账号
     */
    async findByEmail(email: string): Promise<Account | null> {
        return await this.prisma.account.findUnique({
            where: { awsEmail: email }
        });
    }

    /**
     * 获取所有账号
     */
    async findAll(): Promise<Account[]> {
        return await this.prisma.account.findMany({
            orderBy: { createdAt: "desc" }
        });
    }

    /**
     * 获取所有启用的账号
     */
    async findEnabled(type?: string): Promise<Account[]> {
        return await this.prisma.account.findMany({
            where: {
                enabled: true,
                ...(type ? { type } : {})
            },
            orderBy: { createdAt: "desc" }
        });
    }

    /**
     * 更新账号
     */
    async update(id: string, data: AccountUpdate): Promise<Account | null> {
        try {
            const account = await this.prisma.account.update({
                where: { id },
                data: {
                    ...data,
                    other: data.other as object
                }
            });

            logger.debug("账号已更新", { id: account.id });
            return account;
        } catch (error) {
            // 记录不存在时返回 null
            if ((error as any).code === "P2025") {
                return null;
            }
            throw error;
        }
    }

    /**
     * 删除账号
     */
    async delete(id: string): Promise<boolean> {
        try {
            await this.prisma.account.delete({
                where: { id }
            });

            logger.info("账号已删除", { id });
            return true;
        } catch (error) {
            // 记录不存在时返回 false
            if ((error as any).code === "P2025") {
                return false;
            }
            throw error;
        }
    }

    /**
     * 统计账号数量
     */
    async count(enabled?: boolean): Promise<number> {
        return await this.prisma.account.count({
            where: enabled !== undefined ? { enabled } : {}
        });
    }

    /**
     * 随机获取一个启用的账号
     */
    async findRandomEnabled(type: string = "amazonq"): Promise<Account | null> {
        // 先获取符合条件的账号数量
        const count = await this.prisma.account.count({
            where: { enabled: true, type }
        });

        if (count === 0) {
            return null;
        }

        // 随机偏移
        const skip = Math.floor(Math.random() * count);

        const accounts = await this.prisma.account.findMany({
            where: { enabled: true, type },
            skip,
            take: 1
        });

        return accounts[0] ?? null;
    }

    /**
     * 批量创建账号（用于数据迁移）
     */
    async createMany(data: AccountInput[]): Promise<number> {
        const result = await this.prisma.account.createMany({
            data: data.map((d) => ({
                clientId: d.clientId,
                clientSecret: d.clientSecret,
                accessToken: d.accessToken,
                refreshToken: d.refreshToken,
                label: d.label,
                savedAt: d.savedAt ?? new Date(),
                expiresIn: d.expiresIn,
                awsEmail: d.awsEmail,
                awsPassword: d.awsPassword,
                enabled: d.enabled ?? true,
                type: d.type ?? "amazonq",
                lastRefreshStatus: d.lastRefreshStatus,
                lastRefreshTime: d.lastRefreshTime,
                other: d.other as object
            })),
            skipDuplicates: true
        });

        logger.info(`批量创建了 ${result.count} 个账号`);
        return result.count;
    }
}

// 导出 Account 类型
export type { Account };

