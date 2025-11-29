import { useEffect, useState, useRef, useCallback } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Progress } from '@/components/ui/progress'
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
import { amazonqApi } from '@/services/api'
import {
  ListTodo,
  Plus,
  RefreshCw,
  Loader2,
  CheckCircle,
  XCircle,
  Clock,
  Play,
  Trash2,
  AlertCircle,
  Terminal,
  Eye,
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

export function AmazonQTasks() {
  const [tasks, setTasks] = useState<Task[]>([])
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [taskToDelete, setTaskToDelete] = useState<string | null>(null)

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
    setMessage(null)

    try {
      const res = await amazonqApi.createTask({
        label: taskForm.label || undefined,
        password: taskForm.password || undefined,
        fullName: taskForm.fullName || undefined,
        headless: taskForm.headless,
        maxRetries: taskForm.maxRetries,
      })

      if (res.success) {
        setMessage({ type: 'success', text: '注册任务已创建' })
        setTaskForm({
          label: '',
          password: '',
          fullName: '',
          headless: true,
          maxRetries: 3,
        })
        loadTasks()
      } else {
        setMessage({ type: 'error', text: res.error || '创建任务失败' })
      }
    } catch (error) {
      setMessage({ type: 'error', text: '创建任务失败' })
    } finally {
      setSubmitting(false)
    }
  }

  const cancelTask = async () => {
    if (!taskToDelete) return

    try {
      const res = await amazonqApi.cancelTask(taskToDelete)
      if (res.success) {
        setMessage({ type: 'success', text: '任务已取消' })
        loadTasks()
      } else {
        setMessage({ type: 'error', text: res.error || '取消任务失败' })
      }
    } catch (error) {
      setMessage({ type: 'error', text: '取消任务失败' })
    } finally {
      setDeleteDialogOpen(false)
      setTaskToDelete(null)
    }
  }

  const formatDate = (dateStr?: string) => {
    if (!dateStr) return '-'
    return new Date(dateStr).toLocaleString('zh-CN')
  }

  const getStatusBadge = (status: Task['status']) => {
    switch (status) {
      case 'pending':
        return (
          <Badge variant="secondary">
            <Clock className="h-3 w-3 mr-1" />
            等待中
          </Badge>
        )
      case 'running':
        return (
          <Badge variant="default" className="bg-blue-500">
            <Play className="h-3 w-3 mr-1" />
            执行中
          </Badge>
        )
      case 'completed':
        return (
          <Badge variant="success">
            <CheckCircle className="h-3 w-3 mr-1" />
            已完成
          </Badge>
        )
      case 'failed':
        return (
          <Badge variant="destructive">
            <XCircle className="h-3 w-3 mr-1" />
            失败
          </Badge>
        )
    }
  }

  return (
    <div className="space-y-6">
      {message && (
        <Alert variant={message.type === 'error' ? 'destructive' : 'default'}>
          <AlertDescription>{message.text}</AlertDescription>
        </Alert>
      )}

      {/* 创建任务 */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-gradient-to-br from-cyan-500 to-blue-500">
              <Plus className="h-5 w-5 text-white" />
            </div>
            <div>
              <CardTitle className="text-base">创建注册任务</CardTitle>
              <CardDescription>自动注册新的 AWS Builder ID 账号</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label>任务标签</Label>
              <Input
                value={taskForm.label}
                onChange={(e) => setTaskForm({ ...taskForm, label: e.target.value })}
                placeholder="例如: 批量注册-01"
              />
              <p className="text-xs text-muted-foreground">用于标识此任务的标签</p>
            </div>
            <div className="space-y-2">
              <Label>密码 (可选)</Label>
              <Input
                type="password"
                value={taskForm.password}
                onChange={(e) => setTaskForm({ ...taskForm, password: e.target.value })}
                placeholder="留空则自动生成"
              />
              <p className="text-xs text-muted-foreground">账号密码，留空自动生成</p>
            </div>
            <div className="space-y-2">
              <Label>全名 (可选)</Label>
              <Input
                value={taskForm.fullName}
                onChange={(e) => setTaskForm({ ...taskForm, fullName: e.target.value })}
                placeholder="留空则随机生成"
              />
              <p className="text-xs text-muted-foreground">AWS 账号全名</p>
            </div>
            <div className="space-y-2">
              <Label>最大重试次数</Label>
              <Input
                type="number"
                value={taskForm.maxRetries}
                onChange={(e) => setTaskForm({ ...taskForm, maxRetries: parseInt(e.target.value) || 3 })}
                min={1}
                max={10}
              />
              <p className="text-xs text-muted-foreground">注册失败时的重试次数</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex items-center space-x-2">
              <Switch
                id="headless"
                checked={taskForm.headless}
                onCheckedChange={(checked) => setTaskForm({ ...taskForm, headless: checked })}
              />
              <Label htmlFor="headless">无头模式</Label>
            </div>
            <p className="text-xs text-muted-foreground">启用无头模式不显示浏览器窗口</p>
          </div>
          <Button onClick={createTask} disabled={submitting} className="bg-cyan-600 hover:bg-cyan-700">
            {submitting ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : (
              <Plus className="h-4 w-4 mr-2" />
            )}
            创建任务
          </Button>
        </CardContent>
      </Card>

      {/* 任务列表 */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-gradient-to-br from-amber-500 to-orange-500">
                <ListTodo className="h-5 w-5 text-white" />
              </div>
              <div>
                <CardTitle className="text-base">任务列表</CardTitle>
                <CardDescription>所有注册任务的状态</CardDescription>
              </div>
            </div>
            <Button variant="outline" size="sm" onClick={loadTasks}>
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
          ) : tasks.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              暂无任务，请创建注册任务
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>任务 ID</TableHead>
                  <TableHead>标签</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead>结果</TableHead>
                  <TableHead>创建时间</TableHead>
                  <TableHead>完成时间</TableHead>
                  <TableHead className="text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tasks.map((task) => (
                  <TableRow key={task.id}>
                    <TableCell className="font-mono text-xs">
                      {task.id.slice(0, 8)}...
                    </TableCell>
                    <TableCell>
                      {task.label ? (
                        <Badge variant="outline">{task.label}</Badge>
                      ) : (
                        '-'
                      )}
                    </TableCell>
                    <TableCell>{getStatusBadge(task.status)}</TableCell>
                    <TableCell>
                      {task.status === 'completed' && task.email ? (
                        <span className="text-sm font-mono">{task.email}</span>
                      ) : task.status === 'failed' && task.error ? (
                        <span className="text-sm text-destructive flex items-center gap-1">
                          <AlertCircle className="h-3 w-3" />
                          {task.error.slice(0, 30)}...
                        </span>
                      ) : (
                        '-'
                      )}
                    </TableCell>
                    <TableCell className="text-sm">
                      {formatDate(task.createdAt)}
                    </TableCell>
                    <TableCell className="text-sm">
                      {formatDate(task.completedAt)}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => openLogViewer(task.id)}
                          title="查看日志"
                        >
                          <Eye className="h-4 w-4" />
                        </Button>
                        {task.status === 'pending' && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="text-destructive hover:text-destructive"
                            onClick={() => {
                              setTaskToDelete(task.id)
                              setDeleteDialogOpen(true)
                            }}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* 取消确认对话框 */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>确认取消</DialogTitle>
            <DialogDescription>
              确定要取消这个任务吗？此操作无法撤销。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteDialogOpen(false)}>
              返回
            </Button>
            <Button variant="destructive" onClick={cancelTask}>
              取消任务
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 日志查看器对话框 */}
      <Dialog open={logDialogOpen} onOpenChange={(open) => !open && closeLogViewer()}>
        <DialogContent className="max-w-3xl max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Terminal className="h-5 w-5" />
              任务日志
            </DialogTitle>
            <DialogDescription>
              任务 ID: {selectedTaskId?.slice(0, 8)}...
              {taskStatus && (
                <span className="ml-2">
                  状态: {getStatusBadge(taskStatus as Task['status'])}
                </span>
              )}
            </DialogDescription>
          </DialogHeader>
          
          {/* 进度条 */}
          {taskProgress && (
            <div className="space-y-2 py-2">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">{taskProgress.step}</span>
                <span className="font-medium">{taskProgress.percent}%</span>
              </div>
              <Progress value={taskProgress.percent} className="h-2" />
            </div>
          )}
          
          {/* 日志列表 */}
          <ScrollArea className="flex-1 min-h-[300px] max-h-[400px] border rounded-lg bg-muted/30">
            <div ref={logContainerRef} className="p-4 font-mono text-sm space-y-1">
              {taskLogs.length === 0 ? (
                <div className="text-center text-muted-foreground py-8">
                  {taskStatus === 'pending' ? '任务等待中...' : '暂无日志'}
                </div>
              ) : (
                taskLogs.map((log, index) => (
                  <div
                    key={index}
                    className={`flex gap-2 ${
                      log.level === 'error' ? 'text-red-500' :
                      log.level === 'warn' ? 'text-yellow-500' :
                      log.level === 'debug' ? 'text-muted-foreground' :
                      'text-foreground'
                    }`}
                  >
                    <span className="text-muted-foreground shrink-0">
                      {new Date(log.timestamp).toLocaleTimeString('zh-CN')}
                    </span>
                    <span className={`shrink-0 uppercase text-xs px-1 rounded ${
                      log.level === 'error' ? 'bg-red-500/20' :
                      log.level === 'warn' ? 'bg-yellow-500/20' :
                      log.level === 'debug' ? 'bg-muted' :
                      'bg-blue-500/20'
                    }`}>
                      {log.level}
                    </span>
                    <span className="break-all">{log.message}</span>
                  </div>
                ))
              )}
              {(taskStatus === 'running' || taskStatus === 'pending') && (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  <span>等待更多日志...</span>
                </div>
              )}
            </div>
          </ScrollArea>
          
          <DialogFooter>
            <Button variant="outline" onClick={closeLogViewer}>
              关闭
            </Button>
            <Button 
              variant="outline" 
              onClick={() => selectedTaskId && fetchTaskLogs(selectedTaskId)}
            >
              <RefreshCw className="h-4 w-4 mr-1" />
              刷新
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

