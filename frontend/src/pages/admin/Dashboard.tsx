import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { adminApi } from '@/services/api'
import {
  Rocket,
  Key,
  KeyRound,
  Activity,
  Cpu,
  Clock,
  RotateCcw,
  Zap,
  TestTube,
  BarChart3,
} from 'lucide-react'

interface Stats {
  serviceStatus: string
  tokenCount: number
  tokenEnabled: number
  tokenDisabled: number
  keyCount: number
  keyRequests: number
  todayRequests: number
  cpu: string
  memory: string
  uptime: string
  totalTokens: number
  currentIndex: number
  rotationRequests: number
  idleStatus: string
  idleTime: string
  totalRequests: number
  baseUrl: string
  // 额外的系统信息
  nodeVersion: string
  platform: string
  pid: number
  systemMemory: string
}

export function Dashboard() {
  const navigate = useNavigate()
  const [stats, setStats] = useState<Stats>({
    serviceStatus: '运行中',
    tokenCount: 0,
    tokenEnabled: 0,
    tokenDisabled: 0,
    keyCount: 0,
    keyRequests: 0,
    todayRequests: 0,
    cpu: '-',
    memory: '-',
    uptime: '-',
    totalTokens: 0,
    currentIndex: 0,
    rotationRequests: 0,
    idleStatus: '活跃',
    idleTime: '0 秒',
    totalRequests: 0,
    baseUrl: window.location.origin,
    nodeVersion: '-',
    platform: '-',
    pid: 0,
    systemMemory: '-',
  })
  const [, setLoading] = useState(true)

  useEffect(() => {
    loadStats()
    const interval = setInterval(loadStats, 30000)
    return () => clearInterval(interval)
  }, [])

  const loadStats = async () => {
    try {
      const [tokenStatsRes, keyStatsRes, statusRes] = await Promise.all([
        adminApi.getTokenStats(),
        adminApi.getKeyStats(),
        adminApi.getStatus(),
      ])

      if (tokenStatsRes.success && tokenStatsRes.data) {
        const data = tokenStatsRes.data as Record<string, unknown>
        setStats(prev => ({
          ...prev,
          tokenCount: (data.total as number) || 0,
          tokenEnabled: (data.enabled as number) || 0,
          tokenDisabled: (data.disabled as number) || 0,
        }))
      }

      if (keyStatsRes.success && keyStatsRes.data) {
        const data = keyStatsRes.data as Record<string, unknown>
        setStats(prev => ({
          ...prev,
          keyCount: (data.total as number) || 0,
          keyRequests: (data.totalRequests as number) || 0,
        }))
      }

      if (statusRes.success && statusRes.data) {
        const data = statusRes.data as Record<string, unknown>
        
        // 后端直接返回扁平结构
        setStats(prev => ({
          ...prev,
          cpu: (data.cpu as string) || '-',
          memory: (data.memory as string) || '-',
          uptime: (data.uptime as string) || '-',
          totalTokens: prev.tokenEnabled, // 使用 token stats 中的数据
          currentIndex: 0,
          rotationRequests: (data.requests as number) || 0,
          idleStatus: (data.idle as string) || '活跃',
          idleTime: formatIdleTime((data.idleTime as number) || 0),
          totalRequests: (data.requests as number) || 0,
          todayRequests: (data.requests as number) || 0,
          nodeVersion: (data.nodeVersion as string) || '-',
          platform: (data.platform as string) || '-',
          pid: (data.pid as number) || 0,
          systemMemory: (data.systemMemory as string) || '-',
        }))
      }
    } catch (error) {
      console.error('Failed to load stats:', error)
    } finally {
      setLoading(false)
    }
  }

  const formatIdleTime = (seconds: number): string => {
    if (seconds < 60) return `${seconds} 秒`
    if (seconds < 3600) return `${Math.floor(seconds / 60)} 分钟`
    return `${Math.floor(seconds / 3600)} 小时`
  }

  return (
    <div className="space-y-6">
      {/* 核心数据面板 */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card className="bg-gradient-to-br from-violet-500/10 to-purple-500/10 border-violet-500/20">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">服务状态</CardTitle>
            <Rocket className="h-4 w-4 text-violet-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.serviceStatus}</div>
            <p className="text-xs text-muted-foreground">System Online</p>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-green-500/10 to-emerald-500/10 border-green-500/20">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Token 账号</CardTitle>
            <Key className="h-4 w-4 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.tokenCount}</div>
            <p className="text-xs text-muted-foreground">
              启用: {stats.tokenEnabled} · 禁用: {stats.tokenDisabled}
            </p>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-amber-500/10 to-orange-500/10 border-amber-500/20">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">API 密钥</CardTitle>
            <KeyRound className="h-4 w-4 text-amber-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.keyCount}</div>
            <p className="text-xs text-muted-foreground">
              总请求: {stats.keyRequests}
            </p>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-blue-500/10 to-cyan-500/10 border-blue-500/20">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">今日请求</CardTitle>
            <Activity className="h-4 w-4 text-blue-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.todayRequests}</div>
            <p className="text-xs text-muted-foreground">API Calls Today</p>
          </CardContent>
        </Card>
      </div>

      {/* 系统信息概览 */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-gradient-to-br from-indigo-500 to-purple-500">
                <Cpu className="h-5 w-5 text-white" />
              </div>
              <div>
                <CardTitle className="text-base">系统性能</CardTitle>
                <CardDescription>实时监控数据</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex justify-between items-center">
              <span className="text-sm text-muted-foreground">CPU 使用率</span>
              <Badge variant="outline">{stats.cpu}</Badge>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm text-muted-foreground">内存使用</span>
              <Badge variant="outline">{stats.memory}</Badge>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm text-muted-foreground">运行时长</span>
              <Badge variant="outline">{stats.uptime}</Badge>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-gradient-to-br from-pink-500 to-rose-500">
                <RotateCcw className="h-5 w-5 text-white" />
              </div>
              <div>
                <CardTitle className="text-base">Token 轮询</CardTitle>
                <CardDescription>负载均衡状态</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex justify-between items-center">
              <span className="text-sm text-muted-foreground">总 Token 数</span>
              <Badge variant="outline">{stats.totalTokens}</Badge>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm text-muted-foreground">当前位置</span>
              <Badge variant="outline">#{stats.currentIndex}</Badge>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm text-muted-foreground">轮询请求</span>
              <Badge variant="outline">{stats.rotationRequests}</Badge>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-gradient-to-br from-cyan-500 to-blue-500">
                <Zap className="h-5 w-5 text-white" />
              </div>
              <div>
                <CardTitle className="text-base">服务器状态</CardTitle>
                <CardDescription>空闲模式管理</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex justify-between items-center">
              <span className="text-sm text-muted-foreground">当前状态</span>
              <Badge variant={stats.idleStatus === '活跃' ? 'success' : 'secondary'}>
                {stats.idleStatus}
              </Badge>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm text-muted-foreground">空闲时间</span>
              <Badge variant="outline">{stats.idleTime}</Badge>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm text-muted-foreground">总请求数</span>
              <Badge variant="outline">{stats.totalRequests}</Badge>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* 环境信息 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Cpu className="h-5 w-5" />
            环境信息
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 md:grid-cols-4">
            <div className="p-3 rounded-lg border-l-4 border-l-violet-500 bg-muted/50">
              <p className="text-sm text-muted-foreground">Node 版本</p>
              <p className="font-semibold">{stats.nodeVersion}</p>
            </div>
            <div className="p-3 rounded-lg border-l-4 border-l-blue-500 bg-muted/50">
              <p className="text-sm text-muted-foreground">平台</p>
              <p className="font-semibold">{stats.platform}</p>
            </div>
            <div className="p-3 rounded-lg border-l-4 border-l-green-500 bg-muted/50">
              <p className="text-sm text-muted-foreground">进程 ID</p>
              <p className="font-semibold">{stats.pid}</p>
            </div>
            <div className="p-3 rounded-lg border-l-4 border-l-amber-500 bg-muted/50">
              <p className="text-sm text-muted-foreground">系统内存</p>
              <p className="font-semibold">{stats.systemMemory}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 快速操作和指南 */}
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Zap className="h-5 w-5" />
              快速操作
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-3">
              <Button
                variant="outline"
                className="h-auto py-4 flex flex-col items-center gap-2"
                onClick={() => navigate('/admin/tokens')}
              >
                <Key className="h-5 w-5" />
                <span>管理 Token</span>
              </Button>
              <Button
                variant="outline"
                className="h-auto py-4 flex flex-col items-center gap-2"
                onClick={() => navigate('/admin/keys')}
              >
                <KeyRound className="h-5 w-5" />
                <span>生成密钥</span>
              </Button>
              <Button
                variant="outline"
                className="h-auto py-4 flex flex-col items-center gap-2"
                onClick={() => navigate('/admin/test')}
              >
                <TestTube className="h-5 w-5" />
                <span>测试 API</span>
              </Button>
              <Button
                variant="outline"
                className="h-auto py-4 flex flex-col items-center gap-2"
                onClick={() => navigate('/admin/monitor')}
              >
                <BarChart3 className="h-5 w-5" />
                <span>系统监控</span>
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Clock className="h-5 w-5" />
              快速开始指南
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="flex gap-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground text-sm font-medium">
                  1
                </div>
                <div>
                  <p className="font-medium">获取 Token</p>
                  <p className="text-sm text-muted-foreground">在 Token 管理页面通过 Google OAuth 登录获取访问令牌</p>
                </div>
              </div>
              <div className="flex gap-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground text-sm font-medium">
                  2
                </div>
                <div>
                  <p className="font-medium">生成密钥</p>
                  <p className="text-sm text-muted-foreground">在密钥管理页面创建 API 密钥用于应用程序访问</p>
                </div>
              </div>
              <div className="flex gap-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground text-sm font-medium">
                  3
                </div>
                <div>
                  <p className="font-medium">测试接口</p>
                  <p className="text-sm text-muted-foreground">使用 API 测试工具验证服务是否正常工作</p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* API 端点信息 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Activity className="h-5 w-5" />
            API 端点信息
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 md:grid-cols-3">
            <div className="flex items-center gap-3 p-3 rounded-lg border">
              <Badge className="bg-green-500">GET</Badge>
              <div>
                <code className="text-sm">/v1/models</code>
                <p className="text-xs text-muted-foreground">获取模型列表</p>
              </div>
            </div>
            <div className="flex items-center gap-3 p-3 rounded-lg border">
              <Badge className="bg-blue-500">POST</Badge>
              <div>
                <code className="text-sm">/v1/chat/completions</code>
                <p className="text-xs text-muted-foreground">聊天补全接口</p>
              </div>
            </div>
            <div className="flex items-center gap-3 p-3 rounded-lg border">
              <Badge className="bg-green-500">GET</Badge>
              <div>
                <code className="text-sm">/admin/status</code>
                <p className="text-xs text-muted-foreground">系统状态监控</p>
              </div>
            </div>
          </div>
          <div className="mt-4 p-3 rounded-lg bg-muted">
            <span className="font-medium">基础 URL:</span>
            <code className="ml-2">{stats.baseUrl}</code>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

