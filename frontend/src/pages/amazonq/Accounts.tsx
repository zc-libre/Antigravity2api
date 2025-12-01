import { useEffect, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
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
} from '@/components/ui/dialog'
import { amazonqApi } from '@/services/api'
import {
  Users,
  RefreshCw,
  Eye,
  Loader2,
  CheckCircle,
  XCircle,
  Copy,
  Check,
} from 'lucide-react'

interface Account {
  email: string
  label?: string
  savedAt?: string
  hasRefreshToken: boolean
}

interface AccountDetail {
  email: string
  password: string
  clientId?: string
  clientSecret?: string
  accessToken?: string
  refreshToken?: string
  label?: string
  savedAt?: string
  expiresIn?: number
}

export function AmazonQAccounts() {
  const [accounts, setAccounts] = useState<Account[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedAccount, setSelectedAccount] = useState<AccountDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [copiedField, setCopiedField] = useState<string | null>(null)

  useEffect(() => {
    loadAccounts()
  }, [])

  const loadAccounts = async () => {
    try {
      setLoading(true)
      const res = await amazonqApi.getAccounts()
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

  const viewAccountDetail = async (email: string) => {
    setDialogOpen(true)
    setDetailLoading(true)
    try {
      const res = await amazonqApi.getAccountDetail(email)
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

  const formatDate = (dateStr?: string) => {
    if (!dateStr) return '-'
    return new Date(dateStr).toLocaleString('zh-CN')
  }

  const maskToken = (token?: string) => {
    if (!token) return '-'
    if (token.length <= 20) return token
    return `${token.slice(0, 10)}...${token.slice(-10)}`
  }

  return (
    <div className="space-y-6">
      {/* 账号列表 */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-gradient-to-br from-green-500 to-emerald-500">
                <Users className="h-5 w-5 text-white" />
              </div>
              <div>
                <CardTitle className="text-base">Amazon Q 账号列表</CardTitle>
                <CardDescription>已注册的所有 AWS Builder ID 账号</CardDescription>
              </div>
            </div>
            <Button variant="outline" size="sm" onClick={loadAccounts}>
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
          ) : accounts.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              暂无账号，请在任务管理中创建注册任务
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>邮箱</TableHead>
                  <TableHead>标签</TableHead>
                  <TableHead>Refresh Token</TableHead>
                  <TableHead>注册时间</TableHead>
                  <TableHead className="text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {accounts.map((account) => (
                  <TableRow key={account.email}>
                    <TableCell className="font-mono text-sm">
                      {account.email}
                    </TableCell>
                    <TableCell>
                      {account.label ? (
                        <Badge variant="outline">{account.label}</Badge>
                      ) : (
                        '-'
                      )}
                    </TableCell>
                    <TableCell>
                      {account.hasRefreshToken ? (
                        <Badge variant="success">
                          <CheckCircle className="h-3 w-3 mr-1" />
                          有
                        </Badge>
                      ) : (
                        <Badge variant="secondary">
                          <XCircle className="h-3 w-3 mr-1" />
                          无
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-sm">
                      {formatDate(account.savedAt)}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => viewAccountDetail(account.email)}
                      >
                        <Eye className="h-4 w-4 mr-1" />
                        详情
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* 账号详情对话框 */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>账号详情</DialogTitle>
            <DialogDescription>
              {selectedAccount?.email || '加载中...'}
            </DialogDescription>
          </DialogHeader>
          {detailLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : selectedAccount ? (
            <div className="space-y-4">
              <DetailItem
                label="邮箱"
                value={selectedAccount.email}
                onCopy={() => copyToClipboard(selectedAccount.email, 'email')}
                copied={copiedField === 'email'}
              />
              <DetailItem
                label="密码"
                value={selectedAccount.password}
                onCopy={() => copyToClipboard(selectedAccount.password, 'password')}
                copied={copiedField === 'password'}
                masked
              />
              {selectedAccount.clientId && (
                <DetailItem
                  label="Client ID"
                  value={selectedAccount.clientId}
                  onCopy={() => copyToClipboard(selectedAccount.clientId!, 'clientId')}
                  copied={copiedField === 'clientId'}
                />
              )}
              {selectedAccount.clientSecret && (
                <DetailItem
                  label="Client Secret"
                  value={maskToken(selectedAccount.clientSecret)}
                  onCopy={() => copyToClipboard(selectedAccount.clientSecret!, 'clientSecret')}
                  copied={copiedField === 'clientSecret'}
                />
              )}
              {selectedAccount.accessToken && (
                <DetailItem
                  label="Access Token"
                  value={maskToken(selectedAccount.accessToken)}
                  onCopy={() => copyToClipboard(selectedAccount.accessToken!, 'accessToken')}
                  copied={copiedField === 'accessToken'}
                />
              )}
              {selectedAccount.refreshToken && (
                <DetailItem
                  label="Refresh Token"
                  value={maskToken(selectedAccount.refreshToken)}
                  onCopy={() => copyToClipboard(selectedAccount.refreshToken!, 'refreshToken')}
                  copied={copiedField === 'refreshToken'}
                />
              )}
              <DetailItem
                label="标签"
                value={selectedAccount.label || '-'}
              />
              <DetailItem
                label="注册时间"
                value={formatDate(selectedAccount.savedAt)}
              />
              {selectedAccount.expiresIn && (
                <DetailItem
                  label="Token 有效期"
                  value={`${selectedAccount.expiresIn} 秒`}
                />
              )}
            </div>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              账号信息加载失败
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

interface DetailItemProps {
  label: string
  value: string
  onCopy?: () => void
  copied?: boolean
  masked?: boolean
}

function DetailItem({ label, value, onCopy, copied, masked }: DetailItemProps) {
  const [showValue, setShowValue] = useState(!masked)

  return (
    <div className="flex items-start justify-between gap-4 p-3 rounded-lg border">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-muted-foreground">{label}</p>
        <p className="text-sm font-mono break-all mt-1">
          {masked && !showValue ? '••••••••' : value}
        </p>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {masked && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowValue(!showValue)}
          >
            <Eye className="h-4 w-4" />
          </Button>
        )}
        {onCopy && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onCopy}
          >
            {copied ? (
              <Check className="h-4 w-4 text-green-500" />
            ) : (
              <Copy className="h-4 w-4" />
            )}
          </Button>
        )}
      </div>
    </div>
  )
}



