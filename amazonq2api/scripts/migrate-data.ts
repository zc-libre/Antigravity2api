#!/usr/bin/env npx tsx
/**
 * 数据迁移脚本
 * 将 NDJSON 文件中的账号数据迁移到 PostgreSQL 数据库
 * 
 * 使用方法:
 *   npx tsx scripts/migrate-data.ts [ndjson文件路径]
 * 
 * 示例:
 *   npx tsx scripts/migrate-data.ts output/accounts.ndjson
 *   npx tsx scripts/migrate-data.ts accounts.ndjson
 */

// 必须在导入 PrismaClient 之前加载环境变量
import "dotenv/config";

import fs from "fs";
import path from "path";
import pg from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client.js";

// 旧格式的账号记录
interface LegacyAccountRecord {
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
    lastRefreshStatus?: string;
    lastRefreshTime?: string;
    other?: Record<string, unknown>;
}

async function main(): Promise<void> {
    // 获取文件路径
    const args = process.argv.slice(2);
    const filePath = args[0] || "output/accounts.ndjson";
    const absolutePath = path.isAbsolute(filePath) 
        ? filePath 
        : path.resolve(process.cwd(), filePath);

    console.log("=".repeat(60));
    console.log("📦 Amazon Q 账号数据迁移工具");
    console.log("=".repeat(60));
    console.log(`📂 源文件: ${absolutePath}`);

    // 检查文件是否存在
    if (!fs.existsSync(absolutePath)) {
        console.error(`❌ 错误: 文件不存在 - ${absolutePath}`);
        console.log("\n使用方法:");
        console.log("  npx tsx scripts/migrate-data.ts [ndjson文件路径]");
        console.log("\n示例:");
        console.log("  npx tsx scripts/migrate-data.ts output/accounts.ndjson");
        process.exit(1);
    }

    // 读取 NDJSON 文件
    console.log("\n📖 正在读取文件...");
    const content = await fs.promises.readFile(absolutePath, "utf8");
    const lines = content.split(/\r?\n/).filter(line => line.trim().length > 0);
    
    console.log(`✅ 找到 ${lines.length} 条记录`);

    if (lines.length === 0) {
        console.log("⚠️ 文件为空，无需迁移");
        process.exit(0);
    }

    // 解析记录
    const records: LegacyAccountRecord[] = [];
    const errors: { line: number; error: string }[] = [];

    for (let i = 0; i < lines.length; i++) {
        try {
            const record = JSON.parse(lines[i]!) as LegacyAccountRecord;
            records.push(record);
        } catch (error) {
            errors.push({
                line: i + 1,
                error: error instanceof Error ? error.message : String(error)
            });
        }
    }

    if (errors.length > 0) {
        console.log(`\n⚠️ ${errors.length} 条记录解析失败:`);
        errors.forEach(({ line, error }) => {
            console.log(`   第 ${line} 行: ${error}`);
        });
    }

    console.log(`\n📝 成功解析 ${records.length} 条记录`);

    // 连接数据库
    console.log("\n🔌 正在连接数据库...");
    
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
        console.error("❌ 错误: DATABASE_URL 环境变量未设置");
        process.exit(1);
    }
    
    // Prisma 7.x 需要使用适配器初始化
    const pool = new pg.Pool({ connectionString: databaseUrl });
    const adapter = new PrismaPg(pool);
    const prisma = new PrismaClient({ adapter });

    try {
        await prisma.$connect();
        console.log("✅ 数据库连接成功");

        // 检查现有数据
        const existingCount = await prisma.account.count();
        if (existingCount > 0) {
            console.log(`\n⚠️ 数据库中已有 ${existingCount} 条记录`);
            console.log("   迁移将跳过已存在的记录（按 awsEmail 去重）");
        }

        // 准备导入数据
        console.log("\n📤 正在导入数据...");
        
        let imported = 0;
        let skipped = 0;
        let failed = 0;

        for (const record of records) {
            try {
                // 检查是否已存在
                if (record.awsEmail) {
                    const existing = await prisma.account.findUnique({
                        where: { awsEmail: record.awsEmail }
                    });
                    
                    if (existing) {
                        console.log(`   ⏭️  跳过 (已存在): ${record.awsEmail}`);
                        skipped++;
                        continue;
                    }
                }

                // 创建记录
                await prisma.account.create({
                    data: {
                        clientId: record.clientId,
                        clientSecret: record.clientSecret,
                        accessToken: record.accessToken,
                        refreshToken: record.refreshToken,
                        label: record.label,
                        savedAt: record.savedAt ? new Date(record.savedAt) : new Date(),
                        expiresIn: record.expiresIn,
                        awsEmail: record.awsEmail,
                        awsPassword: record.awsPassword,
                        enabled: record.enabled ?? true,
                        type: record.type ?? "amazonq",
                        lastRefreshStatus: record.lastRefreshStatus,
                        lastRefreshTime: record.lastRefreshTime 
                            ? new Date(record.lastRefreshTime) 
                            : undefined,
                        other: record.other as object
                    }
                });

                console.log(`   ✅ 导入成功: ${record.awsEmail || record.label || "未知"}`);
                imported++;
            } catch (error) {
                console.log(`   ❌ 导入失败: ${record.awsEmail || record.label || "未知"}`);
                console.log(`      错误: ${error instanceof Error ? error.message : String(error)}`);
                failed++;
            }
        }

        // 输出统计
        console.log("\n" + "=".repeat(60));
        console.log("📊 迁移统计");
        console.log("=".repeat(60));
        console.log(`   总记录数: ${records.length}`);
        console.log(`   成功导入: ${imported}`);
        console.log(`   跳过 (已存在): ${skipped}`);
        console.log(`   导入失败: ${failed}`);
        
        // 验证
        const finalCount = await prisma.account.count();
        console.log(`\n📈 数据库当前账号数: ${finalCount}`);

        if (imported > 0) {
            console.log("\n✅ 数据迁移完成！");
        } else if (skipped === records.length) {
            console.log("\n✅ 所有记录已存在，无需迁移");
        } else {
            console.log("\n⚠️ 迁移完成，但存在部分失败");
        }

    } catch (error) {
        console.error("\n❌ 数据库操作失败:", error);
        process.exit(1);
    } finally {
        await prisma.$disconnect();
        await pool.end();
        console.log("\n🔌 数据库连接已关闭");
    }
}

// 运行迁移
main().catch(error => {
    console.error("❌ 迁移脚本执行失败:", error);
    process.exit(1);
});

