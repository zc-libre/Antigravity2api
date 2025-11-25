import { useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { adminApi } from '@/services/api'
import {
  Activity,
  RefreshCw,
  Loader2,
  Cpu,
  MemoryStick,
  HardDrive,
  Clock,
  Server,
  Wifi,
  Database,
} from 'lucide-react'

// 后端实际返回的扁平数据结构
interface BackendStatus {
  cpu: string           // "15%"
  memory: string        // "150 MB / 512 MB"
  uptime: string        // "1时30分45秒"
  requests: number
  nodeVersion: string
  platform: string
  pid: number
  systemMemory: string  // "8 GB / 16 GB"
  idle: string          // "活跃" 或 "空闲模式"
  idleTime: number      // 秒数
}

interface DisplayStatus {
  cpu: string
  memory: string
  uptime: string
  requests: number
  nodeVersion: string
  platform: string
  pid: number
  systemMemory: string
  idle: string
  idleTime: number
}

export function Monitor() {
  const [status, setStatus] = useState<DisplayStatus>({
    cpu: '-',
    memory: '-',
    uptime: '-',
    requests: 0,
    nodeVersion: '-',
    platform: '-',
    pid: 0,
    systemMemory: '-',
    idle: '活跃',
    idleTime: 0,
  })
  const [tokenStats, setTokenStats] = useState({ total: 0, enabled: 0 })
  const [keyStats, setKeyStats] = useState({ total: 0, totalRequests: 0 })
  const [loading, setLoading] = useState(true)
  const [autoRefresh, setAutoRefresh] = useState(true)

  useEffect(() => {
    loadStatus()
  }, [])

  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | null = null
    if (autoRefresh) {
      interval = setInterval(loadStatus, 5000)
    }
    return () => {
      if (interval) clearInterval(interval)
    }
  }, [autoRefresh])

  const loadStatus = async () => {
    try {
      const [statusRes, tokenStatsRes, keyStatsRes] = await Promise.all([
        adminApi.getStatus(),
        adminApi.getTokenStats(),
        adminApi.getKeyStats(),
      ])
      
      if (statusRes.success && statusRes.data) {
        const data = statusRes.data as BackendStatus
        setStatus({
          cpu: data.cpu || '-',
          memory: data.memory || '-',
          uptime: data.uptime || '-',
          requests: data.requests || 0,
          nodeVersion: data.nodeVersion || '-',
          platform: data.platform || '-',
          pid: data.pid || 0,
          systemMemory: data.systemMemory || '-',
          idle: data.idle || '活跃',
          idleTime: data.idleTime || 0,
        })
      }
      
      if (tokenStatsRes.success && tokenStatsRes.data) {
        const data = tokenStatsRes.data as { total?: number; enabled?: number }
        setTokenStats({
          total: data.total || 0,
          enabled: data.enabled || 0,
        })
      }
      
      if (keyStatsRes.success && keyStatsRes.data) {
        const data = keyStatsRes.data as { total?: number; totalRequests?: number }
        setKeyStats({
          total: data.total || 0,
          totalRequests: data.totalRequests || 0,
        })
      }
    } catch (error) {
      console.error('Failed to load status:', error)
    } finally {
      setLoading(false)
    }
  }

  const formatIdleTime = (seconds: number): string => {
    if (seconds < 60) return `${seconds} 秒`
    if (seconds < 3600) return `${Math.floor(seconds / 60)} 分钟`
    return `${Math.floor(seconds / 3600)} 小时`
  }

  // 从字符串中提取百分比数字，用于进度条
  const extractPercent = (str: string): number => {
    const match = str.match(/(\d+(?:\.\d+)?)\s*%/)
    return match ? parseFloat(match[1]) : 0
  }

  const getStatusColor = (percent: number): string => {
    if (percent >= 90) return 'text-red-500'
    if (percent >= 70) return 'text-yellow-500'
    return 'text-green-500'
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">系统监控</h2>
          <p className="text-sm text-muted-foreground">实时监控系统状态</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant={autoRefresh ? 'default' : 'outline'}
            size="sm"
            onClick={() => setAutoRefresh(!autoRefresh)}
          >
            {autoRefresh ? '停止' : '自动'}刷新
          </Button>
          <Button variant="outline" size="sm" onClick={loadStatus}>
            <RefreshCw className="h-4 w-4 mr-1" />
            刷新
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <>
          {/* 服务状态 */}
          <div className="grid gap-4 md:grid-cols-3">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium">API 服务</CardTitle>
                <Server className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <Badge variant="success">运行中</Badge>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium">服务器状态</CardTitle>
                <Wifi className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <Badge variant={status.idle === '活跃' ? 'success' : 'secondary'}>
                  {status.idle}
                </Badge>
                {status.idleTime > 0 && (
                  <p className="text-xs text-muted-foreground mt-1">
                    空闲 {formatIdleTime(status.idleTime)}
                  </p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium">进程 ID</CardTitle>
                <Database className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{status.pid}</div>
              </CardContent>
            </Card>
          </div>

          {/* 系统资源 */}
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium">CPU 使用率</CardTitle>
                <Cpu className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className={`text-2xl font-bold ${getStatusColor(extractPercent(status.cpu))}`}>
                  {status.cpu}
                </div>
                <div className="mt-2 h-2 bg-muted rounded-full overflow-hidden">
                  <div
                    className={`h-full transition-all ${
                      extractPercent(status.cpu) >= 90
                        ? 'bg-red-500'
                        : extractPercent(status.cpu) >= 70
                        ? 'bg-yellow-500'
                        : 'bg-green-500'
                    }`}
                    style={{ width: `${Math.min(extractPercent(status.cpu), 100)}%` }}
                  />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium">进程内存</CardTitle>
                <MemoryStick className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{status.memory}</div>
                <p className="text-xs text-muted-foreground mt-1">Node.js 堆内存</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium">系统内存</CardTitle>
                <HardDrive className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{status.systemMemory}</div>
                <p className="text-xs text-muted-foreground mt-1">已用 / 总量</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium">运行时长</CardTitle>
                <Clock className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{status.uptime}</div>
                <p className="text-xs text-muted-foreground mt-1">
                  Node.js {status.nodeVersion}
                </p>
              </CardContent>
            </Card>
          </div>

          {/* 业务统计 */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Activity className="h-5 w-5" />
                业务统计
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 md:grid-cols-4">
                <div className="p-4 border rounded-lg">
                  <p className="text-sm text-muted-foreground">总请求数</p>
                  <p className="text-2xl font-bold">{status.requests}</p>
                </div>
                <div className="p-4 border rounded-lg">
                  <p className="text-sm text-muted-foreground">Token 总数</p>
                  <p className="text-2xl font-bold">{tokenStats.total}</p>
                </div>
                <div className="p-4 border rounded-lg">
                  <p className="text-sm text-muted-foreground">活跃 Token</p>
                  <p className="text-2xl font-bold">{tokenStats.enabled}</p>
                </div>
                <div className="p-4 border rounded-lg">
                  <p className="text-sm text-muted-foreground">API 密钥数</p>
                  <p className="text-2xl font-bold">{keyStats.total}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* 系统信息 */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Server className="h-5 w-5" />
                系统信息
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <div className="flex justify-between">
                    <span className="text-sm text-muted-foreground">平台</span>
                    <span className="text-sm font-medium">{status.platform}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm text-muted-foreground">进程 ID</span>
                    <span className="text-sm font-medium">{status.pid}</span>
                  </div>
                </div>
                <div className="space-y-2">
                  <div className="flex justify-between">
                    <span className="text-sm text-muted-foreground">Node.js 版本</span>
                    <span className="text-sm font-medium">{status.nodeVersion}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm text-muted-foreground">运行时长</span>
                    <span className="text-sm font-medium">{status.uptime}</span>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}

