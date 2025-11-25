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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { adminApi } from '@/services/api'
import {
  Key,
  Plus,
  Trash2,
  RefreshCw,
  ExternalLink,
  CheckCircle,
  XCircle,
  Loader2,
} from 'lucide-react'

interface Token {
  index: number
  access_token: string
  refresh_token?: string
  expires_in?: number
  timestamp?: number
  enable: boolean
  created?: string
}

export function TokenManage() {
  const [tokens, setTokens] = useState<Token[]>([])
  const [loading, setLoading] = useState(true)
  const [oauthConfig, setOauthConfig] = useState({
    client_id: '',
    client_secret: '',
    project_id: '',
  })
  const [callbackUrl, setCallbackUrl] = useState('')
  const [directToken, setDirectToken] = useState({
    access_token: '',
    refresh_token: '',
    expires_in: '3600',
  })
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [tokenToDelete, setTokenToDelete] = useState<number | null>(null)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    loadTokens()
    loadOAuthConfig()
  }, [])

  const loadTokens = async () => {
    try {
      const res = await adminApi.getTokens()
      if (res.success && res.data) {
        setTokens(res.data as Token[])
      }
    } catch (error) {
      console.error('Failed to load tokens:', error)
    } finally {
      setLoading(false)
    }
  }

  const loadOAuthConfig = async () => {
    try {
      const res = await adminApi.getOAuthConfig()
      if (res.success && res.data) {
        const data = res.data as { client_id?: string; client_secret?: string; project_id?: string }
        setOauthConfig({
          client_id: data.client_id || '',
          client_secret: data.client_secret || '',
          project_id: data.project_id || '',
        })
      }
    } catch (error) {
      console.error('Failed to load OAuth config:', error)
    }
  }

  const handleOAuthLogin = async () => {
    if (!oauthConfig.client_id || !oauthConfig.client_secret || !oauthConfig.project_id) {
      setMessage({ type: 'error', text: '请先填写 OAuth 配置信息' })
      return
    }

    setSubmitting(true)
    try {
      await adminApi.updateOAuthConfig(oauthConfig)
      const res = await adminApi.triggerOAuthLogin()
      if (res.success && res.data) {
        const data = res.data as { url?: string }
        if (data.url) {
          window.open(data.url, '_blank')
          setMessage({ type: 'success', text: 'OAuth 登录页面已打开，请在新窗口完成登录' })
        }
      } else {
        setMessage({ type: 'error', text: res.error || '触发 OAuth 登录失败' })
      }
    } catch (error) {
      setMessage({ type: 'error', text: '触发 OAuth 登录失败' })
    } finally {
      setSubmitting(false)
    }
  }

  const handleCallbackAdd = async () => {
    if (!callbackUrl) {
      setMessage({ type: 'error', text: '请输入回调链接' })
      return
    }

    setSubmitting(true)
    try {
      const res = await adminApi.addTokenCallback(callbackUrl)
      if (res.success) {
        setMessage({ type: 'success', text: 'Token 添加成功' })
        setCallbackUrl('')
        loadTokens()
      } else {
        setMessage({ type: 'error', text: res.error || 'Token 添加失败' })
      }
    } catch (error) {
      setMessage({ type: 'error', text: '添加 Token 失败' })
    } finally {
      setSubmitting(false)
    }
  }

  const handleDirectAdd = async () => {
    if (!directToken.access_token) {
      setMessage({ type: 'error', text: '请输入 Access Token' })
      return
    }

    setSubmitting(true)
    try {
      const res = await adminApi.addToken({
        access_token: directToken.access_token,
        refresh_token: directToken.refresh_token || undefined,
        expires_in: parseInt(directToken.expires_in) || 3600,
      })
      if (res.success) {
        setMessage({ type: 'success', text: 'Token 添加成功' })
        setDirectToken({ access_token: '', refresh_token: '', expires_in: '3600' })
        loadTokens()
      } else {
        setMessage({ type: 'error', text: res.error || 'Token 添加失败' })
      }
    } catch (error) {
      setMessage({ type: 'error', text: 'Token 添加失败' })
    } finally {
      setSubmitting(false)
    }
  }

  const handleToggleToken = async (index: number, currentEnabled: boolean) => {
    try {
      const res = await adminApi.toggleToken(index, !currentEnabled)
      if (res.success) {
        loadTokens()
      }
    } catch (error) {
      console.error('Failed to toggle token:', error)
    }
  }

  const handleDeleteToken = async () => {
    if (tokenToDelete === null) return

    try {
      const res = await adminApi.deleteToken(tokenToDelete)
      if (res.success) {
        setMessage({ type: 'success', text: 'Token 删除成功' })
        loadTokens()
      } else {
        setMessage({ type: 'error', text: res.error || 'Token 删除失败' })
      }
    } catch (error) {
      setMessage({ type: 'error', text: 'Token 删除失败' })
    } finally {
      setDeleteDialogOpen(false)
      setTokenToDelete(null)
    }
  }

  const formatTimestamp = (timestamp?: number) => {
    if (!timestamp) return '-'
    return new Date(timestamp).toLocaleString('zh-CN')
  }

  const isTokenExpired = (token: Token) => {
    if (!token.timestamp || !token.expires_in) return false
    const expiresAt = token.timestamp + token.expires_in * 1000
    return Date.now() > expiresAt
  }

  return (
    <div className="space-y-6">
      {message && (
        <Alert variant={message.type === 'error' ? 'destructive' : 'default'}>
          <AlertDescription>{message.text}</AlertDescription>
        </Alert>
      )}

      {/* Google OAuth 登录 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ExternalLink className="h-5 w-5" />
            Google OAuth 登录
          </CardTitle>
          <CardDescription>
            点击下方按钮启动 Google OAuth 登录流程，获取访问 Token。请先填写 Client / Secret / Project。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-3">
            <div className="space-y-2">
              <Label>OAuth Client ID <span className="text-destructive">*</span></Label>
              <Input
                value={oauthConfig.client_id}
                onChange={(e) => setOauthConfig({ ...oauthConfig, client_id: e.target.value })}
                placeholder="输入 Google OAuth Client ID"
              />
            </div>
            <div className="space-y-2">
              <Label>OAuth Client Secret <span className="text-destructive">*</span></Label>
              <Input
                type="password"
                value={oauthConfig.client_secret}
                onChange={(e) => setOauthConfig({ ...oauthConfig, client_secret: e.target.value })}
                placeholder="输入 Google OAuth Client Secret"
              />
            </div>
            <div className="space-y-2">
              <Label>Gemini Project ID <span className="text-destructive">*</span></Label>
              <Input
                value={oauthConfig.project_id}
                onChange={(e) => setOauthConfig({ ...oauthConfig, project_id: e.target.value })}
                placeholder="输入 Gemini Project ID"
              />
            </div>
          </div>
          <Button onClick={handleOAuthLogin} disabled={submitting} className="bg-green-600 hover:bg-green-700">
            {submitting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <ExternalLink className="h-4 w-4 mr-2" />}
            登录获取 Token
          </Button>
        </CardContent>
      </Card>

      {/* 手动添加 Token（回调链接） */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Plus className="h-5 w-5" />
            手动添加 Token（回调链接）
          </CardTitle>
          <CardDescription>
            如果自动回调失败，可以将浏览器地址栏中的完整回调链接粘贴到下方。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>回调链接</Label>
            <Input
              value={callbackUrl}
              onChange={(e) => setCallbackUrl(e.target.value)}
              placeholder="http://localhost:xxxx/oauth-callback?code=..."
            />
          </div>
          <Button onClick={handleCallbackAdd} disabled={submitting} className="bg-green-600 hover:bg-green-700">
            {submitting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Plus className="h-4 w-4 mr-2" />}
            添加 Token
          </Button>
        </CardContent>
      </Card>

      {/* 直接添加 Token */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Key className="h-5 w-5" />
            手动添加 Token（直接输入）
          </CardTitle>
          <CardDescription>
            直接粘贴您的 Google OAuth Token 信息。如果您已经通过其他方式获取了 Token，可以在此处手动添加。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Access Token <span className="text-destructive">*</span></Label>
            <Textarea
              value={directToken.access_token}
              onChange={(e) => setDirectToken({ ...directToken, access_token: e.target.value })}
              placeholder="粘贴 access_token..."
              rows={3}
            />
            <p className="text-sm text-muted-foreground">必填项：访问令牌</p>
          </div>
          <div className="space-y-2">
            <Label>Refresh Token</Label>
            <Textarea
              value={directToken.refresh_token}
              onChange={(e) => setDirectToken({ ...directToken, refresh_token: e.target.value })}
              placeholder="粘贴 refresh_token（可选）..."
              rows={2}
            />
            <p className="text-sm text-muted-foreground">可选项：刷新令牌（用于自动续期）</p>
          </div>
          <div className="space-y-2">
            <Label>过期时间（秒）</Label>
            <Input
              type="number"
              value={directToken.expires_in}
              onChange={(e) => setDirectToken({ ...directToken, expires_in: e.target.value })}
              placeholder="例如: 3600"
            />
            <p className="text-sm text-muted-foreground">Token 有效期，默认 3600 秒（1小时）</p>
          </div>
          <Button onClick={handleDirectAdd} disabled={submitting} className="bg-green-600 hover:bg-green-700">
            {submitting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Plus className="h-4 w-4 mr-2" />}
            添加 Token
          </Button>
        </CardContent>
      </Card>

      {/* Token 列表 */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <Key className="h-5 w-5" />
              已有 Token 账号
            </CardTitle>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={loadTokens}>
                <RefreshCw className="h-4 w-4 mr-1" />
                刷新列表
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : tokens.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              暂无 Token，请通过上方方式添加
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>#</TableHead>
                  <TableHead>Token</TableHead>
                  <TableHead>Refresh Token</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead>创建时间</TableHead>
                  <TableHead>启用</TableHead>
                  <TableHead className="text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tokens.map((token) => (
                  <TableRow key={token.index}>
                    <TableCell className="font-mono text-xs">
                      {token.index}
                    </TableCell>
                    <TableCell className="font-mono text-xs max-w-[200px] truncate">
                      {token.access_token || '-'}
                    </TableCell>
                    <TableCell className="text-xs">
                      {token.refresh_token === 'exists' ? (
                        <Badge variant="outline">有</Badge>
                      ) : (
                        <span className="text-muted-foreground">无</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {isTokenExpired(token) ? (
                        <Badge variant="destructive">
                          <XCircle className="h-3 w-3 mr-1" />
                          已过期
                        </Badge>
                      ) : (
                        <Badge variant="default" className="bg-green-600">
                          <CheckCircle className="h-3 w-3 mr-1" />
                          有效
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-sm">
                      {token.created || formatTimestamp(token.timestamp)}
                    </TableCell>
                    <TableCell>
                      <Switch
                        checked={token.enable}
                        onCheckedChange={() => handleToggleToken(token.index, token.enable)}
                      />
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="text-destructive hover:text-destructive"
                        onClick={() => {
                          setTokenToDelete(token.index)
                          setDeleteDialogOpen(true)
                        }}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* 删除确认对话框 */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>确认删除</DialogTitle>
            <DialogDescription>
              确定要删除这个 Token 吗？此操作无法撤销。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteDialogOpen(false)}>
              取消
            </Button>
            <Button variant="destructive" onClick={handleDeleteToken}>
              删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

