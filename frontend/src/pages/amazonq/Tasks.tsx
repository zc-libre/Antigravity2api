import { useEffect, useState, useRef, useCallback, useMemo } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
// ScrollArea 组件已被原生滚动替代，用于更好的滚动条控制
import { Progress } from '@/components/ui/progress'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { amazonqApi } from '@/services/api'
import {
  ListTodo,
  Plus,
  RefreshCw,
  Loader2,
  CheckCircle,
  XCircle,
  Clock,
  Trash2,
  AlertCircle,
  Terminal,
  Rocket,
  Zap,
  Activity,
  Timer,
  Hash,
  Tag,
  ChevronRight,
  Sparkles,
  Copy,
  Check,
  Search,
  CircleDot,
} from 'lucide-react'

interface Task {
  id: string
  status: 'pending' | 'running' | 'completed' | 'failed'
  createdAt: string
  completedAt?: string
  label?: string
  email?: string
  error?: string
}

interface LogEntry {
  timestamp: string
  level: 'info' | 'warn' | 'error' | 'debug'
  message: string
  context?: unknown
}

interface TaskProgress {
  step: string
  percent: number
}

type FilterStatus = 'all' | 'pending' | 'running' | 'completed' | 'failed'

export function AmazonQTasks() {
  const [tasks, setTasks] = useState<Task[]>([])
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [taskToDelete, setTaskToDelete] = useState<string | null>(null)
  const [filterStatus, setFilterStatus] = useState<FilterStatus>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [showCreateForm, setShowCreateForm] = useState(false)

  // 日志查看器
  const [logDialogOpen, setLogDialogOpen] = useState(false)
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null)
  const [taskLogs, setTaskLogs] = useState<LogEntry[]>([])
  const [taskProgress, setTaskProgress] = useState<TaskProgress | null>(null)
  const [taskStatus, setTaskStatus] = useState<string>('')
  const eventSourceRef = useRef<EventSource | null>(null)
  const logContainerRef = useRef<HTMLDivElement>(null)

  // 创建任务表单
  const [taskForm, setTaskForm] = useState({
    label: '',
    password: '',
    fullName: '',
    headless: true,
    maxRetries: 3,
  })

  useEffect(() => {
    loadTasks()
    const interval = setInterval(loadTasks, 5000)
    return () => clearInterval(interval)
  }, [])

  // 清理 SSE 连接
  useEffect(() => {
    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close()
      }
    }
  }, [])

  // 自动滚动到日志底部
  useEffect(() => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight
    }
  }, [taskLogs])

  // 计算统计数据
  const stats = useMemo(() => {
    const total = tasks.length
    const pending = tasks.filter(t => t.status === 'pending').length
    const running = tasks.filter(t => t.status === 'running').length
    const completed = tasks.filter(t => t.status === 'completed').length
    const failed = tasks.filter(t => t.status === 'failed').length
    const successRate = total > 0 ? Math.round((completed / total) * 100) : 0
    return { total, pending, running, completed, failed, successRate }
  }, [tasks])

  // 过滤任务
  const filteredTasks = useMemo(() => {
    let result = [...tasks]

    // 搜索过滤
    if (searchQuery) {
      const query = searchQuery.toLowerCase()
      result = result.filter(
        t => t.id.toLowerCase().includes(query) ||
             t.label?.toLowerCase().includes(query) ||
             t.email?.toLowerCase().includes(query)
      )
    }

    // 状态过滤
    if (filterStatus !== 'all') {
      result = result.filter(t => t.status === filterStatus)
    }

    // 按创建时间倒序
    result.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())

    return result
  }, [tasks, searchQuery, filterStatus])

  // 订阅任务日志
  const subscribeToTaskLogs = useCallback((taskId: string) => {
    // 关闭之前的连接
    if (eventSourceRef.current) {
      eventSourceRef.current.close()
    }

    setTaskLogs([])
    setTaskProgress(null)
    setTaskStatus('')

    const eventSource = new EventSource(`/amazonq/api/register/${taskId}/logs`, {
      // @ts-ignore - EventSource doesn't have headers option in standard API
    })

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data)
        
        if (data.type === 'log') {
          setTaskLogs(prev => [...prev, data.data])
        } else if (data.type === 'progress') {
          setTaskProgress(data.data)
        } else if (data.type === 'status') {
          setTaskStatus(data.data.status)
          // 如果任务完成或失败，刷新任务列表
          if (data.data.status === 'completed' || data.data.status === 'failed') {
            loadTasks()
          }
        }
      } catch (e) {
        console.error('Failed to parse SSE message:', e)
      }
    }

    eventSource.onerror = () => {
      // 连接错误时，使用轮询方式获取日志
      eventSource.close()
      // 尝试一次性获取日志
      fetchTaskLogs(taskId)
    }

    eventSourceRef.current = eventSource
  }, [])

  // 备用：一次性获取任务日志
  const fetchTaskLogs = async (taskId: string) => {
    try {
      const res = await fetch(`/amazonq/api/register/${taskId}/logs`)
      if (res.ok) {
        const data = await res.json()
        if (data.success) {
          setTaskLogs(data.logs || [])
          setTaskProgress(data.progress || null)
          setTaskStatus(data.status || '')
        }
      }
    } catch (e) {
      console.error('Failed to fetch task logs:', e)
    }
  }

  // 打开日志查看器
  const openLogViewer = (taskId: string) => {
    setSelectedTaskId(taskId)
    setLogDialogOpen(true)
    subscribeToTaskLogs(taskId)
  }

  // 关闭日志查看器
  const closeLogViewer = () => {
    setLogDialogOpen(false)
    setSelectedTaskId(null)
    if (eventSourceRef.current) {
      eventSourceRef.current.close()
      eventSourceRef.current = null
    }
  }

  const loadTasks = async () => {
    try {
      const res = await amazonqApi.getTasks()
      if (res.success && res.data) {
        const data = res.data as { tasks?: Task[] }
        setTasks(data.tasks || [])
      }
    } catch (error) {
      console.error('Failed to load tasks:', error)
    } finally {
      setLoading(false)
    }
  }

  const createTask = async () => {
    setSubmitting(true)

    try {
      const res = await amazonqApi.createTask({
        label: taskForm.label || undefined,
        password: taskForm.password || undefined,
        fullName: taskForm.fullName || undefined,
        headless: taskForm.headless,
        maxRetries: taskForm.maxRetries,
      })

      if (res.success) {
        setTaskForm({
          label: '',
          password: '',
          fullName: '',
          headless: true,
          maxRetries: 3,
        })
        setShowCreateForm(false)
        loadTasks()
      }
    } catch (error) {
      console.error('Failed to create task:', error)
    } finally {
      setSubmitting(false)
    }
  }

  const cancelTask = async () => {
    if (!taskToDelete) return

    try {
      await amazonqApi.cancelTask(taskToDelete)
      loadTasks()
    } catch (error) {
      console.error('Failed to cancel task:', error)
    } finally {
      setDeleteDialogOpen(false)
      setTaskToDelete(null)
    }
  }

  const copyTaskId = async (id: string) => {
    try {
      await navigator.clipboard.writeText(id)
      setCopiedId(id)
      setTimeout(() => setCopiedId(null), 2000)
    } catch (error) {
      console.error('Failed to copy:', error)
    }
  }

  const formatDateShort = (dateStr?: string) => {
    if (!dateStr) return '-'
    const date = new Date(dateStr)
    const now = new Date()
    const diff = now.getTime() - date.getTime()
    const minutes = Math.floor(diff / (1000 * 60))
    const hours = Math.floor(diff / (1000 * 60 * 60))
    const days = Math.floor(diff / (1000 * 60 * 60 * 24))
    
    if (minutes < 1) return '刚刚'
    if (minutes < 60) return `${minutes}分钟前`
    if (hours < 24) return `${hours}小时前`
    if (days === 1) return '昨天'
    if (days < 7) return `${days}天前`
    return date.toLocaleDateString('zh-CN')
  }

  const getStatusConfig = (status: Task['status']) => {
    switch (status) {
      case 'pending':
        return {
          icon: <Clock className="h-3 w-3" />,
          label: '排队中',
          className: 'bg-slate-500/10 text-slate-500 border-slate-500/20',
        }
      case 'running':
        return {
          icon: <Loader2 className="h-3 w-3 animate-spin" />,
          label: '执行中',
          className: 'bg-blue-500/10 text-blue-500 border-blue-500/20',
        }
      case 'completed':
        return {
          icon: <CheckCircle className="h-3 w-3" />,
          label: '已完成',
          className: 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20',
        }
      case 'failed':
        return {
          icon: <XCircle className="h-3 w-3" />,
          label: '失败',
          className: 'bg-red-500/10 text-red-500 border-red-500/20',
        }
    }
  }

  const getStatusBadge = (status: Task['status']) => {
    const config = getStatusConfig(status)
    return (
      <Badge className={config.className}>
        {config.icon}
        <span className="ml-1">{config.label}</span>
      </Badge>
    )
  }

  return (
    <div className="space-y-6">
      {/* 统计卡片 */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
        <Card className="relative overflow-hidden border-blue-500/20 bg-gradient-to-br from-blue-500/5 via-transparent to-transparent">
          <div className="absolute top-0 right-0 w-32 h-32 bg-blue-500/10 rounded-full -translate-y-1/2 translate-x-1/2 blur-2xl" />
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">任务总数</CardTitle>
            <div className="p-2 rounded-lg bg-blue-500/10">
              <ListTodo className="h-4 w-4 text-blue-500" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold tracking-tight">{stats.total}</div>
            <p className="text-xs text-muted-foreground mt-1">所有注册任务</p>
          </CardContent>
        </Card>

        <Card className="relative overflow-hidden border-amber-500/20 bg-gradient-to-br from-amber-500/5 via-transparent to-transparent">
          <div className="absolute top-0 right-0 w-32 h-32 bg-amber-500/10 rounded-full -translate-y-1/2 translate-x-1/2 blur-2xl" />
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">排队中</CardTitle>
            <div className="p-2 rounded-lg bg-amber-500/10">
              <Timer className="h-4 w-4 text-amber-500" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold tracking-tight">{stats.pending}</div>
            <p className="text-xs text-muted-foreground mt-1">等待执行</p>
          </CardContent>
        </Card>

        <Card className="relative overflow-hidden border-cyan-500/20 bg-gradient-to-br from-cyan-500/5 via-transparent to-transparent">
          <div className="absolute top-0 right-0 w-32 h-32 bg-cyan-500/10 rounded-full -translate-y-1/2 translate-x-1/2 blur-2xl" />
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">执行中</CardTitle>
            <div className="p-2 rounded-lg bg-cyan-500/10">
              <Activity className="h-4 w-4 text-cyan-500" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold tracking-tight">{stats.running}</div>
            <p className="text-xs text-muted-foreground mt-1">正在处理</p>
          </CardContent>
        </Card>

        <Card className="relative overflow-hidden border-emerald-500/20 bg-gradient-to-br from-emerald-500/5 via-transparent to-transparent">
          <div className="absolute top-0 right-0 w-32 h-32 bg-emerald-500/10 rounded-full -translate-y-1/2 translate-x-1/2 blur-2xl" />
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">已完成</CardTitle>
            <div className="p-2 rounded-lg bg-emerald-500/10">
              <CheckCircle className="h-4 w-4 text-emerald-500" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold tracking-tight">{stats.completed}</div>
            <p className="text-xs text-muted-foreground mt-1">成功注册</p>
          </CardContent>
        </Card>

        <Card className="relative overflow-hidden border-rose-500/20 bg-gradient-to-br from-rose-500/5 via-transparent to-transparent">
          <div className="absolute top-0 right-0 w-32 h-32 bg-rose-500/10 rounded-full -translate-y-1/2 translate-x-1/2 blur-2xl" />
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">失败</CardTitle>
            <div className="p-2 rounded-lg bg-rose-500/10">
              <XCircle className="h-4 w-4 text-rose-500" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold tracking-tight">{stats.failed}</div>
            <p className="text-xs text-muted-foreground mt-1">
              成功率 {stats.successRate}%
            </p>
          </CardContent>
        </Card>
      </div>

      {/* 创建任务按钮/表单 */}
      <Card className="border-border/50">
        <CardHeader className="border-b border-border/50">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-gradient-to-br from-cyan-500 to-blue-500 shadow-lg shadow-cyan-500/20">
                <Rocket className="h-5 w-5 text-white" />
              </div>
              <div>
                <CardTitle className="text-lg">创建任务</CardTitle>
                <CardDescription>自动注册新的 AWS Builder ID 账号</CardDescription>
              </div>
            </div>
            <Button
              onClick={() => setShowCreateForm(!showCreateForm)}
              className={showCreateForm 
                ? "bg-muted hover:bg-muted/80 text-foreground" 
                : "bg-gradient-to-r from-cyan-500 to-blue-500 hover:from-cyan-600 hover:to-blue-600 shadow-lg shadow-cyan-500/20"
              }
            >
              {showCreateForm ? (
                <>收起</>
              ) : (
                <>
                  <Plus className="h-4 w-4 mr-1.5" />
                  新建任务
                </>
              )}
            </Button>
          </div>
        </CardHeader>

        {showCreateForm && (
          <CardContent className="pt-6">
            <div className="grid gap-6 md:grid-cols-2">
              <div className="space-y-2">
                <Label className="flex items-center gap-2 text-sm">
                  <Tag className="h-3.5 w-3.5 text-muted-foreground" />
                  任务标签
                </Label>
                <Input
                  value={taskForm.label}
                  onChange={(e) => setTaskForm({ ...taskForm, label: e.target.value })}
                  placeholder="例如: 批量注册-01"
                  className="bg-muted/50 border-border/50"
                />
                <p className="text-xs text-muted-foreground">用于标识和分组任务</p>
              </div>
              <div className="space-y-2">
                <Label className="flex items-center gap-2 text-sm">
                  <Hash className="h-3.5 w-3.5 text-muted-foreground" />
                  密码 (可选)
                </Label>
                <Input
                  type="password"
                  value={taskForm.password}
                  onChange={(e) => setTaskForm({ ...taskForm, password: e.target.value })}
                  placeholder="留空则自动生成强密码"
                  className="bg-muted/50 border-border/50"
                />
                <p className="text-xs text-muted-foreground">自定义账号密码</p>
              </div>
              <div className="space-y-2">
                <Label className="flex items-center gap-2 text-sm">
                  <Sparkles className="h-3.5 w-3.5 text-muted-foreground" />
                  全名 (可选)
                </Label>
                <Input
                  value={taskForm.fullName}
                  onChange={(e) => setTaskForm({ ...taskForm, fullName: e.target.value })}
                  placeholder="留空则随机生成"
                  className="bg-muted/50 border-border/50"
                />
                <p className="text-xs text-muted-foreground">AWS 账号显示名称</p>
              </div>
              <div className="space-y-2">
                <Label className="flex items-center gap-2 text-sm">
                  <RefreshCw className="h-3.5 w-3.5 text-muted-foreground" />
                  最大重试次数
                </Label>
                <Input
                  type="number"
                  value={taskForm.maxRetries}
                  onChange={(e) => setTaskForm({ ...taskForm, maxRetries: parseInt(e.target.value) || 3 })}
                  min={1}
                  max={10}
                  className="bg-muted/50 border-border/50"
                />
                <p className="text-xs text-muted-foreground">失败时自动重试次数</p>
              </div>
            </div>

            <div className="flex items-center justify-between mt-6 pt-6 border-t border-border/50">
              <div className="flex items-center gap-3 p-3 rounded-xl bg-muted/50">
                <Switch
                  id="headless"
                  checked={taskForm.headless}
                  onCheckedChange={(checked) => setTaskForm({ ...taskForm, headless: checked })}
                />
                <div>
                  <Label htmlFor="headless" className="text-sm font-medium cursor-pointer">
                    无头模式
                  </Label>
                  <p className="text-xs text-muted-foreground">隐藏浏览器窗口，后台运行</p>
                </div>
              </div>

              <Button
                onClick={createTask}
                disabled={submitting}
                size="lg"
                className="bg-gradient-to-r from-cyan-500 to-blue-500 hover:from-cyan-600 hover:to-blue-600 shadow-lg shadow-cyan-500/20"
              >
                {submitting ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : (
                  <Zap className="h-4 w-4 mr-2" />
                )}
                开始注册
              </Button>
            </div>
          </CardContent>
        )}
      </Card>

      {/* 任务列表 */}
      <Card className="border-border/50">
        <CardHeader className="border-b border-border/50">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-gradient-to-br from-amber-500 to-orange-500 shadow-lg shadow-amber-500/20">
                <ListTodo className="h-5 w-5 text-white" />
              </div>
              <div>
                <CardTitle className="text-lg">任务列表</CardTitle>
                <CardDescription>管理所有注册任务</CardDescription>
              </div>
            </div>
            <Button variant="outline" size="sm" onClick={loadTasks}>
              <RefreshCw className={`h-4 w-4 mr-1.5 ${loading ? 'animate-spin' : ''}`} />
              刷新
            </Button>
          </div>

          {/* 搜索和过滤栏 */}
          <div className="flex flex-col gap-3 mt-4 md:flex-row md:items-center">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="搜索任务ID、标签或邮箱..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9 bg-muted/50 border-border/50"
              />
            </div>
            <Tabs
              value={filterStatus}
              onValueChange={(v) => setFilterStatus(v as FilterStatus)}
              className="w-auto"
            >
              <TabsList className="bg-muted/50 h-9">
                <TabsTrigger value="all" className="text-xs px-3 h-7">
                  全部
                </TabsTrigger>
                <TabsTrigger value="running" className="text-xs px-3 h-7">
                  <CircleDot className="h-3 w-3 mr-1 text-blue-500" />
                  执行中
                </TabsTrigger>
                <TabsTrigger value="completed" className="text-xs px-3 h-7">
                  <CheckCircle className="h-3 w-3 mr-1 text-emerald-500" />
                  完成
                </TabsTrigger>
                <TabsTrigger value="failed" className="text-xs px-3 h-7">
                  <XCircle className="h-3 w-3 mr-1 text-red-500" />
                  失败
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
        </CardHeader>

        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <div className="flex flex-col items-center gap-3">
                <Loader2 className="h-8 w-8 animate-spin text-cyan-500" />
                <p className="text-sm text-muted-foreground">加载任务列表...</p>
              </div>
            </div>
          ) : filteredTasks.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <div className="p-4 rounded-full bg-muted/50 mb-4">
                <ListTodo className="h-8 w-8 text-muted-foreground" />
              </div>
              <h3 className="font-medium mb-1">
                {tasks.length === 0 ? '暂无任务' : '没有匹配的任务'}
              </h3>
              <p className="text-sm text-muted-foreground max-w-sm">
                {tasks.length === 0
                  ? '点击上方"新建任务"按钮创建第一个注册任务'
                  : '尝试调整搜索条件或过滤器'}
              </p>
              {tasks.length === 0 && (
                <Button
                  onClick={() => setShowCreateForm(true)}
                  className="mt-4 bg-gradient-to-r from-cyan-500 to-blue-500"
                >
                  <Plus className="h-4 w-4 mr-1.5" />
                  创建任务
                </Button>
              )}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent border-border/50">
                    <TableHead className="w-[180px]">任务 ID</TableHead>
                    <TableHead className="w-[100px]">标签</TableHead>
                    <TableHead className="w-[100px]">状态</TableHead>
                    <TableHead className="w-[200px]">结果</TableHead>
                    <TableHead className="w-[120px]">创建时间</TableHead>
                    <TableHead className="w-[120px]">耗时</TableHead>
                    <TableHead className="text-right w-[100px]">操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredTasks.map((task) => {
                    const statusConfig = getStatusConfig(task.status)
                    const duration = task.completedAt && task.createdAt
                      ? Math.round((new Date(task.completedAt).getTime() - new Date(task.createdAt).getTime()) / 1000)
                      : null

                    return (
                      <TableRow
                        key={task.id}
                        className="group border-border/50 hover:bg-muted/30 transition-colors"
                      >
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
                                    onClick={() => copyTaskId(task.id)}
                                  >
                                    {copiedId === task.id ? (
                                      <Check className="h-3 w-3 text-emerald-500" />
                                    ) : (
                                      <Copy className="h-3 w-3 text-muted-foreground" />
                                    )}
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>复制完整ID</TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                            <code className="font-mono text-xs bg-muted/50 px-2 py-1 rounded">
                              {task.id.slice(0, 8)}...
                            </code>
                          </div>
                        </TableCell>
                        <TableCell>
                          {task.label ? (
                            <Badge variant="outline" className="font-normal">
                              {task.label}
                            </Badge>
                          ) : (
                            <span className="text-muted-foreground text-sm">-</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <Badge className={statusConfig.className}>
                            {statusConfig.icon}
                            <span className="ml-1">{statusConfig.label}</span>
                          </Badge>
                        </TableCell>
                        <TableCell>
                          {task.status === 'completed' && task.email ? (
                            <div className="flex items-center gap-2">
                              <CheckCircle className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                              <span className="text-sm font-mono truncate max-w-[160px]">
                                {task.email}
                              </span>
                            </div>
                          ) : task.status === 'failed' && task.error ? (
                            <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <div className="flex items-center gap-2 text-red-500 cursor-help">
                                    <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                                    <span className="text-sm truncate max-w-[160px]">
                                      {task.error}
                                    </span>
                                  </div>
                                </TooltipTrigger>
                                <TooltipContent className="max-w-sm">
                                  {task.error}
                                </TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          ) : task.status === 'running' ? (
                            <div className="flex items-center gap-2 text-blue-500">
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              <span className="text-sm">处理中...</span>
                            </div>
                          ) : (
                            <span className="text-muted-foreground text-sm">-</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                            <Clock className="h-3.5 w-3.5" />
                            {formatDateShort(task.createdAt)}
                          </div>
                        </TableCell>
                        <TableCell>
                          {duration !== null ? (
                            <div className="flex items-center gap-1.5 text-sm">
                              <Timer className="h-3.5 w-3.5 text-muted-foreground" />
                              {duration < 60 
                                ? `${duration}秒` 
                                : `${Math.floor(duration / 60)}分${duration % 60}秒`}
                            </div>
                          ) : task.status === 'running' ? (
                            <span className="text-sm text-blue-500">进行中...</span>
                          ) : (
                            <span className="text-muted-foreground text-sm">-</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-1">
                            <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-8 w-8"
                                    onClick={() => openLogViewer(task.id)}
                                  >
                                    <Terminal className="h-4 w-4" />
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>查看日志</TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                            {(task.status === 'pending' || task.status === 'running') && (
                              <TooltipProvider>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className="h-8 w-8 text-red-500 hover:text-red-600 hover:bg-red-500/10"
                                      onClick={() => {
                                        setTaskToDelete(task.id)
                                        setDeleteDialogOpen(true)
                                      }}
                                    >
                                      <Trash2 className="h-4 w-4" />
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent>取消任务</TooltipContent>
                                </Tooltip>
                              </TooltipProvider>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>

        {/* 底部统计 */}
        {filteredTasks.length > 0 && (
          <div className="px-6 py-3 border-t border-border/50 bg-muted/30">
            <p className="text-xs text-muted-foreground">
              显示 {filteredTasks.length} 个任务
              {filteredTasks.length !== tasks.length && ` (共 ${tasks.length} 个)`}
            </p>
          </div>
        )}
      </Card>

      {/* 取消确认对话框 */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <div className="flex items-center gap-3 mb-2">
              <div className="p-2.5 rounded-xl bg-red-500/10">
                <AlertCircle className="h-5 w-5 text-red-500" />
              </div>
              <DialogTitle>确认取消任务</DialogTitle>
            </div>
            <DialogDescription>
              确定要取消这个任务吗？此操作无法撤销，任务将被终止。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setDeleteDialogOpen(false)}>
              返回
            </Button>
            <Button variant="destructive" onClick={cancelTask}>
              <Trash2 className="h-4 w-4 mr-1.5" />
              取消任务
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 日志查看器对话框 */}
      <Dialog open={logDialogOpen} onOpenChange={(open) => !open && closeLogViewer()}>
        <DialogContent className="max-w-5xl max-h-[90vh] flex flex-col p-0 gap-0 overflow-hidden">
          {/* 头部 */}
          <DialogHeader className="border-b border-border/50 px-6 py-4 shrink-0">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-gradient-to-br from-violet-500 to-purple-500 shadow-lg shadow-violet-500/20">
                <Terminal className="h-5 w-5 text-white" />
              </div>
              <div className="flex-1">
                <DialogTitle className="text-lg flex items-center gap-2">
                  任务日志
                  {taskStatus && (
                    <span className="ml-2">{getStatusBadge(taskStatus as Task['status'])}</span>
                  )}
                </DialogTitle>
                <DialogDescription className="font-mono text-xs mt-0.5">
                  ID: {selectedTaskId}
                </DialogDescription>
              </div>
              <div className="flex items-center gap-2">
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8"
                        onClick={() => {
                          const logText = taskLogs.map((log, i) => 
                            `[${String(i + 1).padStart(3, '0')}] ${new Date(log.timestamp).toLocaleTimeString('zh-CN', { hour12: false })} [${log.level.toUpperCase().padEnd(5)}] ${log.message}`
                          ).join('\n')
                          navigator.clipboard.writeText(logText)
                        }}
                        disabled={taskLogs.length === 0}
                      >
                        <Copy className="h-3.5 w-3.5 mr-1.5" />
                        复制日志
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>复制所有日志到剪贴板</TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
            </div>
          </DialogHeader>
          
          {/* 进度条 */}
          {taskProgress && (
            <div className="space-y-2 py-4 px-6 border-b border-border/50 bg-muted/30 shrink-0">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground flex items-center gap-2">
                  <ChevronRight className="h-4 w-4 text-cyan-500" />
                  {taskProgress.step}
                </span>
                <span className="font-mono font-medium">{taskProgress.percent}%</span>
              </div>
              <Progress value={taskProgress.percent} className="h-2" />
            </div>
          )}
          
          {/* 日志统计栏 */}
          {taskLogs.length > 0 && (
            <div className="flex items-center gap-4 px-6 py-2 border-b border-border/50 bg-muted/20 text-xs shrink-0">
              <span className="text-muted-foreground">
                共 <span className="font-mono font-medium text-foreground">{taskLogs.length}</span> 条日志
              </span>
              <span className="text-blue-400 flex items-center gap-1">
                <div className="w-2 h-2 rounded-full bg-blue-400/50" />
                INFO: {taskLogs.filter(l => l.level === 'info').length}
              </span>
              <span className="text-yellow-400 flex items-center gap-1">
                <div className="w-2 h-2 rounded-full bg-yellow-400/50" />
                WARN: {taskLogs.filter(l => l.level === 'warn').length}
              </span>
              <span className="text-red-400 flex items-center gap-1">
                <div className="w-2 h-2 rounded-full bg-red-400/50" />
                ERROR: {taskLogs.filter(l => l.level === 'error').length}
              </span>
              <span className="text-slate-500 flex items-center gap-1">
                <div className="w-2 h-2 rounded-full bg-slate-500/50" />
                DEBUG: {taskLogs.filter(l => l.level === 'debug').length}
              </span>
            </div>
          )}
          
          {/* 日志列表 - 使用原生滚动 */}
          <div 
            ref={logContainerRef}
            className="flex-1 min-h-[350px] max-h-[500px] overflow-y-auto overflow-x-hidden bg-[#0a0e14] custom-scrollbar"
            style={{
              scrollbarWidth: 'thin',
              scrollbarColor: '#4b5563 #1f2937'
            }}
          >
            <div className="p-4 font-mono text-[13px] leading-relaxed">
              {taskLogs.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-center">
                  <div className="p-4 rounded-full bg-slate-800/50 mb-4">
                    <Loader2 className="h-8 w-8 animate-spin text-slate-500" />
                  </div>
                  <p className="text-slate-500">
                    {taskStatus === 'pending' ? '任务排队中，等待执行...' : '正在加载日志...'}
                  </p>
                </div>
              ) : (
                <div className="space-y-0">
                  {taskLogs.map((log, index) => (
                    <div
                      key={index}
                      className={`flex items-start gap-3 py-1.5 px-2 -mx-2 rounded transition-colors hover:bg-slate-800/50 ${
                        log.level === 'error' ? 'bg-red-500/5' :
                        log.level === 'warn' ? 'bg-yellow-500/5' : ''
                      }`}
                    >
                      {/* 行号 */}
                      <span className="text-slate-600 shrink-0 w-8 text-right tabular-nums select-none">
                        {String(index + 1).padStart(3, '0')}
                      </span>
                      
                      {/* 分隔线 */}
                      <div className="w-px h-5 bg-slate-700/50 shrink-0" />
                      
                      {/* 时间戳 */}
                      <span className="text-slate-500 shrink-0 tabular-nums w-[72px]">
                        {new Date(log.timestamp).toLocaleTimeString('zh-CN', { hour12: false })}
                      </span>
                      
                      {/* 日志级别 */}
                      <span className={`shrink-0 w-14 text-center text-[11px] py-0.5 rounded font-bold tracking-wider ${
                        log.level === 'error' ? 'bg-red-500/20 text-red-400 ring-1 ring-red-500/30' :
                        log.level === 'warn' ? 'bg-yellow-500/20 text-yellow-400 ring-1 ring-yellow-500/30' :
                        log.level === 'debug' ? 'bg-slate-700/50 text-slate-500' :
                        'bg-cyan-500/20 text-cyan-400'
                      }`}>
                        {log.level.toUpperCase()}
                      </span>
                      
                      {/* 日志消息 */}
                      <span className={`flex-1 break-all ${
                        log.level === 'error' ? 'text-red-300' :
                        log.level === 'warn' ? 'text-yellow-300' :
                        log.level === 'debug' ? 'text-slate-500' :
                        'text-slate-200'
                      }`}>
                        {log.message}
                        {log.context != null && (
                          <span className="ml-2 text-slate-600">
                            {typeof log.context === 'object' 
                              ? JSON.stringify(log.context) 
                              : String(log.context as string | number | boolean)}
                          </span>
                        )}
                      </span>
                    </div>
                  ))}
                  
                  {/* 等待更多日志的提示 */}
                  {(taskStatus === 'running' || taskStatus === 'pending') && taskLogs.length > 0 && (
                    <div className="flex items-center gap-2 text-slate-600 pt-4 pl-12 border-t border-slate-800 mt-4">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      <span className="text-sm">实时监听中，等待更多日志...</span>
                    </div>
                  )}
                  
                  {/* 任务完成提示 */}
                  {(taskStatus === 'completed' || taskStatus === 'failed') && taskLogs.length > 0 && (
                    <div className={`flex items-center gap-2 pt-4 pl-12 border-t border-slate-800 mt-4 ${
                      taskStatus === 'completed' ? 'text-emerald-500' : 'text-red-500'
                    }`}>
                      {taskStatus === 'completed' ? (
                        <>
                          <CheckCircle className="h-3.5 w-3.5" />
                          <span className="text-sm">任务已完成</span>
                        </>
                      ) : (
                        <>
                          <XCircle className="h-3.5 w-3.5" />
                          <span className="text-sm">任务执行失败</span>
                        </>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
          
          {/* 底部操作栏 */}
          <DialogFooter className="px-6 py-4 border-t border-border/50 bg-muted/30 shrink-0">
            <div className="flex items-center justify-between w-full">
              <p className="text-xs text-muted-foreground">
                提示：日志实时更新，任务完成后可复制完整日志
              </p>
              <div className="flex items-center gap-2">
                <Button 
                  variant="outline" 
                  size="sm"
                  onClick={() => selectedTaskId && fetchTaskLogs(selectedTaskId)}
                >
                  <RefreshCw className="h-4 w-4 mr-1.5" />
                  刷新
                </Button>
                <Button variant="outline" size="sm" onClick={closeLogViewer}>
                  关闭
                </Button>
              </div>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
