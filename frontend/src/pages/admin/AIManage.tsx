import { useEffect, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { adminApi } from '@/services/api'
import {
  Bot,
  Play,
  RefreshCw,
  Loader2,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Settings,
} from 'lucide-react'

interface AIConfig {
  enabled: boolean
  apiKey: string
  apiEndpoint: string
  model: string
  checkIntervalHours: number
  autoModerateThreshold: number
  systemPrompt: string
}

interface AILog {
  timestamp: number
  date: string
  userId?: string
  username?: string
  action: string
  confidence?: number
  reason?: string
  evidence?: string
  error?: string
  summary?: {
    totalChecked: number
    bannedCount: number
    flaggedCount: number
    normalCount: number
    errorCount: number
    durationMs: number
  }
}

interface AIStats {
  totalRuns: number
  totalChecked: number
  totalBanned: number
  totalFlagged: number
  avgDuration: number
  lastRun: {
    timestamp: number
    date: string
    summary: {
      totalChecked: number
      bannedCount: number
      flaggedCount: number
    }
  } | null
}

export function AIManage() {
  const [config, setConfig] = useState<AIConfig>({
    enabled: false,
    apiKey: '',
    apiEndpoint: '',
    model: 'gemini-2.0-flash-exp',
    checkIntervalHours: 1,
    autoModerateThreshold: 0.8,
    systemPrompt: '',
  })
  const [logs, setLogs] = useState<AILog[]>([])
  const [stats, setStats] = useState<AIStats>({
    totalRuns: 0,
    totalChecked: 0,
    totalBanned: 0,
    totalFlagged: 0,
    avgDuration: 0,
    lastRun: null,
  })
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [running, setRunning] = useState(false)

  useEffect(() => {
    loadData()
  }, [])

  const loadData = async () => {
    try {
      const [configRes, logsRes, statsRes] = await Promise.all([
        adminApi.getAIConfig(),
        adminApi.getAILogs(),
        adminApi.getAIStatistics(),
      ])

      if (configRes.success && configRes.data) {
        const data = configRes.data as AIConfig
        setConfig({
          enabled: data.enabled ?? false,
          apiKey: data.apiKey ?? '',
          apiEndpoint: data.apiEndpoint ?? '',
          model: data.model ?? 'gemini-2.0-flash-exp',
          checkIntervalHours: data.checkIntervalHours ?? 1,
          autoModerateThreshold: data.autoModerateThreshold ?? 0.8,
          systemPrompt: data.systemPrompt ?? '',
        })
      }

      if (logsRes.success && logsRes.data) {
        // 后端返回 { logs: [...] } 结构
        const logsData = logsRes.data as { logs?: AILog[] }
        setLogs(Array.isArray(logsData.logs) ? logsData.logs : [])
      }

      if (statsRes.success && statsRes.data) {
        const data = statsRes.data as AIStats
        setStats({
          totalRuns: data.totalRuns ?? 0,
          totalChecked: data.totalChecked ?? 0,
          totalBanned: data.totalBanned ?? 0,
          totalFlagged: data.totalFlagged ?? 0,
          avgDuration: data.avgDuration ?? 0,
          lastRun: data.lastRun ?? null,
        })
      }
    } catch (error) {
      console.error('Failed to load AI data:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleSaveConfig = async () => {
    setSubmitting(true)
    try {
      const res = await adminApi.updateAIConfig(config)
      if (res.success) {
        setMessage({ type: 'success', text: 'AI 配置保存成功' })
        loadData()
      } else {
        setMessage({ type: 'error', text: res.error || 'AI 配置保存失败' })
      }
    } catch (error) {
      setMessage({ type: 'error', text: 'AI 配置保存失败' })
    } finally {
      setSubmitting(false)
    }
  }

  const handleRunModerator = async () => {
    setRunning(true)
    try {
      const res = await adminApi.runAIModerator()
      if (res.success) {
        setMessage({ type: 'success', text: 'AI 审核已执行' })
        loadData()
      } else {
        setMessage({ type: 'error', text: res.error || 'AI 审核执行失败' })
      }
    } catch (error) {
      setMessage({ type: 'error', text: 'AI 审核执行失败' })
    } finally {
      setRunning(false)
    }
  }

  const formatDate = (log: AILog) => {
    if (log.date) {
      return new Date(log.date).toLocaleString('zh-CN')
    }
    if (log.timestamp) {
      return new Date(log.timestamp).toLocaleString('zh-CN')
    }
    return '-'
  }

  const getActionBadge = (action: string) => {
    switch (action) {
      case 'auto_banned':
        return (
          <Badge variant="destructive" className="gap-1">
            <XCircle className="h-3 w-3" />
            自动封禁
          </Badge>
        )
      case 'flagged':
        return (
          <Badge variant="warning" className="gap-1">
            <AlertTriangle className="h-3 w-3" />
            标记可疑
          </Badge>
        )
      case 'analysis_failed':
        return (
          <Badge variant="secondary" className="gap-1">
            <XCircle className="h-3 w-3" />
            分析失败
          </Badge>
        )
      case 'moderation_completed':
        return (
          <Badge variant="success" className="gap-1">
            <CheckCircle className="h-3 w-3" />
            审核完成
          </Badge>
        )
      default:
        return <Badge variant="outline">{action}</Badge>
    }
  }

  const getLogDescription = (log: AILog) => {
    if (log.action === 'moderation_completed' && log.summary) {
      return `检查 ${log.summary.totalChecked} 用户, 封禁 ${log.summary.bannedCount}, 标记 ${log.summary.flaggedCount}`
    }
    if (log.reason) return log.reason
    if (log.error) return `错误: ${log.error}`
    return '-'
  }

  return (
    <div className="space-y-6">
      {message && (
        <Alert variant={message.type === 'error' ? 'destructive' : 'default'}>
          <AlertDescription>{message.text}</AlertDescription>
        </Alert>
      )}

      {/* 统计卡片 */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">总审核次数</CardTitle>
            <Bot className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.totalRuns}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">检查用户数</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.totalChecked}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">标记可疑</CardTitle>
            <AlertTriangle className="h-4 w-4 text-yellow-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-yellow-600">{stats.totalFlagged}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">自动封禁</CardTitle>
            <XCircle className="h-4 w-4 text-red-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-600">{stats.totalBanned}</div>
          </CardContent>
        </Card>
      </div>

      {/* AI 配置 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Settings className="h-5 w-5" />
            AI 自动审核配置
          </CardTitle>
          <CardDescription>
            配置 AI 自动审核 Token 的规则和参数
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between p-4 border rounded-lg">
            <div>
              <Label className="text-base">启用 AI 自动审核</Label>
              <p className="text-sm text-muted-foreground">
                开启后将定期自动审核共享用户
              </p>
            </div>
            <Switch
              checked={config.enabled}
              onCheckedChange={(checked) => setConfig({ ...config, enabled: checked })}
            />
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label>API 端点</Label>
              <Input
                value={config.apiEndpoint}
                onChange={(e) => setConfig({ ...config, apiEndpoint: e.target.value })}
                placeholder="https://api.example.com/v1/chat/completions"
              />
            </div>
            <div className="space-y-2">
              <Label>API 密钥</Label>
              <Input
                type="password"
                value={config.apiKey}
                onChange={(e) => setConfig({ ...config, apiKey: e.target.value })}
                placeholder="sk-..."
              />
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <div className="space-y-2">
              <Label>使用模型</Label>
              <Input
                value={config.model}
                onChange={(e) => setConfig({ ...config, model: e.target.value })}
                placeholder="gemini-2.0-flash-exp"
              />
            </div>
            <div className="space-y-2">
              <Label>审核间隔（小时）</Label>
              <Input
                type="number"
                value={config.checkIntervalHours}
                onChange={(e) => setConfig({ ...config, checkIntervalHours: parseInt(e.target.value) || 1 })}
                min="1"
              />
            </div>
            <div className="space-y-2">
              <Label>置信度阈值</Label>
              <Input
                type="number"
                value={config.autoModerateThreshold}
                onChange={(e) => setConfig({ ...config, autoModerateThreshold: parseFloat(e.target.value) || 0.8 })}
                min="0"
                max="1"
                step="0.1"
              />
              <p className="text-xs text-muted-foreground">0-1 之间，超过此值自动封禁</p>
            </div>
          </div>

          <div className="space-y-2">
            <Label>系统提示词</Label>
            <Textarea
              value={config.systemPrompt}
              onChange={(e) => setConfig({ ...config, systemPrompt: e.target.value })}
              placeholder="输入 AI 系统提示词..."
              rows={6}
            />
          </div>

          <div className="flex gap-2">
            <Button onClick={handleSaveConfig} disabled={submitting}>
              {submitting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              保存配置
            </Button>
            <Button variant="outline" onClick={handleRunModerator} disabled={running}>
              {running ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <Play className="h-4 w-4 mr-2" />
              )}
              立即执行审核
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* 审核日志 */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <Bot className="h-5 w-5" />
              最新审核记录
            </CardTitle>
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
          ) : logs.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              暂无审核记录
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>时间</TableHead>
                  <TableHead>用户</TableHead>
                  <TableHead>操作</TableHead>
                  <TableHead>详情</TableHead>
                  <TableHead>置信度</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {logs.map((log, index) => (
                  <TableRow key={`${log.timestamp}-${index}`}>
                    <TableCell className="text-sm whitespace-nowrap">
                      {formatDate(log)}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {log.username || (log.action === 'moderation_completed' ? '系统' : '-')}
                    </TableCell>
                    <TableCell>{getActionBadge(log.action)}</TableCell>
                    <TableCell className="text-sm max-w-[300px] truncate">
                      {getLogDescription(log)}
                    </TableCell>
                    <TableCell className="text-sm">
                      {log.confidence !== undefined ? `${(log.confidence * 100).toFixed(0)}%` : '-'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

