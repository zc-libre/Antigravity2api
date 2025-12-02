// API 服务层
// 使用 /antigravity/api 前缀
const API_BASE = '/antigravity/api'

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

async function request<T>(url: string, options?: RequestInit): Promise<ApiResponse<T>> {
  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...options?.headers as Record<string, string>,
    }
    
    // 自动添加管理员认证 header
    const adminToken = getAdminToken()
    if (adminToken && url.startsWith('/admin')) {
      headers['x-admin-token'] = adminToken
    }
    
    // 自动添加用户认证 header
    const userToken = getUserToken()
    if (userToken && url.startsWith('/user')) {
      headers['x-user-token'] = userToken
    }
    
    const response = await fetch(`${API_BASE}${url}`, {
      ...options,
      headers,
    })
    
    // 处理 401 未授权错误，自动跳转到登录页
    if (response.status === 401) {
      // 判断是 admin 还是 user 接口
      if (url.startsWith('/admin')) {
        localStorage.removeItem('admin_token')
        // 避免在登录页面时重复跳转
        if (!window.location.pathname.includes('/admin/login')) {
          window.location.href = '/admin/login'
        }
      } else if (url.startsWith('/user')) {
        localStorage.removeItem('user_token')
        // 如果有用户登录页，跳转到用户登录页
        if (!window.location.pathname.includes('/user/login')) {
          window.location.href = '/user/login'
        }
      }
      const error = await response.json().catch(() => ({ error: 'Unauthorized' }))
      return { success: false, error: error.error || error.message || 'Unauthorized' }
    }
    
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
  // 验证 session
  verifySession: (session: string) => 
    request('/admin/verify-session', {
      method: 'POST',
      body: JSON.stringify({ session }),
    }),

  // 登录
  login: (password: string) =>
    request<{ token: string }>('/admin/login', {
      method: 'POST',
      body: JSON.stringify({ password }),
    }),

  // 获取密钥统计
  getKeyStats: () => request('/admin/keys/stats'),

  // 获取 Token 统计
  getTokenStats: () => request('/admin/tokens/stats'),

  // 获取 Token 列表
  getTokens: () => request('/admin/tokens'),

  // 触发 Google OAuth 登录
  triggerGoogleLogin: () =>
    request<{ success: boolean; authUrl: string }>('/admin/tokens/login', {
      method: 'POST',
    }),

  // 通过回调链接添加 Token
  addTokenByCallback: (callbackUrl: string) =>
    request('/admin/tokens/callback', {
      method: 'POST',
      body: JSON.stringify({ callbackUrl }),
    }),

  // 直接添加 Token
  addTokenDirect: (tokenData: { access_token: string; refresh_token?: string; expires_in?: number }) =>
    request('/admin/tokens/direct', {
      method: 'POST',
      body: JSON.stringify(tokenData),
    }),

  // 删除 Token（使用数组索引）
  deleteToken: (index: number) =>
    request(`/admin/tokens/${index}`, { method: 'DELETE' }),

  // 切换 Token 状态（使用数组索引）
  toggleToken: (index: number, enable: boolean) =>
    request(`/admin/tokens/${index}`, { 
      method: 'PATCH',
      body: JSON.stringify({ enable }),
    }),

  // 获取密钥列表
  getKeys: () => request('/admin/keys'),

  // 生成密钥
  generateKey: (data: { name?: string; rateLimit?: { maxRequests: number; windowSeconds: number } }) =>
    request('/admin/keys/generate', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  // 删除密钥
  deleteKey: (key: string) =>
    request(`/admin/keys/${key}`, { method: 'DELETE' }),

  // 获取公告列表
  getAnnouncements: () => request('/admin/announcements'),

  // 创建公告
  createAnnouncement: (data: FormData) => {
    const headers: Record<string, string> = {}
    const adminToken = getAdminToken()
    if (adminToken) {
      headers['x-admin-token'] = adminToken
    }
    return fetch(`${API_BASE}/admin/announcements`, {
      method: 'POST',
      headers,
      body: data,
    }).then(res => res.json())
  },

  // 删除公告
  deleteAnnouncement: (id: string) =>
    request(`/admin/announcements/${id}`, { method: 'DELETE' }),

  // 获取用户列表
  getUsers: () => request('/admin/users'),

  // 删除用户
  deleteUser: (userId: string) =>
    request(`/admin/users/${userId}`, { method: 'DELETE' }),

  // 获取 AI 配置
  getAIConfig: () => request('/admin/ai/config'),

  // 更新 AI 配置
  updateAIConfig: (config: unknown) =>
    request('/admin/ai/config', {
      method: 'POST',
      body: JSON.stringify(config),
    }),

  // 获取 AI 日志
  getAILogs: () => request('/admin/ai/logs'),

  // 运行 AI 审核
  runAIModerator: () =>
    request('/admin/ai/run', { method: 'POST' }),

  // 获取日志
  getLogs: (params?: { level?: string; limit?: number }) => {
    const query = new URLSearchParams()
    if (params?.level) query.set('level', params.level)
    if (params?.limit) query.set('limit', params.limit.toString())
    return request(`/admin/logs?${query}`)
  },

  // 清理日志
  clearLogs: () =>
    request('/admin/logs', { method: 'DELETE' }),

  // 获取监控数据
  getStatus: () => request('/admin/status'),

  // 获取系统设置
  getSettings: () => request('/admin/settings'),

  // 更新系统设置
  updateSettings: (settings: unknown) =>
    request('/admin/settings', {
      method: 'POST',
      body: JSON.stringify(settings),
    }),
}

// User API
export const userApi = {
  // 登录
  login: (username: string, password: string) =>
    request<{ token: string; user: { username: string } }>('/user/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    }),

  // 注册
  register: (username: string, password: string) =>
    request('/user/register', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    }),

  // 获取用户信息
  getProfile: (token: string) =>
    request('/user/profile', {
      headers: { Authorization: `Bearer ${token}` },
    }),

  // 获取用户密钥
  getKeys: (token: string) =>
    request('/user/keys', {
      headers: { Authorization: `Bearer ${token}` },
    }),

  // 生成密钥
  generateKey: (token: string, name?: string) =>
    request('/user/generate-key', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ name }),
    }),

  // 删除密钥
  deleteKey: (token: string, key: string) =>
    request(`/user/keys/${key}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    }),

  // 获取用户 Token
  getTokens: (token: string) =>
    request('/user/tokens', {
      headers: { Authorization: `Bearer ${token}` },
    }),

  // 添加 Token
  addToken: (token: string, tokenData: unknown) =>
    request('/user/add-token', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify(tokenData),
    }),

  // 修改密码
  changePassword: (token: string, oldPassword: string, newPassword: string) =>
    request('/user/change-password', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ old_password: oldPassword, new_password: newPassword }),
    }),

  // 获取公告
  getAnnouncements: () => request('/user/announcements'),
}

// 聊天 API
export const chatApi = {
  test: (apiKey: string, model: string, message: string) =>
    fetch('/antigravity/api/v1/chat/completions', {
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
    fetch('/antigravity/api/v1/models', {
      headers: { Authorization: `Bearer ${apiKey}` },
    }).then(res => res.json()),
}

// Amazon Q API
const AMAZONQ_API_BASE = '/amazonq'

async function amazonqRequest<T>(url: string, options?: RequestInit): Promise<ApiResponse<T>> {
  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...options?.headers as Record<string, string>,
    }
    
    const response = await fetch(`${AMAZONQ_API_BASE}${url}`, {
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

export const amazonqApi = {
  // 健康检查
  getHealth: () => amazonqRequest('/health'),

  // 获取所有任务
  getTasks: () => amazonqRequest('/api/tasks'),

  // 创建注册任务
  createTask: (options: {
    password?: string
    fullName?: string
    headless?: boolean
    label?: string
    maxRetries?: number
  }) =>
    amazonqRequest('/api/register', {
      method: 'POST',
      body: JSON.stringify(options),
    }),

  // 查询任务状态
  getTaskStatus: (taskId: string) => amazonqRequest(`/api/register/${taskId}`),

  // 获取任务日志
  getTaskLogs: (taskId: string) => amazonqRequest(`/api/register/${taskId}/logs`),

  // 取消任务
  cancelTask: (taskId: string) =>
    amazonqRequest(`/api/register/${taskId}`, { method: 'DELETE' }),

  // 获取所有账号
  getAccounts: () => amazonqRequest('/api/accounts'),

  // 获取账号详情（支持 id 或 email）
  getAccountDetail: (idOrEmail: string) => amazonqRequest(`/api/accounts/${encodeURIComponent(idOrEmail)}`),

  // 更新账号（启用/禁用、标签）
  updateAccount: (id: string, data: { enabled?: boolean; label?: string }) =>
    amazonqRequest(`/api/accounts/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),

  // 删除账号
  deleteAccount: (id: string) =>
    amazonqRequest(`/api/accounts/${encodeURIComponent(id)}`, { method: 'DELETE' }),
}

// Kiro API
const KIRO_API_BASE = '/kiro'

async function kiroRequest<T>(url: string, options?: RequestInit): Promise<ApiResponse<T>> {
  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...options?.headers as Record<string, string>,
    }
    
    const response = await fetch(`${KIRO_API_BASE}${url}`, {
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

export const kiroApi = {
  // 健康检查
  getHealth: () => kiroRequest('/health'),

  // 获取所有账号
  getAccounts: () => kiroRequest('/api/accounts'),

  // 获取账号详情
  getAccountDetail: (id: string) => kiroRequest(`/api/accounts/${encodeURIComponent(id)}`),

  // 创建账号
  createAccount: (data: { refreshToken: string; name?: string; enabled?: boolean }) =>
    kiroRequest('/api/accounts', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  // 更新账号（启用/禁用、标签）
  updateAccount: (id: string, data: { enabled?: boolean; label?: string }) =>
    kiroRequest(`/api/accounts/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),

  // 删除账号
  deleteAccount: (id: string) =>
    kiroRequest(`/api/accounts/${encodeURIComponent(id)}`, { method: 'DELETE' }),
}

