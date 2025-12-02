import { useEffect, useState, useMemo } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
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
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { kiroApi } from '@/services/api'
import {
  Users,
  RefreshCw,
  Eye,
  EyeOff,
  Loader2,
  CheckCircle,
  XCircle,
  Copy,
  Check,
  Search,
  Download,
  Key,
  Calendar,
  Sparkles,
  Filter,
  Tag,
  Trash2,
  Power,
  MoreHorizontal,
  AlertCircle,
  Plus,
} from 'lucide-react'

interface Account {
  id: string
  email?: string
  label?: string
  savedAt?: string
  enabled: boolean
  type: string
  lastRefreshStatus?: string
  lastRefreshTime?: string
  hasRefreshToken: boolean
}

interface AccountDetail {
  id: string
  email?: string
  password?: string
  clientId?: string
  clientSecret?: string
  accessToken?: string
  refreshToken?: string
  label?: string
  savedAt?: string
  expiresIn?: number
  enabled: boolean
  type: string
  lastRefreshStatus?: string
  lastRefreshTime?: string
}

type FilterType = 'all' | 'with-token' | 'without-token' | 'enabled' | 'disabled'

export function KiroAccounts() {
  const [accounts, setAccounts] = useState<Account[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedAccount, setSelectedAccount] = useState<AccountDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [copiedField, setCopiedField] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [filterType, setFilterType] = useState<FilterType>('all')
  const [sortBy, setSortBy] = useState<'date' | 'label'>('date')
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [accountToDelete, setAccountToDelete] = useState<Account | null>(null)
  
  // 添加账号对话框
  const [addDialogOpen, setAddDialogOpen] = useState(false)
  const [addForm, setAddForm] = useState({ refreshToken: '', name: '' })
  const [addLoading, setAddLoading] = useState(false)

  useEffect(() => {
    loadAccounts()
  }, [])

  const loadAccounts = async () => {
    try {
      setLoading(true)
      const res = await kiroApi.getAccounts()
      if (res.success && res.data) {
        const data = res.data as { accounts?: Account[] }
        setAccounts(data.accounts || [])
      }
    } catch (error) {
      console.error('Failed to load accounts:', error)
    } finally {
      setLoading(false)
    }
  }

  // 计算统计数据
  const stats = useMemo(() => {
    const total = accounts.length
    const withToken = accounts.filter(a => a.hasRefreshToken).length
    const withoutToken = total - withToken
    const enabled = accounts.filter(a => a.enabled).length
    const disabled = total - enabled
    const labels = new Set(accounts.filter(a => a.label).map(a => a.label)).size
    return { total, withToken, withoutToken, enabled, disabled, labels }
  }, [accounts])

  // 切换账号启用状态
  const toggleAccountEnabled = async (account: Account) => {
    try {
      const res = await kiroApi.updateAccount(account.id, { enabled: !account.enabled })
      if (res.success) {
        setAccounts(prev => prev.map(a => 
          a.id === account.id ? { ...a, enabled: !a.enabled } : a
        ))
      }
    } catch (error) {
      console.error('Failed to toggle account:', error)
    }
  }

  // 打开删除确认对话框
  const openDeleteConfirm = (account: Account) => {
    setAccountToDelete(account)
    setDeleteConfirmOpen(true)
  }

  // 确认删除账号
  const confirmDeleteAccount = async () => {
    if (!accountToDelete) return
    try {
      const res = await kiroApi.deleteAccount(accountToDelete.id)
      if (res.success) {
        setAccounts(prev => prev.filter(a => a.id !== accountToDelete.id))
      }
    } catch (error) {
      console.error('Failed to delete account:', error)
    } finally {
      setDeleteConfirmOpen(false)
      setAccountToDelete(null)
    }
  }

  // 添加账号
  const handleAddAccount = async () => {
    if (!addForm.refreshToken.trim()) return
    
    setAddLoading(true)
    try {
      const res = await kiroApi.createAccount({
        refreshToken: addForm.refreshToken.trim(),
        name: addForm.name.trim() || undefined,
        enabled: true,
      })
      
      if (res.success) {
        setAddDialogOpen(false)
        setAddForm({ refreshToken: '', name: '' })
        loadAccounts() // 刷新列表
      }
    } catch (error) {
      console.error('Failed to add account:', error)
    } finally {
      setAddLoading(false)
    }
  }

  // 过滤和排序账号
  const filteredAccounts = useMemo(() => {
    let result = [...accounts]

    // 搜索过滤
    if (searchQuery) {
      const query = searchQuery.toLowerCase()
      result = result.filter(
        a => a.email?.toLowerCase().includes(query) || 
             a.label?.toLowerCase().includes(query) ||
             a.id.toLowerCase().includes(query)
      )
    }

    // 类型过滤
    if (filterType === 'with-token') {
      result = result.filter(a => a.hasRefreshToken)
    } else if (filterType === 'without-token') {
      result = result.filter(a => !a.hasRefreshToken)
    } else if (filterType === 'enabled') {
      result = result.filter(a => a.enabled)
    } else if (filterType === 'disabled') {
      result = result.filter(a => !a.enabled)
    }

    // 排序
    if (sortBy === 'date') {
      result.sort((a, b) => {
        const dateA = a.savedAt ? new Date(a.savedAt).getTime() : 0
        const dateB = b.savedAt ? new Date(b.savedAt).getTime() : 0
        return dateB - dateA
      })
    } else {
      result.sort((a, b) => (a.label || '').localeCompare(b.label || ''))
    }

    return result
  }, [accounts, searchQuery, filterType, sortBy])

  const viewAccountDetail = async (id: string) => {
    setDialogOpen(true)
    setDetailLoading(true)
    try {
      const res = await kiroApi.getAccountDetail(id)
      if (res.success && res.data) {
        const data = res.data as { account?: AccountDetail }
        setSelectedAccount(data.account || null)
      }
    } catch (error) {
      console.error('Failed to load account detail:', error)
    } finally {
      setDetailLoading(false)
    }
  }

  const copyToClipboard = async (text: string, field: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopiedField(field)
      setTimeout(() => setCopiedField(null), 2000)
    } catch (error) {
      console.error('Failed to copy:', error)
    }
  }

  const exportAccounts = () => {
    const data = filteredAccounts.map(a => ({
      id: a.id,
      label: a.label || '',
      hasRefreshToken: a.hasRefreshToken,
      enabled: a.enabled,
      savedAt: a.savedAt || '',
    }))
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `kiro-accounts-${new Date().toISOString().split('T')[0]}.json`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  const formatDate = (dateStr?: string) => {
    if (!dateStr) return '-'
    return new Date(dateStr).toLocaleString('zh-CN')
  }

  const formatDateShort = (dateStr?: string) => {
    if (!dateStr) return '-'
    const date = new Date(dateStr)
    const now = new Date()
    const diff = now.getTime() - date.getTime()
    const days = Math.floor(diff / (1000 * 60 * 60 * 24))
    
    if (days === 0) return '今天'
    if (days === 1) return '昨天'
    if (days < 7) return `${days}天前`
    return date.toLocaleDateString('zh-CN')
  }

  const maskToken = (token?: string) => {
    if (!token) return '-'
    if (token.length <= 20) return token
    return `${token.slice(0, 10)}...${token.slice(-10)}`
  }

  return (
    <div className="space-y-6">
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
            <div className="text-3xl font-bold tracking-tight">{stats.total}</div>
            <p className="text-xs text-muted-foreground mt-1">
              已配置的 Kiro 账号
            </p>
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
            <div className="text-3xl font-bold tracking-tight">{stats.withToken}</div>
            <p className="text-xs text-muted-foreground mt-1">
              拥有 Refresh Token
            </p>
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
            <div className="text-3xl font-bold tracking-tight">{stats.enabled}</div>
            <p className="text-xs text-muted-foreground mt-1">
              {stats.disabled} 个已禁用
            </p>
          </CardContent>
        </Card>

        <Card className="relative overflow-hidden border-amber-500/20 bg-gradient-to-br from-amber-500/5 via-transparent to-transparent">
          <div className="absolute top-0 right-0 w-32 h-32 bg-amber-500/10 rounded-full -translate-y-1/2 translate-x-1/2 blur-2xl" />
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">标签分组</CardTitle>
            <div className="p-2 rounded-lg bg-amber-500/10">
              <Tag className="h-4 w-4 text-amber-500" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold tracking-tight">{stats.labels}</div>
            <p className="text-xs text-muted-foreground mt-1">
              不同的标签类别
            </p>
          </CardContent>
        </Card>
      </div>

      {/* 账号列表 */}
      <Card className="border-border/50">
        <CardHeader className="border-b border-border/50">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-gradient-to-br from-violet-500 to-purple-500 shadow-lg shadow-violet-500/20">
                <Sparkles className="h-5 w-5 text-white" />
              </div>
              <div>
                <CardTitle className="text-lg">账号管理</CardTitle>
                <CardDescription>管理所有 Kiro 账号凭证</CardDescription>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="default"
                size="sm"
                onClick={() => setAddDialogOpen(true)}
                className="bg-gradient-to-r from-violet-500 to-purple-500 hover:from-violet-600 hover:to-purple-600"
              >
                <Plus className="h-4 w-4 mr-1.5" />
                添加账号
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={exportAccounts}
                disabled={filteredAccounts.length === 0}
              >
                <Download className="h-4 w-4 mr-1.5" />
                导出
              </Button>
              <Button variant="outline" size="sm" onClick={loadAccounts}>
                <RefreshCw className={`h-4 w-4 mr-1.5 ${loading ? 'animate-spin' : ''}`} />
                刷新
              </Button>
            </div>
          </div>

          {/* 搜索和过滤栏 */}
          <div className="flex flex-col gap-3 mt-4 md:flex-row md:items-center">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="搜索 ID 或标签..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9 bg-muted/50 border-border/50"
              />
            </div>
            <div className="flex items-center gap-2">
              <Tabs
                value={filterType}
                onValueChange={(v) => setFilterType(v as FilterType)}
                className="w-auto"
              >
                <TabsList className="bg-muted/50 h-9">
                  <TabsTrigger value="all" className="text-xs px-3 h-7">
                    全部
                  </TabsTrigger>
                  <TabsTrigger value="enabled" className="text-xs px-3 h-7">
                    <CheckCircle className="h-3 w-3 mr-1" />
                    启用
                  </TabsTrigger>
                  <TabsTrigger value="disabled" className="text-xs px-3 h-7">
                    <XCircle className="h-3 w-3 mr-1" />
                    禁用
                  </TabsTrigger>
                  <TabsTrigger value="with-token" className="text-xs px-3 h-7">
                    <Key className="h-3 w-3 mr-1" />
                    有Token
                  </TabsTrigger>
                </TabsList>
              </Tabs>
              <Select value={sortBy} onValueChange={(v) => setSortBy(v as 'date' | 'label')}>
                <SelectTrigger className="w-[120px] h-9 bg-muted/50 border-border/50">
                  <Filter className="h-3.5 w-3.5 mr-1.5 text-muted-foreground" />
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="date">按时间</SelectItem>
                  <SelectItem value="label">按标签</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>

        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <div className="flex flex-col items-center gap-3">
                <Loader2 className="h-8 w-8 animate-spin text-violet-500" />
                <p className="text-sm text-muted-foreground">加载账号列表...</p>
              </div>
            </div>
          ) : filteredAccounts.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <div className="p-4 rounded-full bg-muted/50 mb-4">
                <Users className="h-8 w-8 text-muted-foreground" />
              </div>
              <h3 className="font-medium mb-1">
                {accounts.length === 0 ? '暂无账号' : '没有匹配的账号'}
              </h3>
              <p className="text-sm text-muted-foreground max-w-sm">
                {accounts.length === 0
                  ? '点击"添加账号"按钮来添加 Kiro 账号'
                  : '尝试调整搜索条件或过滤器'}
              </p>
              {accounts.length === 0 && (
                <Button
                  className="mt-4 bg-gradient-to-r from-violet-500 to-purple-500"
                  onClick={() => setAddDialogOpen(true)}
                >
                  <Plus className="h-4 w-4 mr-1.5" />
                  添加账号
                </Button>
              )}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent border-border/50">
                    <TableHead className="w-[200px] text-center">ID</TableHead>
                    <TableHead className="w-[120px] text-center">标签</TableHead>
                    <TableHead className="w-[80px] text-center">状态</TableHead>
                    <TableHead className="w-[100px] text-center">Token</TableHead>
                    <TableHead className="w-[100px] text-center">添加时间</TableHead>
                    <TableHead className="w-[140px] text-center">操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredAccounts.map((account, index) => (
                    <TableRow
                      key={account.id}
                      className={`border-border/50 hover:bg-muted/30 transition-colors ${!account.enabled ? 'opacity-60' : ''}`}
                      style={{ animationDelay: `${index * 20}ms` }}
                    >
                      <TableCell className="text-center">
                        <div className="flex items-center justify-center gap-3">
                          <div className={`flex items-center justify-center w-8 h-8 rounded-lg border ${account.enabled ? 'bg-gradient-to-br from-violet-500/10 to-purple-500/10 border-violet-500/20' : 'bg-muted border-border'}`}>
                            <Key className={`h-4 w-4 ${account.enabled ? 'text-violet-500' : 'text-muted-foreground'}`} />
                          </div>
                          <span className="font-mono text-sm">{account.id.slice(0, 12)}...</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-center">
                        {account.label ? (
                          <Badge variant="outline" className="font-normal">
                            {account.label}
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground text-sm">-</span>
                        )}
                      </TableCell>
                      <TableCell className="text-center">
                        <div className="flex justify-center">
                          <Switch
                            checked={account.enabled}
                            onCheckedChange={() => toggleAccountEnabled(account)}
                            className="data-[state=checked]:bg-violet-500"
                          />
                        </div>
                      </TableCell>
                      <TableCell className="text-center">
                        {account.hasRefreshToken ? (
                          <Badge className="bg-emerald-500/10 text-emerald-500 border-emerald-500/20 hover:bg-emerald-500/20">
                            <CheckCircle className="h-3 w-3 mr-1" />
                            有效
                          </Badge>
                        ) : (
                          <Badge variant="secondary" className="bg-muted text-muted-foreground">
                            <XCircle className="h-3 w-3 mr-1" />
                            缺失
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-center">
                        <div className="flex items-center justify-center gap-1.5 text-sm text-muted-foreground">
                          <Calendar className="h-3.5 w-3.5" />
                          {formatDateShort(account.savedAt)}
                        </div>
                      </TableCell>
                      <TableCell className="text-center">
                        <div className="flex items-center justify-center gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => viewAccountDetail(account.id)}
                          >
                            <Eye className="h-4 w-4 mr-1" />
                            详情
                          </Button>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8"
                              >
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => toggleAccountEnabled(account)}>
                                <Power className="h-4 w-4 mr-2" />
                                {account.enabled ? '禁用账号' : '启用账号'}
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                onClick={() => openDeleteConfirm(account)}
                                className="text-destructive focus:text-destructive"
                              >
                                <Trash2 className="h-4 w-4 mr-2" />
                                删除账号
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>

        {/* 底部统计 */}
        {filteredAccounts.length > 0 && (
          <div className="px-6 py-3 border-t border-border/50 bg-muted/30">
            <p className="text-xs text-muted-foreground">
              显示 {filteredAccounts.length} 个账号
              {filteredAccounts.length !== accounts.length && ` (共 ${accounts.length} 个)`}
            </p>
          </div>
        )}
      </Card>

      {/* 添加账号对话框 */}
      <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-gradient-to-br from-violet-500 to-purple-500">
                <Plus className="h-5 w-5 text-white" />
              </div>
              <div>
                <DialogTitle>添加 Kiro 账号</DialogTitle>
                <DialogDescription className="mt-1">
                  通过 Refresh Token 添加新的 Kiro 账号
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>
          
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="refreshToken">Refresh Token *</Label>
              <Textarea
                id="refreshToken"
                placeholder="请输入 Kiro 的 Refresh Token..."
                value={addForm.refreshToken}
                onChange={(e) => setAddForm(prev => ({ ...prev, refreshToken: e.target.value }))}
                className="min-h-[100px] font-mono text-sm"
              />
              <p className="text-xs text-muted-foreground">
                从 Kiro 浏览器登录后获取的 Refresh Token
              </p>
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="name">标签（可选）</Label>
              <Input
                id="name"
                placeholder="为账号添加一个标签..."
                value={addForm.name}
                onChange={(e) => setAddForm(prev => ({ ...prev, name: e.target.value }))}
              />
              <p className="text-xs text-muted-foreground">
                方便识别和管理的账号标签
              </p>
            </div>
          </div>
          
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setAddDialogOpen(false)}
              disabled={addLoading}
            >
              取消
            </Button>
            <Button
              onClick={handleAddAccount}
              disabled={!addForm.refreshToken.trim() || addLoading}
              className="bg-gradient-to-r from-violet-500 to-purple-500 hover:from-violet-600 hover:to-purple-600"
            >
              {addLoading ? (
                <>
                  <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                  添加中...
                </>
              ) : (
                <>
                  <Plus className="h-4 w-4 mr-1.5" />
                  添加账号
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 账号详情对话框 */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-hidden flex flex-col">
          <DialogHeader className="border-b border-border/50 pb-4">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-gradient-to-br from-violet-500 to-purple-500">
                <Users className="h-5 w-5 text-white" />
              </div>
              <div>
                <DialogTitle className="text-lg">账号详情</DialogTitle>
                <DialogDescription className="font-mono text-xs mt-0.5">
                  {selectedAccount?.id || '加载中...'}
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto py-4">
            {detailLoading ? (
              <div className="flex items-center justify-center py-12">
                <div className="flex flex-col items-center gap-3">
                  <Loader2 className="h-8 w-8 animate-spin text-violet-500" />
                  <p className="text-sm text-muted-foreground">加载账号信息...</p>
                </div>
              </div>
            ) : selectedAccount ? (
              <div className="space-y-3">
                <DetailItem
                  icon={<Key className="h-4 w-4" />}
                  label="账号 ID"
                  value={selectedAccount.id}
                  onCopy={() => copyToClipboard(selectedAccount.id, 'id')}
                  copied={copiedField === 'id'}
                />
                {selectedAccount.accessToken && (
                  <DetailItem
                    icon={<Key className="h-4 w-4" />}
                    label="Access Token"
                    value={maskToken(selectedAccount.accessToken)}
                    onCopy={() => copyToClipboard(selectedAccount.accessToken!, 'accessToken')}
                    copied={copiedField === 'accessToken'}
                    highlight
                  />
                )}
                {selectedAccount.refreshToken && (
                  <DetailItem
                    icon={<Key className="h-4 w-4" />}
                    label="Refresh Token"
                    value={maskToken(selectedAccount.refreshToken)}
                    onCopy={() => copyToClipboard(selectedAccount.refreshToken!, 'refreshToken')}
                    copied={copiedField === 'refreshToken'}
                    highlight
                  />
                )}
                <div className="grid grid-cols-2 gap-3 pt-2">
                  <DetailItem
                    icon={<Tag className="h-4 w-4" />}
                    label="标签"
                    value={selectedAccount.label || '-'}
                    compact
                  />
                  <DetailItem
                    icon={<Calendar className="h-4 w-4" />}
                    label="添加时间"
                    value={formatDate(selectedAccount.savedAt)}
                    compact
                  />
                  <DetailItem
                    icon={<Power className="h-4 w-4" />}
                    label="账号状态"
                    value={selectedAccount.enabled ? '已启用' : '已禁用'}
                    compact
                  />
                  <DetailItem
                    icon={<Sparkles className="h-4 w-4" />}
                    label="账号类型"
                    value={selectedAccount.type || 'kiro'}
                    compact
                  />
                </div>
                {selectedAccount.lastRefreshStatus && (
                  <DetailItem
                    icon={<AlertCircle className="h-4 w-4" />}
                    label="上次刷新状态"
                    value={`${selectedAccount.lastRefreshStatus}${selectedAccount.lastRefreshTime ? ` (${formatDate(selectedAccount.lastRefreshTime)})` : ''}`}
                    compact
                  />
                )}
                {selectedAccount.expiresIn && (
                  <DetailItem
                    icon={<Calendar className="h-4 w-4" />}
                    label="Token 有效期"
                    value={`${selectedAccount.expiresIn} 秒`}
                    compact
                  />
                )}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <div className="p-4 rounded-full bg-destructive/10 mb-4">
                  <XCircle className="h-8 w-8 text-destructive" />
                </div>
                <h3 className="font-medium mb-1">加载失败</h3>
                <p className="text-sm text-muted-foreground">无法获取账号详细信息</p>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* 删除确认对话框 */}
      <Dialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-destructive/10">
                <Trash2 className="h-5 w-5 text-destructive" />
              </div>
              <div>
                <DialogTitle>确认删除账号</DialogTitle>
                <DialogDescription className="mt-1">
                  此操作不可恢复，请谨慎操作
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>
          <div className="py-4">
            <p className="text-sm text-muted-foreground">
              确定要删除账号 <span className="font-mono text-foreground">{accountToDelete?.label || accountToDelete?.id}</span> 吗？
            </p>
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="outline"
              onClick={() => setDeleteConfirmOpen(false)}
            >
              取消
            </Button>
            <Button
              variant="destructive"
              onClick={confirmDeleteAccount}
            >
              确认删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

interface DetailItemProps {
  icon?: React.ReactNode
  label: string
  value: string
  onCopy?: () => void
  copied?: boolean
  masked?: boolean
  highlight?: boolean
  compact?: boolean
}

function DetailItem({ icon, label, value, onCopy, copied, masked, highlight, compact }: DetailItemProps) {
  const [showValue, setShowValue] = useState(!masked)

  return (
    <div
      className={`
        flex items-start justify-between gap-4 p-3 rounded-xl border transition-colors
        ${highlight ? 'border-violet-500/30 bg-violet-500/5' : 'border-border/50 bg-muted/30'}
        ${compact ? 'p-2.5' : ''}
      `}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          {icon && <span className="text-muted-foreground">{icon}</span>}
          <p className={`font-medium text-muted-foreground ${compact ? 'text-xs' : 'text-sm'}`}>
            {label}
          </p>
        </div>
        <p className={`font-mono break-all ${compact ? 'text-xs' : 'text-sm'}`}>
          {masked && !showValue ? '••••••••••••••••' : value}
        </p>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        {masked && (
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => setShowValue(!showValue)}
          >
            {showValue ? (
              <EyeOff className="h-3.5 w-3.5 text-muted-foreground" />
            ) : (
              <Eye className="h-3.5 w-3.5 text-muted-foreground" />
            )}
          </Button>
        )}
        {onCopy && (
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={onCopy}
          >
            {copied ? (
              <Check className="h-3.5 w-3.5 text-violet-500" />
            ) : (
              <Copy className="h-3.5 w-3.5 text-muted-foreground" />
            )}
          </Button>
        )}
      </div>
    </div>
  )
}

