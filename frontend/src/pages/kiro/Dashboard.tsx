import { useEffect, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { kiroApi } from '@/services/api'
import {
  Users,
  RefreshCw,
  Loader2,
  CheckCircle,
  XCircle,
  Key,
  Power,
  Sparkles,
} from 'lucide-react'
import { Link } from 'react-router-dom'

interface Stats {
  total: number
  enabled: number
  disabled: number
  withToken: number
}

export function KiroDashboard() {
  const [stats, setStats] = useState<Stats>({ total: 0, enabled: 0, disabled: 0, withToken: 0 })
  const [loading, setLoading] = useState(true)
  const [health, setHealth] = useState<'healthy' | 'unhealthy' | 'unknown'>('unknown')

  useEffect(() => {
    loadData()
  }, [])

  const loadData = async () => {
    setLoading(true)
    try {
      // 加载账号统计
      const accountsRes = await kiroApi.getAccounts()
      if (accountsRes.success && accountsRes.data) {
        const data = accountsRes.data as { accounts?: Array<{ enabled: boolean; hasRefreshToken: boolean }> }
        const accounts = data.accounts || []
        setStats({
          total: accounts.length,
          enabled: accounts.filter(a => a.enabled).length,
          disabled: accounts.filter(a => !a.enabled).length,
          withToken: accounts.filter(a => a.hasRefreshToken).length,
        })
      }

      // 检查健康状态
      const healthRes = await kiroApi.getHealth()
      if (healthRes.success) {
        setHealth('healthy')
      } else {
        setHealth('unhealthy')
      }
    } catch (error) {
      console.error('Failed to load data:', error)
      setHealth('unhealthy')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* 页面标题 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-gradient-to-br from-violet-500 to-purple-500 shadow-lg shadow-violet-500/20">
            <Sparkles className="h-6 w-6 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">Kiro 概览</h1>
            <p className="text-sm text-muted-foreground">Kiro 服务状态和账号统计</p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={loadData} disabled={loading}>
          <RefreshCw className={`h-4 w-4 mr-1.5 ${loading ? 'animate-spin' : ''}`} />
          刷新
        </Button>
      </div>

      {/* 服务状态 */}
      <Card className="border-border/50">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">服务状态</CardTitle>
          <CardDescription>Kiro API 服务运行状态</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-3">
            {loading ? (
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            ) : health === 'healthy' ? (
              <>
                <div className="flex items-center justify-center w-10 h-10 rounded-full bg-emerald-500/10">
                  <CheckCircle className="h-5 w-5 text-emerald-500" />
                </div>
                <div>
                  <p className="font-medium text-emerald-500">服务正常</p>
                  <p className="text-sm text-muted-foreground">所有系统运行正常</p>
                </div>
              </>
            ) : (
              <>
                <div className="flex items-center justify-center w-10 h-10 rounded-full bg-destructive/10">
                  <XCircle className="h-5 w-5 text-destructive" />
                </div>
                <div>
                  <p className="font-medium text-destructive">服务异常</p>
                  <p className="text-sm text-muted-foreground">请检查服务配置</p>
                </div>
              </>
            )}
          </div>
        </CardContent>
      </Card>

      {/* 统计卡片 */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card className="relative overflow-hidden border-violet-500/20 bg-gradient-to-br from-violet-500/5 via-transparent to-transparent">
          <div className="absolute top-0 right-0 w-32 h-32 bg-violet-500/10 rounded-full -translate-y-1/2 translate-x-1/2 blur-2xl" />
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">账号总数</CardTitle>
            <div className="p-2 rounded-lg bg-violet-500/10">
              <Users className="h-4 w-4 text-violet-500" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold tracking-tight">
              {loading ? <Loader2 className="h-6 w-6 animate-spin" /> : stats.total}
            </div>
            <p className="text-xs text-muted-foreground mt-1">已配置的 Kiro 账号</p>
          </CardContent>
        </Card>

        <Card className="relative overflow-hidden border-emerald-500/20 bg-gradient-to-br from-emerald-500/5 via-transparent to-transparent">
          <div className="absolute top-0 right-0 w-32 h-32 bg-emerald-500/10 rounded-full -translate-y-1/2 translate-x-1/2 blur-2xl" />
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">已启用</CardTitle>
            <div className="p-2 rounded-lg bg-emerald-500/10">
              <Power className="h-4 w-4 text-emerald-500" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold tracking-tight">
              {loading ? <Loader2 className="h-6 w-6 animate-spin" /> : stats.enabled}
            </div>
            <p className="text-xs text-muted-foreground mt-1">{stats.disabled} 个已禁用</p>
          </CardContent>
        </Card>

        <Card className="relative overflow-hidden border-cyan-500/20 bg-gradient-to-br from-cyan-500/5 via-transparent to-transparent">
          <div className="absolute top-0 right-0 w-32 h-32 bg-cyan-500/10 rounded-full -translate-y-1/2 translate-x-1/2 blur-2xl" />
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">有效 Token</CardTitle>
            <div className="p-2 rounded-lg bg-cyan-500/10">
              <Key className="h-4 w-4 text-cyan-500" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold tracking-tight">
              {loading ? <Loader2 className="h-6 w-6 animate-spin" /> : stats.withToken}
            </div>
            <p className="text-xs text-muted-foreground mt-1">拥有 Refresh Token</p>
          </CardContent>
        </Card>

        <Card className="relative overflow-hidden border-amber-500/20 bg-gradient-to-br from-amber-500/5 via-transparent to-transparent">
          <div className="absolute top-0 right-0 w-32 h-32 bg-amber-500/10 rounded-full -translate-y-1/2 translate-x-1/2 blur-2xl" />
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">快速操作</CardTitle>
            <div className="p-2 rounded-lg bg-amber-500/10">
              <Sparkles className="h-4 w-4 text-amber-500" />
            </div>
          </CardHeader>
          <CardContent>
            <Link to="/kiro/accounts">
              <Button variant="outline" size="sm" className="w-full">
                管理账号
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
