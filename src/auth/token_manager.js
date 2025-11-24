import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { log } from '../utils/logger.js';
import config from '../config/config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DEFAULT_CLIENT_ID = config.oauth.clientId;
const DEFAULT_CLIENT_SECRET = config.oauth.clientSecret;

class TokenManager {
  constructor(filePath = path.join(__dirname,'..','..','data' ,'accounts.json')) {
    this.filePath = filePath;
    this.tokens = [];
    this.currentIndex = 0;
    this.lastLoadTime = 0;
    this.loadInterval = 60000; // 1分钟内不重复加载
    this.cachedData = null; // 缓存文件数据，减少磁盘读取
    this.usageStats = new Map(); // Token 使用统计 { refresh_token -> { requests, lastUsed } }
    this.loadTokens();
  }

  loadTokens() {
    try {
      // 避免频繁加载，1分钟内使用缓存
      if (Date.now() - this.lastLoadTime < this.loadInterval && this.tokens.length > 0) {
        return;
      }

      log.info('正在加载token...');
      const data = fs.readFileSync(this.filePath, 'utf8');
      const tokenArray = JSON.parse(data);
      this.cachedData = tokenArray; // 缓存原始数据
      this.tokens = tokenArray
        .filter(token => token.enable !== false)
        .map(token => ({
          ...token,
          client_id: token.client_id || DEFAULT_CLIENT_ID,
          client_secret: token.client_secret || DEFAULT_CLIENT_SECRET,
          project_id: token.project_id || null
        }));
      this.currentIndex = 0;
      this.lastLoadTime = Date.now();
      log.info(`成功加载 ${this.tokens.length} 个可用token`);

      // 触发垃圾回收（如果可用）
      if (global.gc) {
        global.gc();
      }
    } catch (error) {
      log.error('加载token失败:', error.message);
      this.tokens = [];
    }
  }

  isExpired(token) {
    if (!token.timestamp || !token.expires_in) return true;
    const expiresAt = token.timestamp + (token.expires_in * 1000);
    return Date.now() >= expiresAt - 300000;
  }

  getClientId(token) {
    return token.client_id || DEFAULT_CLIENT_ID;
  }

  getClientSecret(token) {
    return token.client_secret || DEFAULT_CLIENT_SECRET;
  }

  async refreshToken(token) {
    log.info('正在刷新token...');
    const clientId = this.getClientId(token);
    const clientSecret = this.getClientSecret(token);

    const body = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'refresh_token',
      refresh_token: token.refresh_token
    });

    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: {
        'Host': 'oauth2.googleapis.com',
        'User-Agent': 'Go-http-client/1.1',
        'Content-Length': body.toString().length.toString(),
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept-Encoding': 'gzip'
      },
      body: body.toString()
    });

    if (response.ok) {
      const data = await response.json();
      token.access_token = data.access_token;
      token.expires_in = data.expires_in;
      token.timestamp = Date.now();
      this.saveToFile();
      return token;
    } else {
      throw { statusCode: response.status, message: await response.text() };
    }
  }

  saveToFile() {
    try {
      // 使用缓存数据，减少磁盘读取
      let allTokens = this.cachedData;
      if (!allTokens) {
        const data = fs.readFileSync(this.filePath, 'utf8');
        allTokens = JSON.parse(data);
      }

      this.tokens.forEach(memToken => {
        const index = allTokens.findIndex(t => t.refresh_token === memToken.refresh_token);
        if (index !== -1) allTokens[index] = memToken;
      });

      fs.writeFileSync(this.filePath, JSON.stringify(allTokens, null, 2), 'utf8');
      this.cachedData = allTokens; // 更新缓存
    } catch (error) {
      log.error('保存文件失败:', error.message);
    }
  }

  disableToken(token) {
    log.warn(`禁用token`)
    token.enable = false;
    this.saveToFile();
    this.loadTokens();
  }

  async getToken() {
    if (this.tokens.length === 0) return null;

    for (let i = 0; i < this.tokens.length; i++) {
      const token = this.tokens[this.currentIndex];
      const tokenIndex = this.currentIndex;

      try {
        if (this.isExpired(token)) {
          await this.refreshToken(token);
        }
        this.currentIndex = (this.currentIndex + 1) % this.tokens.length;

        // 记录使用统计
        this.recordUsage(token);
        log.info(`🔄 轮询使用 Token #${tokenIndex} (总请求: ${this.getTokenRequests(token)})`);

        return token;
      } catch (error) {
        if (error.statusCode === 403) {
          log.warn(`Token ${this.currentIndex} 刷新失败(403)，禁用并尝试下一个`);
          this.disableToken(token);
        } else {
          log.error(`Token ${this.currentIndex} 刷新失败:`, error.message);
        }
        this.currentIndex = (this.currentIndex + 1) % this.tokens.length;
        if (this.tokens.length === 0) return null;
      }
    }

    return null;
  }

  // 记录 Token 使用
  recordUsage(token) {
    const key = token.refresh_token;
    if (!this.usageStats.has(key)) {
      this.usageStats.set(key, { requests: 0, lastUsed: null });
    }
    const stats = this.usageStats.get(key);
    stats.requests++;
    stats.lastUsed = Date.now();
  }

  // 获取单个 Token 的请求次数
  getTokenRequests(token) {
    const stats = this.usageStats.get(token.refresh_token);
    return stats ? stats.requests : 0;
  }

  // 获取所有 Token 的使用统计
  getUsageStats() {
    const stats = [];
    this.tokens.forEach((token, index) => {
      const usage = this.usageStats.get(token.refresh_token) || { requests: 0, lastUsed: null };
      stats.push({
        index,
        requests: usage.requests,
        lastUsed: usage.lastUsed ? new Date(usage.lastUsed).toISOString() : null,
        isCurrent: index === this.currentIndex
      });
    });
    return {
      totalTokens: this.tokens.length,
      currentIndex: this.currentIndex,
      totalRequests: Array.from(this.usageStats.values()).reduce((sum, s) => sum + s.requests, 0),
      tokens: stats
    };
  }

  disableCurrentToken(token) {
    const found = this.tokens.find(t => t.access_token === token.access_token);
    if (found) {
      this.disableToken(found);
    }
  }

  async handleRequestError(error, currentAccessToken) {
    if (error.statusCode === 403) {
      log.warn('请求遇到403错误，尝试刷新token');
      const currentToken = this.tokens[this.currentIndex];
      if (currentToken && currentToken.access_token === currentAccessToken) {
        try {
          await this.refreshToken(currentToken);
          log.info('Token刷新成功，返回新token');
          return currentToken;
        } catch (refreshError) {
          if (refreshError.statusCode === 403) {
            log.warn('刷新token也遇到403，禁用并切换到下一个');
            this.disableToken(currentToken);
            return await this.getToken();
          }
          log.error('刷新token失败:', refreshError.message);
        }
      }
      return await this.getToken();
    }
    return null;
  }
}
const tokenManager = new TokenManager();
export default tokenManager;
