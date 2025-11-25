// API 服务层
const API_BASE = ''

interface ApiResponse<T = unknown> {
  success?: boolean
  data?: T
  error?: string
  message?: string
}

// 获取管理员 token
function getAdminToken(): string | null {
  return localStorage.getItem('admin_token')
}

// 获取用户 token
function getUserToken(): string | null {
  return localStorage.getItem('user_token')
}

async function request<T>(url: string, options?: RequestInit & { auth?: 'admin' | 'user' | 'none' }): Promise<ApiResponse<T>> {
  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...options?.headers as Record<string, string>,
    }
    
    // 根据 auth 类型添加认证 header
    const authType = options?.auth ?? 'none'
    if (authType === 'admin') {
      const token = getAdminToken()
      if (token) {
        headers['x-admin-token'] = token
      }
    } else if (authType === 'user') {
      const token = getUserToken()
      if (token) {
        headers['x-user-token'] = token
      }
    }
    
    const response = await fetch(`${API_BASE}${url}`, {
      ...options,
      headers,
    })
    
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Request failed' }))
      return { success: false, error: error.error || error.message || 'Request failed' }
    }
    
    const data = await response.json()
    return { success: true, data }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
  }
}

// Admin API
export const adminApi = {
  // 验证 token
  verifyToken: () => 
    request('/admin/verify', {
      method: 'GET',
      auth: 'admin',
    }),

  // 登录（不需要认证）
  login: (password: string) =>
    request<{ token: string }>('/admin/login', {
      method: 'POST',
      body: JSON.stringify({ password }),
    }),

  // 登出
  logout: () => {
    const token = getAdminToken()
    localStorage.removeItem('admin_token')
    return request('/admin/logout', {
      method: 'POST',
      headers: token ? { 'x-admin-token': token } : {},
    })
  },

  // 获取 Token 统计数据
  getTokenStats: () => request('/admin/tokens/stats', { auth: 'admin' }),

  // 获取密钥统计数据
  getKeyStats: () => request('/admin/keys/stats', { auth: 'admin' }),

  // 获取 Token 列表
  getTokens: () => request('/admin/tokens', { auth: 'admin' }),

  // 获取 Token 使用情况
  getTokenUsage: () => request('/admin/tokens/usage', { auth: 'admin' }),

  // 获取 Token 详情（账号名称等）
  getTokenDetails: (indices: number[]) =>
    request('/admin/tokens/details', {
      method: 'POST',
      body: JSON.stringify({ indices }),
      auth: 'admin',
    }),

  // 添加 Token（直接输入）
  addToken: (tokenData: { access_token: string; refresh_token?: string; expires_in?: number }) =>
    request('/admin/tokens/direct', {
      method: 'POST',
      body: JSON.stringify(tokenData),
      auth: 'admin',
    }),

  // 通过 OAuth 回调添加 Token
  addTokenCallback: (callbackUrl: string) =>
    request('/admin/tokens/callback', {
      method: 'POST',
      body: JSON.stringify({ callbackUrl }),
      auth: 'admin',
    }),

  // 导出 Token
  exportTokens: (indices: number[]) =>
    fetch('/admin/tokens/export', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-token': localStorage.getItem('admin_token') || '',
      },
      body: JSON.stringify({ indices }),
    }),

  // 导入 Token
  importTokens: (file: File) => {
    const formData = new FormData()
    formData.append('file', file)
    return fetch('/admin/tokens/import', {
      method: 'POST',
      headers: {
        'x-admin-token': localStorage.getItem('admin_token') || '',
      },
      body: formData,
    }).then(res => res.json())
  },

  // 检查 Token 健康状态
  checkTokenHealth: (index: number) =>
    request(`/admin/tokens/${index}/health`, {
      method: 'POST',
      auth: 'admin',
    }),

  // 删除 Token
  deleteToken: (index: number) =>
    request(`/admin/tokens/${index}`, { method: 'DELETE', auth: 'admin' }),

  // 切换 Token 状态
  toggleToken: (index: number, enable: boolean) =>
    request(`/admin/tokens/${index}`, { 
      method: 'PATCH', 
      body: JSON.stringify({ enable }),
      auth: 'admin' 
    }),

  // 获取密钥列表
  getKeys: () => request('/admin/keys', { auth: 'admin' }),

  // 生成密钥
  generateKey: (data: { name?: string; rateLimit?: { max_requests: number; window_seconds: number } }) =>
    request('/admin/keys/generate', {
      method: 'POST',
      body: JSON.stringify(data),
      auth: 'admin',
    }),

  // 删除密钥
  deleteKey: (key: string) =>
    request(`/admin/keys/${key}`, { method: 'DELETE', auth: 'admin' }),

  // 获取公告列表
  getAnnouncements: () => request('/admin/announcements', { auth: 'admin' }),

  // 上传公告图片
  uploadAnnouncementImage: (file: File) => {
    const formData = new FormData()
    formData.append('image', file)
    return fetch('/admin/announcements/upload', {
      method: 'POST',
      headers: {
        'x-admin-token': localStorage.getItem('admin_token') || '',
      },
      body: formData,
    }).then(res => res.json())
  },

  // 创建公告
  createAnnouncement: (data: { title: string; content: string; type?: string; images?: string[]; pinned?: boolean }) =>
    request('/admin/announcements', {
      method: 'POST',
      body: JSON.stringify(data),
      auth: 'admin',
    }),

  // 更新/切换公告状态
  updateAnnouncement: (id: string, data: { enabled?: boolean; pinned?: boolean }) =>
    request(`/admin/announcements/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
      auth: 'admin',
    }),

  // 删除公告
  deleteAnnouncement: (id: string) =>
    request(`/admin/announcements/${id}`, { method: 'DELETE', auth: 'admin' }),

  // 获取用户列表
  getUsers: () => request('/admin/users', { auth: 'admin' }),

  // 删除用户
  deleteUser: (userId: string) =>
    request(`/admin/users/${userId}`, { method: 'DELETE', auth: 'admin' }),

  // 获取 AI 配置
  getAIConfig: () => request('/admin/ai/config', { auth: 'admin' }),

  // 更新 AI 配置
  updateAIConfig: (config: unknown) =>
    request('/admin/ai/config', {
      method: 'POST',
      body: JSON.stringify(config),
      auth: 'admin',
    }),

  // 获取 AI 日志
  getAILogs: () => request('/admin/ai/logs', { auth: 'admin' }),

  // 获取 AI 统计
  getAIStatistics: () => request('/admin/ai/statistics', { auth: 'admin' }),

  // 运行 AI 审核
  runAIModerator: () =>
    request('/admin/ai/run', { method: 'POST', auth: 'admin' }),

  // 获取日志
  getLogs: (params?: { level?: string; limit?: number }) => {
    const query = new URLSearchParams()
    if (params?.level) query.set('level', params.level)
    if (params?.limit) query.set('limit', params.limit.toString())
    return request(`/admin/logs?${query}`, { auth: 'admin' })
  },

  // 清理日志
  clearLogs: () =>
    request('/admin/logs', { method: 'DELETE', auth: 'admin' }),

  // 获取监控数据
  getStatus: () => request('/admin/status', { auth: 'admin' }),

  // 获取系统设置
  getSettings: () => request('/admin/settings', { auth: 'admin' }),

  // 更新系统设置
  updateSettings: (settings: unknown) =>
    request('/admin/settings', {
      method: 'POST',
      body: JSON.stringify(settings),
      auth: 'admin',
    }),

  // OAuth 配置（公开接口）
  getOAuthConfig: () => request('/admin/oauth-config'),

  updateOAuthConfig: (config: { client_id: string; client_secret: string; project_id: string }) =>
    request('/admin/oauth-config', {
      method: 'PUT',
      body: JSON.stringify(config),
      auth: 'admin',
    }),

  // 触发 OAuth 登录
  triggerOAuthLogin: (data?: { client_id?: string; client_secret?: string; project_id?: string }) =>
    request('/admin/tokens/login', { 
      method: 'POST', 
      body: JSON.stringify(data || {}),
      auth: 'admin' 
    }),
}

// User API
export const userApi = {
  // 验证 token
  verifyToken: () =>
    request('/admin/user/verify', {
      method: 'GET',
      auth: 'user',
    }),

  // 登录（不需要认证）
  login: (username: string, password: string) =>
    request<{ token: string; user: { id: string; username: string; email?: string } }>('/admin/user/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    }),

  // 登出
  logout: () => {
    const token = getUserToken()
    localStorage.removeItem('user_token')
    return request('/admin/user/logout', {
      method: 'POST',
      headers: token ? { 'x-user-token': token } : {},
    })
  },

  // 注册（不需要认证）
  register: (username: string, password: string, email?: string) =>
    request('/admin/user/register', {
      method: 'POST',
      body: JSON.stringify({ username, password, email }),
    }),

  // 获取用户信息
  getProfile: () =>
    request('/admin/user/profile', { auth: 'user' }),

  // 更新用户信息
  updateProfile: (data: { email?: string; password?: string; systemPrompt?: string }) =>
    request('/admin/user/profile', {
      method: 'PATCH',
      body: JSON.stringify(data),
      auth: 'user',
    }),

  // 获取用户密钥
  getKeys: () =>
    request('/admin/user/keys', { auth: 'user' }),

  // 生成密钥
  generateKey: (name?: string) =>
    request('/admin/user/keys/generate', {
      method: 'POST',
      body: JSON.stringify({ name }),
      auth: 'user',
    }),

  // 删除密钥
  deleteKey: (keyId: string) =>
    request(`/admin/user/keys/${keyId}`, {
      method: 'DELETE',
      auth: 'user',
    }),

  // 获取用户 Google Tokens
  getTokens: () =>
    request('/admin/user/tokens', { auth: 'user' }),

  // 添加 Token（直接输入）
  addTokenDirect: (tokenData: { access_token: string; refresh_token?: string; expires_in?: number; client_id?: string; client_secret?: string }) =>
    request('/admin/user/tokens/direct', {
      method: 'POST',
      body: JSON.stringify(tokenData),
      auth: 'user',
    }),

  // 删除 Token
  deleteToken: (index: number) =>
    request(`/admin/user/tokens/${index}`, {
      method: 'DELETE',
      auth: 'user',
    }),

  // 切换 Token 状态
  toggleToken: (index: number, enable: boolean) =>
    request(`/admin/user/tokens/${index}/toggle`, {
      method: 'PATCH',
      body: JSON.stringify({ enable }),
      auth: 'user',
    }),

  // 更新 Token 共享设置
  updateTokenSharing: (index: number, data: { isShared?: boolean; dailyLimit?: number }) =>
    request(`/admin/user/tokens/${index}/sharing`, {
      method: 'PATCH',
      body: JSON.stringify(data),
      auth: 'user',
    }),

  // 修改密码
  changePassword: (oldPassword: string, newPassword: string) =>
    request('/admin/user/profile', {
      method: 'PATCH',
      body: JSON.stringify({ old_password: oldPassword, password: newPassword }),
      auth: 'user',
    }),

  // 获取公告（公开接口）
  getAnnouncements: () => request('/admin/announcements/active'),

  // 触发 OAuth 登录
  triggerOAuthLogin: () =>
    request('/admin/user/tokens/login', {
      method: 'POST',
      auth: 'user',
    }),
}

// 聊天 API
export const chatApi = {
  test: (apiKey: string, model: string, message: string) =>
    fetch('/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: message }],
        stream: false,
      }),
    }).then(res => res.json()),

  getModels: (apiKey: string) =>
    fetch('/v1/models', {
      headers: { Authorization: `Bearer ${apiKey}` },
    }).then(res => res.json()),
}

