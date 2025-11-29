import { useEffect, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { amazonqApi } from '@/services/api'
import {
  Cloud,
  Users,
  ListTodo,
  Activity,
  RefreshCw,
  Loader2,
  CheckCircle,
  XCircle,
  Clock,
} from 'lucide-react'

interface HealthStatus {
  status: string
  timestamp: string
  runningTask: string | null
  queueLength: number
}

interface Stats {
  accountCount: number
  taskCount: number
  runningTask: string | null
  queueLength: number
  completedTasks: number
  failedTasks: number
}

export function AmazonQDashboard() {
  const [health, setHealth] = useState<HealthStatus | null>(null)
  const [stats, setStats] = useState<Stats>({
    accountCount: 0,
    taskCount: 0,
    runningTask: null,
    queueLength: 0,
    completedTasks: 0,
    failedTasks: 0,
  })
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadData()
    const interval = setInterval(loadData, 10000)
    return () => clearInterval(interval)
  }, [])

  const loadData = async () => {
    try {
      const [healthRes, accountsRes, tasksRes] = await Promise.all([
        amazonqApi.getHealth(),
        amazonqApi.getAccounts(),
        amazonqApi.getTasks(),
      ])

      if (healthRes.success && healthRes.data) {
        setHealth(healthRes.data as HealthStatus)
      }

      let accountCount = 0
      if (accountsRes.success && accountsRes.data) {
        const data = accountsRes.data as { total?: number }
        accountCount = data.total || 0
      }

      if (tasksRes.success && tasksRes.data) {
        const data = tasksRes.data as {
          total?: number
          running?: string | null
          queueLength?: number
          tasks?: Array<{ status: string }>
        }
        const tasks = data.tasks || []
        setStats({
          accountCount,
          taskCount: data.total || 0,
          runningTask: data.running || null,
          queueLength: data.queueLength || 0,
          completedTasks: tasks.filter(t => t.status === 'completed').length,
          failedTasks: tasks.filter(t => t.status === 'failed').length,
        })
      }
    } catch (error) {
      console.error('Failed to load data:', error)
    } finally {
      setLoading(false)
    }
  }

  const getStatusBadge = (status: string | null) => {
    if (status === 'ok') {
      return <Badge variant="success"><CheckCircle className="h-3 w-3 mr-1" />运行中</Badge>
    }
    return <Badge variant="destructive"><XCircle className="h-3 w-3 mr-1" />离线</Badge>
  }

  return (
    <div className="space-y-6">
      {/* 状态卡片 */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card className="bg-gradient-to-br from-cyan-500/10 to-blue-500/10 border-cyan-500/20">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">服务状态</CardTitle>
            <Cloud className="h-4 w-4 text-cyan-500" />
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                getStatusBadge(health?.status || null)
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Amazon Q 注册服务
            </p>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-green-500/10 to-emerald-500/10 border-green-500/20">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">已注册账号</CardTitle>
            <Users className="h-4 w-4 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.accountCount}</div>
            <p className="text-xs text-muted-foreground">
              可用的 Amazon Q 账号
            </p>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-amber-500/10 to-orange-500/10 border-amber-500/20">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">任务队列</CardTitle>
            <ListTodo className="h-4 w-4 text-amber-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.queueLength}</div>
            <p className="text-xs text-muted-foreground">
              等待中的任务
            </p>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-violet-500/10 to-purple-500/10 border-violet-500/20">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">任务统计</CardTitle>
            <Activity className="h-4 w-4 text-violet-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.taskCount}</div>
            <p className="text-xs text-muted-foreground">
              成功: {stats.completedTasks} · 失败: {stats.failedTasks}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* 当前任务状态 */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-gradient-to-br from-cyan-500 to-blue-500">
                <Clock className="h-5 w-5 text-white" />
              </div>
              <div>
                <CardTitle className="text-base">当前任务</CardTitle>
                <CardDescription>正在执行的注册任务</CardDescription>
              </div>
            </div>
            <Button variant="outline" size="sm" onClick={loadData}>
              <RefreshCw className="h-4 w-4 mr-1" />
              刷新
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : stats.runningTask ? (
            <div className="flex items-center gap-4 p-4 rounded-lg border bg-muted/50">
              <Loader2 className="h-6 w-6 animate-spin text-cyan-500" />
              <div>
                <p className="font-medium">任务执行中</p>
                <p className="text-sm text-muted-foreground">ID: {stats.runningTask}</p>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-4 p-4 rounded-lg border">
              <CheckCircle className="h-6 w-6 text-green-500" />
              <div>
                <p className="font-medium">空闲</p>
                <p className="text-sm text-muted-foreground">没有正在执行的任务</p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* API 信息 */}
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
                <code className="text-sm">/amazonq/api/accounts</code>
                <p className="text-xs text-muted-foreground">获取账号列表</p>
              </div>
            </div>
            <div className="flex items-center gap-3 p-3 rounded-lg border">
              <Badge className="bg-blue-500">POST</Badge>
              <div>
                <code className="text-sm">/amazonq/api/register</code>
                <p className="text-xs text-muted-foreground">创建注册任务</p>
              </div>
            </div>
            <div className="flex items-center gap-3 p-3 rounded-lg border">
              <Badge className="bg-green-500">GET</Badge>
              <div>
                <code className="text-sm">/amazonq/api/tasks</code>
                <p className="text-xs text-muted-foreground">查看任务列表</p>
              </div>
            </div>
          </div>
          <div className="mt-4 p-3 rounded-lg bg-muted">
            <span className="font-medium">基础 URL:</span>
            <code className="ml-2">{window.location.origin}/amazonq/api</code>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

