import express from 'express';
import https from 'https';
import multer from 'multer';
import archiver from 'archiver';
import crypto from 'crypto';
import { createKey, loadKeys, deleteKey, updateKeyRateLimit, getKeyStats } from './key_manager.js';
import { getRecentLogs, clearLogs, addLog } from './log_manager.js';
import { getSystemStatus, incrementRequestCount } from './monitor.js';
import { loadAccounts, deleteAccount, toggleAccount, triggerLogin, getAccountStats, addTokenFromCallback, addDirectToken, getAccountName, importTokens } from './token_admin.js';
import { createSession, validateSession, destroySession, verifyPassword, adminAuth } from './session.js';
import { loadSettings, saveSettings } from './settings_manager.js';
import tokenManager from '../auth/token_manager.js';
import {
  registerUser,
  loginUser,
  getUserById,
  generateUserApiKey,
  deleteUserApiKey,
  getUserApiKeys,
  updateUser,
  getAllUsers,
  toggleUserStatus,
  getUserStats,
  deleteUser,
  getUserTokens,
  addUserToken,
  deleteUserToken as deleteUserGoogleToken,
  updateTokenSharing,
  getAllSharedTokens,
  getRandomSharedToken,
  getSharedTokenStats
} from './user_manager.js';
import {
  generateDeviceFingerprint,
  isIPBanned,
  isDeviceBanned,
  checkIPRegistrationLimit,
  checkDeviceRegistrationLimit,
  recordRegistration,
  getSecurityStats,
  unbanIP,
  unbanDevice
} from './security_manager.js';
import {
  createAnnouncement,
  updateAnnouncement,
  deleteAnnouncement,
  loadAnnouncements,
  getActiveAnnouncements,
  getAnnouncementById
} from './announcement_manager.js';
import {
  fetchAndSaveModels,
  loadModels,
  updateModelQuota,
  toggleModel,
  getModelStats,
  checkModelQuota,
  recordModelUsage,
  getUserModelUsage,
  setUserModelQuota,
  getUserModelQuota,
  cleanupOldUsage
} from './model_manager.js';
import * as shareManager from './share_manager.js';
import * as aiModerator from './ai_moderator.js';
import path from 'path';
import fs from 'fs';
import config from '../config/config.js';
import { escapeHtml } from '../utils/utils.js';

// 用户会话管理
const userSessions = new Map();

// 定期清理过期会话（每小时执行一次）
setInterval(() => {
  const now = Date.now();
  let cleanedCount = 0;
  for (const [token, session] of userSessions.entries()) {
    if (now > session.expires) {
      userSessions.delete(token);
      cleanedCount++;
    }
  }
  if (cleanedCount > 0) {
    console.log(`清理了 ${cleanedCount} 个过期的用户会话`);
  }
}, 60 * 60 * 1000); // 每小时

function createUserSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  userSessions.set(token, {
    userId,
    created: Date.now(),
    expires: Date.now() + 24 * 60 * 60 * 1000 // 24小时
  });
  return token;
}

function validateUserSession(token) {
  const session = userSessions.get(token);
  if (!session) return null;
  if (Date.now() > session.expires) {
    userSessions.delete(token);
    return null;
  }
  return session.userId;
}

function destroyUserSession(token) {
  userSessions.delete(token);
}

// 用户认证中间件
function userAuth(req, res, next) {
  const token = req.headers['x-user-token'];
  const userId = validateUserSession(token);
  if (!userId) {
    return res.status(401).json({ error: '请先登录' });
  }
  req.userId = userId;
  next();
}

// 配置文件上传
const upload = multer({ dest: 'uploads/' });

const router = express.Router();

// 登录接口（不需要认证）
router.post('/login', async (req, res) => {
  try {
    const { password } = req.body;
    if (!password) {
      return res.status(400).json({ error: '请输入密码' });
    }

    if (verifyPassword(password)) {
      const token = createSession();
      await addLog('info', '管理员登录成功');
      res.json({ success: true, token });
    } else {
      await addLog('warn', '管理员登录失败：密码错误');
      res.status(401).json({ error: '密码错误' });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 登出接口
router.post('/logout', (req, res) => {
  const token = req.headers['x-admin-token'];
  if (token) {
    destroySession(token);
  }
  res.json({ success: true });
});

// 验证会话接口
router.get('/verify', (req, res) => {
  const token = req.headers['x-admin-token'];
  if (validateSession(token)) {
    res.json({ valid: true });
  } else {
    res.status(401).json({ valid: false });
  }
});

// Google OAuth 回调接口（不需要认证）
router.get('/oauth-callback', async (req, res) => {
  try {
    const { code, state } = req.query;

    if (!code) {
      await addLog('error', 'OAuth 回调失败：未收到授权码');
      return res.status(400).send('<h1>授权失败</h1><p>未收到授权码</p>');
    }

    // 解析 state 参数，判断是管理员还是用户
    let stateData = null;
    let isUserAuth = false;
    let userId = null;

    if (state) {
      try {
        const stateStr = Buffer.from(state, 'base64').toString('utf-8');
        stateData = JSON.parse(stateStr);
        if (stateData.type === 'user' && stateData.userId) {
          isUserAuth = true;
          userId = stateData.userId;
          await addLog('info', `用户 ${userId} 触发的 OAuth 回调`);
        }
      } catch (e) {
        // state 解析失败，按照管理员流程处理
        await addLog('warn', 'state 参数解析失败，按照管理员流程处理');
      }
    }

    // 记录回调信息
    await addLog('info', `收到 OAuth 回调，code: ${code.substring(0, 20)}...`);

    const clientId = stateData?.client_id || config.oauth.clientId;
    const clientSecret = stateData?.client_secret || config.oauth.clientSecret;
    const projectId = stateData?.project_id || null;
    if (!clientId || !clientSecret) {
      await addLog('error', 'OAuth 回调失败：缺少 clientId 或 clientSecret');
      return res.status(400).send('<h1>授权失败</h1><p>缺少 clientId 或 clientSecret</p>');
    }
    const redirectUri = `${req.protocol}://${req.get('host')}/admin/oauth-callback`;

    await addLog('info', `使用 redirect_uri: ${redirectUri}`);

    const tokenData = await new Promise((resolve, reject) => {
      const postData = new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code'
      }).toString();

      const options = {
        hostname: 'oauth2.googleapis.com',
        path: '/token',
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(postData)
        }
      };

      const request = https.request(options, (response) => {
        let body = '';
        response.on('data', chunk => body += chunk);
        response.on('end', () => {
          if (response.statusCode === 200) {
            resolve(JSON.parse(body));
          } else {
            reject(new Error(`Token 交换失败 (${response.statusCode}): ${body}`));
          }
        });
      });

      request.on('error', (err) => {
        reject(err);
      });
      request.write(postData);
      request.end();
    });

    await addLog('success', '成功交换 Google OAuth Token');

    // 获取用户邮箱信息
    let userEmail = null;
    try {
      const userInfo = await new Promise((resolve, reject) => {
        const options = {
          hostname: 'www.googleapis.com',
          path: '/oauth2/v2/userinfo',
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${tokenData.access_token}`
          }
        };

        const request = https.request(options, (response) => {
          let body = '';
          response.on('data', chunk => body += chunk);
          response.on('end', () => {
            if (response.statusCode === 200) {
              resolve(JSON.parse(body));
            } else {
              reject(new Error('获取用户信息失败'));
            }
          });
        });

        request.on('error', reject);
        request.end();
      });

      userEmail = userInfo.email;
    } catch (e) {
      // 忽略错误
    }

    // 根据 isUserAuth 决定保存位置
    if (isUserAuth && userId) {
      // 保存到用户个人的 Token 列表
      await addUserToken(userId, {
        access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token,
        expires_in: tokenData.expires_in,
        email: userEmail,
        client_id: clientId,
        client_secret: clientSecret
      });

      await addLog('success', `Token 已保存到用户 ${userId} 的账号列表`);
    } else {
      // 保存到管理员的 accounts.json（系统级共享池）
      const account = {
        access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token,
      expires_in: tokenData.expires_in,
      timestamp: Date.now(),
      client_id: clientId,
      client_secret: clientSecret,
      project_id: projectId
    };

      const accountsFile = './data/accounts.json';
      let accounts = [];
      try {
        const fsPromises = await import('fs/promises');
        const data = await fsPromises.readFile(accountsFile, 'utf-8');
        accounts = JSON.parse(data);
      } catch {
        // 文件不存在，使用空数组
      }
      accounts.push(account);
      const fsPromises = await import('fs/promises');
      await fsPromises.writeFile(accountsFile, JSON.stringify(accounts, null, 2));
      await addLog('success', 'Token 已保存到 accounts.json（系统共享池）');
    }

    // 返回成功页面，显示 Token 信息
    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <title>Token 添加成功</title>
        <style>
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            display: flex;
            justify-content: center;
            align-items: center;
            min-height: 100vh;
            margin: 0;
            padding: 20px;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          }
          .message-box {
            background: white;
            padding: 40px;
            border-radius: 16px;
            box-shadow: 0 10px 40px rgba(0,0,0,0.3);
            text-align: center;
            max-width: 600px;
            width: 100%;
          }
          h2 { color: #22c55e; margin-bottom: 10px; }
          p { color: #64748b; }
          .token-info {
            background: #f1f5f9;
            border-radius: 8px;
            padding: 15px;
            margin: 20px 0;
            text-align: left;
          }
          .token-field {
            margin: 10px 0;
          }
          .token-field label {
            display: block;
            font-size: 12px;
            color: #64748b;
            margin-bottom: 5px;
          }
          .token-field .value {
            background: white;
            border: 1px solid #e2e8f0;
            border-radius: 4px;
            padding: 8px;
            font-family: monospace;
            font-size: 12px;
            word-break: break-all;
            max-height: 80px;
            overflow-y: auto;
          }
          .copy-btn {
            margin-left: 10px;
            padding: 4px 8px;
            background: #6366f1;
            color: white;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-size: 12px;
          }
          .copy-btn:hover { background: #4f46e5; }
          .btn-group { display: flex; gap: 10px; justify-content: center; margin-top: 20px; }
          button.main-btn {
            padding: 12px 24px;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            border: none;
            border-radius: 8px;
            cursor: pointer;
          }
          button.secondary-btn {
            padding: 12px 24px;
            background: #6366f1;
            color: white;
            border: none;
            border-radius: 8px;
            cursor: pointer;
          }
          .note { font-size: 12px; color: #94a3b8; margin-top: 15px; }
        </style>
      </head>
      <body>
        <div class="message-box">
          <h2>✓ Token 添加成功！</h2>
          <p>Google Token 已成功添加到系统中</p>

          <div class="token-info">
            <div class="token-field">
              <label>Access Token <button class="copy-btn" onclick="copyToken('access')">复制</button></label>
              <div class="value" id="access-token">${tokenData.access_token}</div>
            </div>
            <div class="token-field">
              <label>Refresh Token <button class="copy-btn" onclick="copyToken('refresh')">复制</button></label>
              <div class="value" id="refresh-token">${tokenData.refresh_token || '无'}</div>
            </div>
            <div class="token-field">
              <label>过期时间</label>
              <div class="value">${tokenData.expires_in} 秒</div>
            </div>
          </div>

          <p class="note">Token 已自动保存到系统，你也可以手动复制备用</p>
          <div class="btn-group">
            <button class="main-btn" onclick="goBack()">返回</button>
          </div>
        </div>
        <script>
          function copyToken(type) {
            const el = document.getElementById(type + '-token');
            navigator.clipboard.writeText(el.textContent).then(() => {
              alert('已复制到剪贴板');
            });
          }

          // 智能返回：检测来源并返回到正确的页面
          function goBack() {
            // 根据是否为用户认证决定返回页面
            const isUser = ${isUserAuth ? 'true' : 'false'};
            if (isUser) {
              window.location.href = window.location.origin + '/user.html';
            } else {
              window.location.href = window.location.origin + '/';
            }
          }

          // 3秒后自动返回
          setTimeout(function() {
            goBack();
          }, 3000);
        </script>
      </body>
      </html>
    `);
  } catch (error) {
    await addLog('error', `Google OAuth 登录失败: ${error.message}`);

    // 提供详细的错误信息
    const errorDetails = {
      message: error.message,
      stack: error.stack,
      timestamp: new Date().toISOString()
    };

    console.error('OAuth 回调错误详情:', errorDetails);

    res.status(500).send(`
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <title>登录失败</title>
        <style>
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            display: flex;
            justify-content: center;
            align-items: center;
            min-height: 100vh;
            margin: 0;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            padding: 20px;
          }
          .error-box {
            background: white;
            padding: 40px;
            border-radius: 16px;
            box-shadow: 0 10px 40px rgba(0,0,0,0.3);
            text-align: center;
            max-width: 600px;
            width: 100%;
          }
          h2 { color: #ef4444; margin-bottom: 10px; }
          p { color: #64748b; margin: 10px 0; }
          .error-details {
            background: #fef2f2;
            padding: 15px;
            border-radius: 8px;
            margin: 20px 0;
            text-align: left;
            border-left: 4px solid #ef4444;
          }
          .error-details pre {
            margin: 5px 0;
            font-size: 0.85em;
            color: #991b1b;
            overflow-x: auto;
          }
          button {
            margin-top: 20px;
            padding: 12px 24px;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            border: none;
            border-radius: 8px;
            font-size: 1em;
            cursor: pointer;
          }
          button:hover {
            opacity: 0.9;
          }
          .tips {
            background: #eff6ff;
            padding: 15px;
            border-radius: 8px;
            margin-top: 20px;
            border-left: 4px solid #3b82f6;
            text-align: left;
          }
          .tips h3 {
            color: #1e40af;
            font-size: 1em;
            margin: 0 0 10px 0;
          }
          .tips ul {
            margin: 0;
            padding-left: 20px;
            color: #1e40af;
            font-size: 0.9em;
          }
          .tips li {
            margin: 5px 0;
          }
        </style>
      </head>
      <body>
        <div class="error-box">
          <h2>🔒 OAuth 登录失败</h2>
          <p>在处理 Google 授权时遇到了问题</p>

          <div class="error-details">
            <strong>错误信息：</strong>
            <pre>${error.message}</pre>
          </div>

          <div class="tips">
            <h3>💡 可能的解决方案：</h3>
            <ul>
              <li><strong>授权码已过期：</strong>OAuth 授权码只能使用一次，请重新点击"使用 Google 账号登录"</li>
              <li><strong>redirect_uri 不匹配：</strong>确保在 Google Cloud Console 中配置了正确的回调地址</li>
              <li><strong>网络问题：</strong>检查服务器是否能访问 Google API</li>
              <li><strong>查看日志：</strong>在"日志查看"页面可以看到详细的错误信息</li>
            </ul>
          </div>

          <button onclick="window.location.href='/'">返回登录页重试</button>
        </div>
      </body>
      </html>
    `);
  }
});

// ========== 共享 Token 公开 API ==========

// 获取共享 Token 统计信息（公开）
router.get('/shared/stats', async (req, res) => {
  try {
    const stats = await getSharedTokenStats();
    res.json(stats);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 获取所有共享 Token 列表（公开）
router.get('/shared/tokens', async (req, res) => {
  try {
    const tokens = await getAllSharedTokens();
    res.json(tokens);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 获取用户使用统计（公开）
router.get('/shared/user-usage', async (req, res) => {
  try {
    const shareData = await shareManager.loadShareData();
    const users = await getAllUsers();

    const userUsageStats = [];

    for (const user of users) {
      const userId = user.id;
      const history = shareData.usageHistory[userId];

      if (!history || !history.dailyUsage) continue;

      const dailyUsages = Object.values(history.dailyUsage);
      const dates = Object.keys(history.dailyUsage);

      if (dailyUsages.length === 0) continue;

      const totalUsage = dailyUsages.reduce((sum, v) => sum + v, 0);
      const avgUsage = Math.round(totalUsage / dailyUsages.length);
      const maxUsage = Math.max(...dailyUsages);
      const today = new Date().toDateString();
      const todayUsage = history.dailyUsage[today] || 0;

      // 检查封禁状态
      const banStatus = await shareManager.isUserBanned(userId);

      userUsageStats.push({
        userId,
        username: user.username,
        email: user.email || '',
        avgUsage,
        todayUsage,
        maxUsage,
        totalDays: dates.length,
        totalUsage,
        banned: banStatus.banned,
        banReason: banStatus.reason || '',
        banUntil: banStatus.banUntil || null
      });
    }

    res.json(userUsageStats);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 获取随机共享 Token（公开，供 API 调用使用）
router.get('/shared/token', async (req, res) => {
  try {
    const token = await getRandomSharedToken();
    if (!token) {
      return res.status(404).json({ error: '暂无可用的共享 Token' });
    }
    // 如果返回的是封禁信息
    if (token.error === 'banned') {
      return res.status(403).json({
        error: '您已被禁止使用共享资源',
        banned: true,
        banUntil: token.banUntil,
        remainingTime: token.remainingTime,
        reason: token.reason
      });
    }
    res.json(token);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ========== 共享管理 API（需要用户登录）==========

// 获取用户共享状态
router.get('/shared/status', userAuth, async (req, res) => {
  try {
    const status = await shareManager.getUserShareStatus(req.userId);
    res.json(status);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 获取所有活跃投票
router.get('/shared/votes', async (req, res) => {
  try {
    const votes = await shareManager.getActiveVotes();
    res.json(votes);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 获取所有投票（包括历史）
router.get('/shared/votes/all', async (req, res) => {
  try {
    const votes = await shareManager.getAllVotes();
    res.json(votes);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 获取投票详情
router.get('/shared/votes/:voteId', async (req, res) => {
  try {
    const vote = await shareManager.getVoteById(req.params.voteId);
    if (!vote) {
      return res.status(404).json({ error: '投票不存在' });
    }
    res.json(vote);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 发起投票（需要登录）
router.post('/shared/votes', userAuth, async (req, res) => {
  try {
    const { targetUserId, reason } = req.body;
    if (!targetUserId || !reason) {
      return res.status(400).json({ error: '缺少必要参数' });
    }
    const result = await shareManager.createVote(targetUserId, reason, req.userId);
    if (result.error) {
      return res.status(400).json(result);
    }
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 投票（需要登录）
router.post('/shared/votes/:voteId/cast', userAuth, async (req, res) => {
  try {
    const { decision } = req.body; // 'ban' 或 'unban'
    if (!['ban', 'unban'].includes(decision)) {
      return res.status(400).json({ error: '无效的投票选项' });
    }
    const result = await shareManager.castVote(req.params.voteId, req.userId, decision);
    if (result.error) {
      return res.status(400).json(result);
    }
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 添加评论（需要登录）
router.post('/shared/votes/:voteId/comment', userAuth, async (req, res) => {
  try {
    const { content } = req.body;
    if (!content || content.trim().length === 0) {
      return res.status(400).json({ error: '评论内容不能为空' });
    }
    const result = await shareManager.addVoteComment(req.params.voteId, req.userId, content.trim());
    if (result.error) {
      return res.status(400).json(result);
    }
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ========== Token 黑名单管理（需要用户登录）==========

// 获取自己Token的黑名单
router.get('/shared/blacklist/:tokenIndex', userAuth, async (req, res) => {
  try {
    const blacklist = await shareManager.getTokenBlacklist(req.userId, parseInt(req.params.tokenIndex));
    res.json({ blacklist });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 添加用户到黑名单
router.post('/shared/blacklist/:tokenIndex', userAuth, async (req, res) => {
  try {
    const { targetUserId } = req.body;
    if (!targetUserId) {
      return res.status(400).json({ error: '缺少目标用户ID' });
    }
    const blacklist = await shareManager.addToTokenBlacklist(req.userId, parseInt(req.params.tokenIndex), targetUserId);
    res.json({ success: true, blacklist });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 从黑名单移除用户
router.delete('/shared/blacklist/:tokenIndex/:targetUserId', userAuth, async (req, res) => {
  try {
    const blacklist = await shareManager.removeFromTokenBlacklist(
      req.userId,
      parseInt(req.params.tokenIndex),
      req.params.targetUserId
    );
    res.json({ success: true, blacklist });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ========== 管理员共享管理 ==========

// 手动封禁用户使用共享（管理员）
router.post('/shared/ban/:userId', adminAuth, async (req, res) => {
  try {
    const { reason } = req.body;
    const result = await shareManager.banUserFromSharing(req.params.userId, reason || '管理员手动封禁');
    res.json({ success: true, ...result });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 解除封禁（管理员）
router.delete('/shared/ban/:userId', adminAuth, async (req, res) => {
  try {
    await shareManager.unbanUser(req.params.userId);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ========== 用户 API 路由（公开部分）==========

// 用户注册（公开）
router.post('/user/register', async (req, res) => {
  try {
    const { username, password, email, deviceInfo } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: '用户名和密码是必填项' });
    }

    // 获取客户端IP
    const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() ||
                req.headers['x-real-ip'] ||
                req.socket.remoteAddress ||
                req.connection.remoteAddress;

    // 生成设备指纹
    let deviceId = null;
    if (deviceInfo) {
      deviceId = generateDeviceFingerprint(
        deviceInfo.userAgent || req.headers['user-agent'] || '',
        deviceInfo.language || req.headers['accept-language'] || '',
        deviceInfo.screen || '',
        deviceInfo.timezone || '',
        deviceInfo.platform || ''
      );
    }

    // 安全检查
    try {
      // 检查IP是否被封禁
      const ipBanned = await isIPBanned(ip);
      if (ipBanned) {
        await addLog('warn', `被封禁IP尝试注册: ${ip}`);
        return res.status(403).json({ error: '该 IP 已被封禁，无法注册' });
      }

      // 检查设备是否被封禁
      if (deviceId) {
        const deviceBanned = await isDeviceBanned(deviceId);
        if (deviceBanned) {
          await addLog('warn', `被封禁设备尝试注册: ${deviceId.substring(0, 16)}...`);
          return res.status(403).json({ error: '该设备已被封禁，无法注册' });
        }
      }

      // 检查IP注册限制
      await checkIPRegistrationLimit(ip);

      // 检查设备注册限制
      if (deviceId) {
        await checkDeviceRegistrationLimit(deviceId);
      }
    } catch (securityError) {
      await addLog('warn', `注册安全检查失败 (IP: ${ip}): ${securityError.message}`);
      return res.status(403).json({ error: securityError.message });
    }

    // 注册用户
    const user = await registerUser(username, password, email);

    // 记录注册
    await recordRegistration(ip, deviceId, user.id);
    await addLog('info', `新用户注册: ${username} (IP: ${ip})`);

    res.json({
      success: true,
      user: {
        id: user.id,
        username: user.username,
        email: user.email
      }
    });
  } catch (error) {
    await addLog('warn', `用户注册失败: ${error.message}`);
    res.status(400).json({ error: error.message });
  }
});

// 用户登录（公开）
router.post('/user/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: '请输入用户名和密码' });
    }

    const user = await loginUser(username, password);
    const token = createUserSession(user.id);
    await addLog('info', `用户登录: ${username}`);

    res.json({
      success: true,
      token,
      user: {
        id: user.id,
        username: user.username,
        email: user.email
      }
    });
  } catch (error) {
    await addLog('warn', `用户登录失败: ${error.message}`);
    res.status(401).json({ error: error.message });
  }
});

// 用户登出
router.post('/user/logout', (req, res) => {
  const token = req.headers['x-user-token'];
  if (token) {
    destroyUserSession(token);
  }
  res.json({ success: true });
});

// 验证用户会话
router.get('/user/verify', (req, res) => {
  const token = req.headers['x-user-token'];
  const userId = validateUserSession(token);
  if (userId) {
    res.json({ valid: true, userId });
  } else {
    res.status(401).json({ valid: false });
  }
});

// ========== 用户 API 路由（受保护部分）==========
// 以下用户路由需要用户认证（必须在 adminAuth 之前）

// 获取用户信息
router.get('/user/profile', userAuth, async (req, res) => {
  try {
    const user = await getUserById(req.userId);
    if (!user) {
      return res.status(404).json({ error: '用户不存在' });
    }
    res.json(user);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 更新用户信息
router.patch('/user/profile', userAuth, async (req, res) => {
  try {
    const { email, password, systemPrompt } = req.body;
    const user = await updateUser(req.userId, { email, password, systemPrompt });
    await addLog('info', `用户 ${user.username} 更新了个人信息`);
    res.json({ success: true, user });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// 获取用户的 API 密钥
router.get('/user/keys', userAuth, async (req, res) => {
  try {
    const keys = await getUserApiKeys(req.userId);
    res.json(keys);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 生成用户 API 密钥
router.post('/user/keys/generate', userAuth, async (req, res) => {
  try {
    const { name } = req.body;
    const key = await generateUserApiKey(req.userId, name);
    await addLog('info', `用户生成了新密钥: ${name || '未命名'}`);
    res.json({
      success: true,
      key: {
        id: key.id,
        key: key.key,
        name: key.name,
        created: key.created
      }
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// 删除用户 API 密钥
router.delete('/user/keys/:keyId', userAuth, async (req, res) => {
  try {
    const { keyId } = req.params;
    await deleteUserApiKey(req.userId, keyId);
    await addLog('info', `用户删除了密钥: ${keyId}`);
    res.json({ success: true });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// 获取用户的 Google Tokens
router.get('/user/tokens', userAuth, async (req, res) => {
  try {
    const tokens = await getUserTokens(req.userId);
    res.json(tokens);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 用户触发 Google OAuth 登录流程（需要认证，使用加密 state 参数标识用户）
router.post('/user/tokens/login', userAuth, async (req, res) => {
  try {
    // 使用当前请求的域名生成动态 redirect_uri
    const protocol = req.protocol;
    const host = req.get('host');
    const redirectUri = `${protocol}://${host}/admin/oauth-callback`;

    // 生成加密的 state，包含用户 ID
    const stateData = {
      userId: req.userId,
      timestamp: Date.now(),
      type: 'user',
      client_id: config.oauth.clientId,
      client_secret: config.oauth.clientSecret,
      project_id: config.api?.projectId || null
    };
    const stateStr = Buffer.from(JSON.stringify(stateData)).toString('base64');

    const result = await triggerLogin(redirectUri, stateStr);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 用户通过回调链接添加 Token
router.post('/user/tokens/callback', userAuth, async (req, res) => {
  try {
    const { callback_url, client_id, client_secret, project_id } = req.body;

    if (!callback_url) {
      return res.status(400).json({ error: '请提供回调链接' });
    }

    // 从回调链接中提取 code
    const url = new URL(callback_url);
    const code = url.searchParams.get('code');

    if (!code) {
      return res.status(400).json({ error: '无效的回调链接，未找到授权码' });
    }

    // 交换 code 获取 token，优先使用前端传入
    const clientId = client_id || config.oauth.clientId;
    const clientSecret = client_secret || config.oauth.clientSecret;
    if (!clientId || !clientSecret) {
      return res.status(400).json({ error: '缺少 OAuth Client ID 或 Client Secret' });
    }
    const redirectUri = `${req.protocol}://${req.get('host')}/admin/user/token-callback`;

    const tokenData = await new Promise((resolve, reject) => {
      const postData = new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code'
      }).toString();

      const options = {
        hostname: 'oauth2.googleapis.com',
        path: '/token',
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(postData)
        }
      };

      const request = https.request(options, (response) => {
        let body = '';
        response.on('data', chunk => body += chunk);
        response.on('end', () => {
          if (response.statusCode === 200) {
            resolve(JSON.parse(body));
          } else {
            reject(new Error(`Token 交换失败: ${body}`));
          }
        });
      });

      request.on('error', reject);
      request.write(postData);
      request.end();
    });

    // 获取用户信息（邮箱）
    let userEmail = null;
    try {
      const userInfo = await new Promise((resolve, reject) => {
        const options = {
          hostname: 'www.googleapis.com',
          path: '/oauth2/v2/userinfo',
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${tokenData.access_token}`
          }
        };

        const request = https.request(options, (response) => {
          let body = '';
          response.on('data', chunk => body += chunk);
          response.on('end', () => {
            if (response.statusCode === 200) {
              resolve(JSON.parse(body));
            } else {
              reject(new Error('获取用户信息失败'));
            }
          });
        });

        request.on('error', reject);
        request.end();
      });

      userEmail = userInfo.email;
    } catch (e) {
      // 忽略错误，继续添加 Token
    }

    // 添加 Token 到用户账号
    const result = await addUserToken(req.userId, {
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token,
      expires_in: tokenData.expires_in,
      email: userEmail,
      client_id: clientId,
      client_secret: clientSecret
    });

    await addLog('info', `用户通过回调链接添加了 Token`);
    res.json(result);
  } catch (error) {
    await addLog('error', `用户添加 Token 失败: ${error.message}`);
    res.status(400).json({ error: error.message });
  }
});

// 用户直接添加 Token
router.post('/user/tokens/direct', userAuth, async (req, res) => {
  try {
    const { access_token, refresh_token, expires_in, client_id, client_secret } = req.body;

    if (!access_token) {
      return res.status(400).json({ error: '请提供 Access Token' });
    }

    const result = await addUserToken(req.userId, {
      access_token,
      refresh_token: refresh_token || null,
      expires_in: expires_in || 3600,
      email: null,
      client_id: client_id || config.oauth.clientId,
      client_secret: client_secret || config.oauth.clientSecret,
      project_id: project_id || null
    });

    await addLog('info', `用户直接添加了 Token`);
    res.json(result);
  } catch (error) {
    await addLog('error', `用户添加 Token 失败: ${error.message}`);
    res.status(400).json({ error: error.message });
  }
});

// 删除用户 Token
router.delete('/user/tokens/:index', userAuth, async (req, res) => {
  try {
    const { index } = req.params;
    const tokenIndex = parseInt(index);

    if (isNaN(tokenIndex)) {
      return res.status(400).json({ error: '无效的索引' });
    }

    const result = await deleteUserGoogleToken(req.userId, tokenIndex);
    await addLog('info', `用户删除了 Token #${tokenIndex}`);
    res.json(result);
  } catch (error) {
    await addLog('error', `用户删除 Token 失败: ${error.message}`);
    res.status(400).json({ error: error.message });
  }
});

// 更新用户 Token 共享设置
router.patch('/user/tokens/:index/sharing', userAuth, async (req, res) => {
  try {
    const { index } = req.params;
    const tokenIndex = parseInt(index);
    const { isShared, dailyLimit } = req.body;

    if (isNaN(tokenIndex)) {
      return res.status(400).json({ error: '无效的索引' });
    }

    const result = await updateTokenSharing(req.userId, tokenIndex, { isShared, dailyLimit });
    await addLog('info', `用户更新了 Token #${tokenIndex} 的共享设置`);
    res.json(result);
  } catch (error) {
    await addLog('error', `更新 Token 共享设置失败: ${error.message}`);
    res.status(400).json({ error: error.message });
  }
});

// 用户批量导出 Token
router.post('/user/tokens/export', userAuth, async (req, res) => {
  try {
    const { indices } = req.body;
    const tokens = await getUserTokens(req.userId);
    const exportData = [];

    for (const index of indices) {
      if (index >= 0 && index < tokens.length) {
        const token = tokens[index];
        exportData.push({
          email: token.email || 'Unknown',
          access_token: token.access_token,
          refresh_token: token.refresh_token,
          expires_in: token.expires_in,
          timestamp: token.timestamp,
          enable: token.enable !== false,
          isShared: token.isShared || false,
          dailyLimit: token.dailyLimit || 100
        });
      }
    }

    await addLog('info', `用户导出了 ${exportData.length} 个 Token`);

    const archiver = (await import('archiver')).default;
    const archive = archiver('zip', { zlib: { level: 9 } });
    const timestamp = new Date().toISOString().split('T')[0];

    res.attachment(`user_tokens_export_${timestamp}.zip`);
    res.setHeader('Content-Type', 'application/zip');

    archive.pipe(res);
    archive.append(JSON.stringify(exportData, null, 2), { name: 'tokens.json' });
    await archive.finalize();
  } catch (error) {
    await addLog('error', `用户导出 Token 失败: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// 用户批量导入 Token
router.post('/user/tokens/import', userAuth, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: '请上传文件' });
    }

    await addLog('info', '用户正在导入 Token...');

    const AdmZip = (await import('adm-zip')).default;
    const zip = new AdmZip(req.file.path);
    const zipEntries = zip.getEntries();

    const tokensEntry = zipEntries.find(entry => entry.entryName === 'tokens.json');
    if (!tokensEntry) {
      throw new Error('ZIP 文件中没有找到 tokens.json');
    }

    const tokensContent = tokensEntry.getData().toString('utf8');
    const importedTokens = JSON.parse(tokensContent);

    if (!Array.isArray(importedTokens)) {
      throw new Error('tokens.json 格式错误：应该是一个数组');
    }

    const currentTokens = await getUserTokens(req.userId);
    let addedCount = 0;

    for (const token of importedTokens) {
      const exists = currentTokens.some(t => t.access_token === token.access_token);
      if (!exists) {
        await addUserToken(req.userId, {
          access_token: token.access_token,
          refresh_token: token.refresh_token,
          expires_in: token.expires_in,
          email: token.email
        });

        if (token.isShared) {
          const tokens = await getUserTokens(req.userId);
          const newIndex = tokens.length - 1;
          await updateTokenSharing(req.userId, newIndex, {
            isShared: token.isShared,
            dailyLimit: token.dailyLimit || 100
          });
        }

        addedCount++;
      }
    }

    // 清理上传的文件
    try {
      const fsPromises = await import('fs/promises');
      await fsPromises.unlink(req.file.path);
    } catch (e) {
      console.error('清理上传文件失败:', e);
    }

    await addLog('success', `用户成功导入 ${addedCount} 个 Token`);
    res.json({
      success: true,
      count: addedCount,
      total: importedTokens.length,
      skipped: importedTokens.length - addedCount,
      message: `成功导入 ${addedCount} 个 Token${importedTokens.length - addedCount > 0 ? `，跳过 ${importedTokens.length - addedCount} 个重复账号` : ''}`
    });
  } catch (error) {
    await addLog('error', `用户导入 Token 失败: ${error.message}`);
    // 清理上传的文件
    try {
      const fsPromises = await import('fs/promises');
      await fsPromises.unlink(req.file.path);
    } catch (e) {}
    res.status(500).json({ error: error.message });
  }
});

// 用户切换 Token 启用/禁用
router.patch('/user/tokens/:index/toggle', userAuth, async (req, res) => {
  try {
    const { index } = req.params;
    const tokenIndex = parseInt(index);
    const { enable } = req.body;

    if (isNaN(tokenIndex)) {
      return res.status(400).json({ error: '无效的索引' });
    }

    const tokens = await getUserTokens(req.userId);
    if (tokenIndex < 0 || tokenIndex >= tokens.length) {
      return res.status(400).json({ error: '无效的索引' });
    }

    tokens[tokenIndex].enable = enable;

    // 保存用户数据
    const user = await getUserById(req.userId);
    user.googleTokens = tokens;
    const { updateUser: saveUser } = await import('./user_manager.js');
    await saveUser(req.userId, { googleTokens: tokens });

    await addLog('info', `用户${enable ? '启用' : '禁用'}了 Token #${tokenIndex}`);
    res.json({ success: true });
  } catch (error) {
    await addLog('error', `用户切换 Token 状态失败: ${error.message}`);
    res.status(400).json({ error: error.message });
  }
});

// ========== 公告公开 API ==========

// 获取活跃公告（公开，用户端）
router.get('/announcements/active', async (req, res) => {
  try {
    const announcements = await getActiveAnnouncements();
    res.json(announcements);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 获取 OAuth 配置（公开接口，仅返回 clientId）
router.get('/oauth-config', async (req, res) => {
  try {
    const settings = await loadSettings();
    res.json({
      clientId: settings.oauth?.clientId || '',
      projectId: settings.api?.projectId || ''
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 以下所有路由需要管理员认证
router.use(adminAuth);

// 生成新密钥
router.post('/keys/generate', async (req, res) => {
  try {
    const { name, rateLimit } = req.body;
    const newKey = await createKey(name, rateLimit);
    await addLog('success', `密钥已生成: ${name || '未命名'}`);
    res.json({ success: true, key: newKey.key, name: newKey.name, rateLimit: newKey.rateLimit });
  } catch (error) {
    await addLog('error', `生成密钥失败: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// 获取所有密钥
router.get('/keys', async (req, res) => {
  try {
    const keys = await loadKeys();
    // 返回密钥列表（隐藏部分字符）
    const safeKeys = keys.map(k => ({
      ...k,
      key: k.key.substring(0, 10) + '...' + k.key.substring(k.key.length - 4)
    }));
    res.json(keys); // 在管理界面显示完整密钥
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 删除密钥
router.delete('/keys/:key', async (req, res) => {
  try {
    const { key } = req.params;
    await deleteKey(key);
    await addLog('warn', `密钥已删除: ${key.substring(0, 10)}...`);
    res.json({ success: true });
  } catch (error) {
    await addLog('error', `删除密钥失败: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// 更新密钥频率限制
router.patch('/keys/:key/ratelimit', async (req, res) => {
  try {
    const { key } = req.params;
    const { rateLimit } = req.body;
    await updateKeyRateLimit(key, rateLimit);
    await addLog('info', `密钥频率限制已更新: ${key.substring(0, 10)}...`);
    res.json({ success: true });
  } catch (error) {
    await addLog('error', `更新频率限制失败: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// 获取密钥统计
router.get('/keys/stats', async (req, res) => {
  try {
    const stats = await getKeyStats();
    res.json(stats);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 获取日志
router.get('/logs', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 100;
    const logs = await getRecentLogs(limit);
    res.json(logs);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 清空日志
router.delete('/logs', async (req, res) => {
  try {
    await clearLogs();
    await addLog('info', '日志已清空');
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 获取系统状态
router.get('/status', async (req, res) => {
  try {
    const status = getSystemStatus();
    res.json(status);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Token 管理路由

// 获取所有账号
router.get('/tokens', async (req, res) => {
  try {
    const accounts = await loadAccounts();
    // 隐藏敏感信息，只返回必要字段
    const safeAccounts = accounts.map((acc, index) => ({
      index,
      access_token: acc.access_token?.substring(0, 20) + '...',
      refresh_token: acc.refresh_token ? 'exists' : 'none',
      expires_in: acc.expires_in,
      timestamp: acc.timestamp,
      enable: acc.enable !== false,
      created: new Date(acc.timestamp).toLocaleString()
    }));
    res.json(safeAccounts);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 删除账号
router.delete('/tokens/:index', async (req, res) => {
  try {
    const index = parseInt(req.params.index);
    await deleteAccount(index);
    await addLog('warn', `Token 账号 ${index} 已删除`);
    res.json({ success: true });
  } catch (error) {
    await addLog('error', `删除 Token 失败: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// 启用/禁用账号
router.patch('/tokens/:index', async (req, res) => {
  try {
    const index = parseInt(req.params.index);
    const { enable } = req.body;
    await toggleAccount(index, enable);
    await addLog('info', `Token 账号 ${index} 已${enable ? '启用' : '禁用'}`);
    res.json({ success: true });
  } catch (error) {
    await addLog('error', `切换 Token 状态失败: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// 触发登录流程
router.post('/tokens/login', async (req, res) => {
  try {
    await addLog('info', '开始 Google OAuth 登录流程');
    const { client_id, client_secret, project_id } = req.body || {};
    const result = await triggerLogin(null, null, { client_id, client_secret, project_id });
    res.json(result);
  } catch (error) {
    await addLog('error', `登录失败: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// 获取 Token 统计
router.get('/tokens/stats', async (req, res) => {
  try {
    const stats = await getAccountStats();
    res.json(stats);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 获取 Token 使用统计（轮询信息）
router.get('/tokens/usage', async (req, res) => {
  try {
    const usageStats = tokenManager.getUsageStats();
    res.json(usageStats);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 手动添加 Token（通过回调链接）
router.post('/tokens/callback', async (req, res) => {
  try {
    const { callbackUrl } = req.body;
    if (!callbackUrl) {
      return res.status(400).json({ error: '请提供回调链接' });
    }
    await addLog('info', '正在通过回调链接添加 Token...');
    const result = await addTokenFromCallback(callbackUrl);
    await addLog('success', 'Token 已通过回调链接成功添加');
    res.json(result);
  } catch (error) {
    await addLog('error', `添加 Token 失败: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// 手动添加 Token（直接输入）
router.post('/tokens/direct', async (req, res) => {
  try {
    const { access_token, refresh_token, expires_in } = req.body;

    if (!access_token) {
      return res.status(400).json({ error: 'access_token 是必填项' });
    }

    await addLog('info', '正在添加直接输入的 Token...');
    const result = await addDirectToken({
      access_token,
      refresh_token,
      expires_in
    });

    if (result.success) {
      await addLog('success', `Token 添加成功，索引: ${result.index}`);
    } else {
      await addLog('warn', `Token 添加失败: ${result.error}`);
    }

    res.json(result);
  } catch (error) {
    await addLog('error', `添加 Token 失败: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// 获取账号详细信息（包括名称）
router.post('/tokens/details', async (req, res) => {
  try {
    const { indices } = req.body;
    const accounts = await loadAccounts();
    const details = [];

    for (const index of indices) {
      if (index >= 0 && index < accounts.length) {
        const account = accounts[index];
        const accountInfo = await getAccountName(account.access_token);
        details.push({
          index,
          email: accountInfo.email,
          name: accountInfo.name,
          access_token: account.access_token,
          refresh_token: account.refresh_token,
          expires_in: account.expires_in,
          timestamp: account.timestamp,
          enable: account.enable !== false
        });
      }
    }

    res.json(details);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 批量导出 Token (ZIP格式)
router.post('/tokens/export', async (req, res) => {
  try {
    const { indices } = req.body;
    const accounts = await loadAccounts();
    const exportData = [];

    for (const index of indices) {
      if (index >= 0 && index < accounts.length) {
        const account = accounts[index];
        const accountInfo = await getAccountName(account.access_token);
        exportData.push({
          email: accountInfo.email,
          name: accountInfo.name,
          access_token: account.access_token,
          refresh_token: account.refresh_token,
          expires_in: account.expires_in,
          timestamp: account.timestamp,
          created: new Date(account.timestamp).toLocaleString(),
          enable: account.enable !== false
        });
      }
    }

    await addLog('info', `批量导出了 ${exportData.length} 个 Token 账号`);

    // 创建 ZIP 文件
    const archive = archiver('zip', { zlib: { level: 9 } });
    const timestamp = new Date().toISOString().split('T')[0];

    res.attachment(`tokens_export_${timestamp}.zip`);
    res.setHeader('Content-Type', 'application/zip');

    archive.pipe(res);

    // 添加 tokens.json 文件到 ZIP
    archive.append(JSON.stringify(exportData, null, 2), { name: 'tokens.json' });

    await archive.finalize();
  } catch (error) {
    await addLog('error', `批量导出失败: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// 批量导入 Token (ZIP格式)
router.post('/tokens/import', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: '请上传文件' });
    }

    await addLog('info', '正在导入 Token 账号...');
    const result = await importTokens(req.file.path);
    await addLog('success', `成功导入 ${result.count} 个 Token 账号`);
    res.json(result);
  } catch (error) {
    await addLog('error', `导入失败: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// 获取系统设置
router.get('/settings', async (req, res) => {
  try {
    const settings = await loadSettings();
    res.json(settings);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 保存系统设置
router.post('/settings', async (req, res) => {
  try {
    const result = await saveSettings(req.body);
    await addLog('success', '系统设置已更新');
    res.json(result);
  } catch (error) {
    await addLog('error', `保存设置失败: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// ========== 管理员用户管理路由 ==========

// 获取所有用户（管理员）
router.get('/users', async (req, res) => {
  try {
    const users = await getAllUsers();
    res.json(users);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 获取用户统计（管理员）
router.get('/users/stats', async (req, res) => {
  try {
    const stats = await getUserStats();
    res.json(stats);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 启用/禁用用户（管理员）
router.patch('/users/:userId/status', async (req, res) => {
  try {
    const { userId } = req.params;
    const { enabled } = req.body;
    await toggleUserStatus(userId, enabled);
    await addLog('info', `管理员${enabled ? '启用' : '禁用'}了用户: ${userId}`);
    res.json({ success: true });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// 删除用户（管理员）
router.delete('/users/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    await deleteUser(userId);
    await addLog('warn', `管理员删除了用户: ${userId}`);
    res.json({ success: true });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// ========== 公告管理路由（管理员）==========

// 配置公告图片上传
const announcementStorage = multer.diskStorage({
  destination: async (_req, _file, cb) => {
    const uploadDir = path.join(process.cwd(), 'uploads', 'announcements');
    await fs.promises.mkdir(uploadDir, { recursive: true });
    cb(null, uploadDir);
  },
  filename: (_req, file, cb) => {
    const uniqueName = `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${path.extname(file.originalname)}`;
    cb(null, uniqueName);
  }
});

const announcementUpload = multer({
  storage: announcementStorage,
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB
  },
  fileFilter: (_req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|gif|webp|bmp|svg|ico/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);

    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb(new Error('只支持图片文件 (jpeg, jpg, png, gif, webp, bmp, svg, ico)'));
    }
  }
});

// 上传公告图片（管理员）
router.post('/announcements/upload', announcementUpload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: '请选择图片文件' });
    }

    const imageUrl = `/uploads/announcements/${req.file.filename}`;
    await addLog('info', `上传公告图片: ${req.file.filename}`);

    res.json({
      success: true,
      url: imageUrl,
      filename: req.file.filename
    });
  } catch (error) {
    await addLog('error', `上传公告图片失败: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// 获取所有公告（管理员）
router.get('/announcements', async (req, res) => {
  try {
    const announcements = await loadAnnouncements();
    res.json(announcements);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 创建公告（管理员）
router.post('/announcements', async (req, res) => {
  try {
    const { title, content, type, images, pinned } = req.body;

    if (!title || !content) {
      return res.status(400).json({ error: '标题和内容是必填项' });
    }

    const announcement = await createAnnouncement({
      title,
      content,
      type,
      images,
      pinned
    });

    await addLog('success', `创建公告: ${title}`);
    res.json({ success: true, announcement });
  } catch (error) {
    await addLog('error', `创建公告失败: ${error.message}`);
    res.status(400).json({ error: error.message });
  }
});

// 更新公告（管理员）
router.patch('/announcements/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { title, content, type, images, pinned, enabled } = req.body;

    const announcement = await updateAnnouncement(id, {
      title,
      content,
      type,
      images,
      pinned,
      enabled
    });

    await addLog('info', `更新公告: ${announcement.title}`);
    res.json({ success: true, announcement });
  } catch (error) {
    await addLog('error', `更新公告失败: ${error.message}`);
    res.status(400).json({ error: error.message });
  }
});

// 删除公告（管理员）
router.delete('/announcements/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await deleteAnnouncement(id);
    await addLog('warn', `删除公告: ${id}`);
    res.json({ success: true });
  } catch (error) {
    await addLog('error', `删除公告失败: ${error.message}`);
    res.status(400).json({ error: error.message });
  }
});

// ========== 模型管理路由（管理员）==========

// 自动获取并保存模型（管理员）
router.post('/models/fetch', async (req, res) => {
  try {
    const models = await fetchAndSaveModels();
    await addLog('success', `成功获取并保存了 ${models.length} 个模型`);
    res.json({ success: true, models, count: models.length });
  } catch (error) {
    await addLog('error', `获取模型失败: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// 获取所有模型（管理员）
router.get('/models', async (req, res) => {
  try {
    const models = await loadModels();
    res.json(models);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 更新模型配额（管理员）
router.patch('/models/:modelId/quota', async (req, res) => {
  try {
    const { modelId } = req.params;
    const { quota } = req.body;

    if (!quota || quota < 0) {
      return res.status(400).json({ error: '配额必须是正数' });
    }

    const model = await updateModelQuota(modelId, quota);
    await addLog('info', `更新模型 ${modelId} 配额为 ${quota}`);
    res.json({ success: true, model });
  } catch (error) {
    await addLog('error', `更新模型配额失败: ${error.message}`);
    res.status(400).json({ error: error.message });
  }
});

// 启用/禁用模型（管理员）
router.patch('/models/:modelId/toggle', async (req, res) => {
  try {
    const { modelId } = req.params;
    const { enabled } = req.body;

    const model = await toggleModel(modelId, enabled);
    await addLog('info', `模型 ${modelId} 已${enabled ? '启用' : '禁用'}`);
    res.json({ success: true, model });
  } catch (error) {
    await addLog('error', `切换模型状态失败: ${error.message}`);
    res.status(400).json({ error: error.message });
  }
});

// 获取模型统计（管理员）
router.get('/models/stats', async (req, res) => {
  try {
    const stats = await getModelStats();
    res.json(stats);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 设置用户特定模型配额（管理员）
router.post('/users/:userId/models/:modelId/quota', async (req, res) => {
  try {
    const { userId, modelId } = req.params;
    const { quota } = req.body;

    if (!quota || quota < 0) {
      return res.status(400).json({ error: '配额必须是正数' });
    }

    const result = await setUserModelQuota(userId, modelId, quota);
    await addLog('info', `为用户 ${userId} 设置模型 ${modelId} 配额为 ${quota}`);
    res.json({ success: true, ...result });
  } catch (error) {
    await addLog('error', `设置用户模型配额失败: ${error.message}`);
    res.status(400).json({ error: error.message });
  }
});

// 清理过期使用记录（管理员）
router.post('/models/cleanup', async (req, res) => {
  try {
    const cleaned = await cleanupOldUsage();
    await addLog('info', `清理了 ${cleaned} 条过期的模型使用记录`);
    res.json({ success: true, cleaned });
  } catch (error) {
    await addLog('error', `清理过期记录失败: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// ========== 模型 API（用户）==========

// 获取用户模型使用情况（用户）
router.get('/user/models/usage', userAuth, async (req, res) => {
  try {
    const usage = await getUserModelUsage(req.userId);
    res.json(usage);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 获取用户模型配额（用户）
router.get('/user/models/:modelId/quota', userAuth, async (req, res) => {
  try {
    const { modelId } = req.params;
    const quota = await getUserModelQuota(req.userId, modelId);
    const check = await checkModelQuota(req.userId, modelId);

    res.json({
      modelId,
      quota,
      ...check
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==================== AI 自动管理系统 ====================

// 获取AI配置
router.get('/ai/config', adminAuth, async (req, res) => {
  try {
    const config = await aiModerator.loadAIConfig();
    // 不返回完整的API密钥
    const safeConfig = {
      ...config,
      apiKey: config.apiKey ? `${config.apiKey.substring(0, 10)}...` : ''
    };
    res.json(safeConfig);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 更新AI配置
router.post('/ai/config', adminAuth, async (req, res) => {
  try {
    const currentConfig = await aiModerator.loadAIConfig();
    const newConfig = {
      ...currentConfig,
      ...req.body
    };

    // 如果apiKey是省略的形式，保留原值
    if (req.body.apiKey && req.body.apiKey.endsWith('...')) {
      newConfig.apiKey = currentConfig.apiKey;
    }

    await aiModerator.saveAIConfig(newConfig);

    // 如果启用状态或间隔时间改变，重启调度器
    if (newConfig.enabled !== currentConfig.enabled ||
        newConfig.checkIntervalHours !== currentConfig.checkIntervalHours) {
      await aiModerator.restartAIScheduler();
    }

    await addLog('info', `管理员更新了AI配置`);
    res.json({ success: true, message: 'AI配置已更新' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 手动触发AI审核
router.post('/ai/run', adminAuth, async (req, res) => {
  try {
    await addLog('info', `管理员手动触发AI审核`);
    const result = await aiModerator.runAIModeration(true);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 获取AI审核日志
router.get('/ai/logs', adminAuth, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 100;
    const logs = await aiModerator.getAIModerationLogs(limit);
    res.json({ logs });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 获取AI统计信息
router.get('/ai/statistics', adminAuth, async (req, res) => {
  try {
    const stats = await aiModerator.getAIStatistics();
    res.json(stats);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 启动AI调度器
router.post('/ai/scheduler/start', adminAuth, async (req, res) => {
  try {
    aiModerator.startAIScheduler();
    await addLog('info', `管理员启动了AI调度器`);
    res.json({ success: true, message: 'AI调度器已启动' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 停止AI调度器
router.post('/ai/scheduler/stop', adminAuth, async (req, res) => {
  try {
    aiModerator.stopAIScheduler();
    await addLog('info', `管理员停止了AI调度器`);
    res.json({ success: true, message: 'AI调度器已停止' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
export { incrementRequestCount, addLog, checkModelQuota, recordModelUsage };
