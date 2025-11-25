import { useEffect, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Separator } from '@/components/ui/separator'
import { userApi } from '@/services/api'
import {
  User,
  Lock,
  Save,
  Loader2,
  Key,
  Activity,
  Calendar,
} from 'lucide-react'

interface UserProfile {
  username: string
  created_at: string
  keys_count: number
  tokens_count: number
  total_requests: number
}

export function UserAccount() {
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [loading, setLoading] = useState(true)
  const [oldPassword, setOldPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  useEffect(() => {
    loadProfile()
  }, [])

  const loadProfile = async () => {
    try {
      const res = await userApi.getProfile()
      if (res.success && res.data) {
        setProfile(res.data as UserProfile)
      }
    } catch (error) {
      console.error('Failed to load profile:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!oldPassword || !newPassword) {
      setMessage({ type: 'error', text: '请填写旧密码和新密码' })
      return
    }
    
    if (newPassword !== confirmPassword) {
      setMessage({ type: 'error', text: '两次输入的新密码不一致' })
      return
    }
    
    if (newPassword.length < 6) {
      setMessage({ type: 'error', text: '新密码长度至少为 6 位' })
      return
    }

    setSaving(true)
    setMessage(null)

    try {
      const res = await userApi.changePassword(oldPassword, newPassword)
      if (res.success) {
        setMessage({ type: 'success', text: '密码修改成功' })
        setOldPassword('')
        setNewPassword('')
        setConfirmPassword('')
      } else {
        setMessage({ type: 'error', text: res.error || '密码修改失败' })
      }
    } catch (error) {
      setMessage({ type: 'error', text: '密码修改失败' })
    } finally {
      setSaving(false)
    }
  }

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleString('zh-CN')
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {message && (
        <Alert variant={message.type === 'error' ? 'destructive' : 'default'}>
          <AlertDescription>{message.text}</AlertDescription>
        </Alert>
      )}

      {/* 账户信息 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <User className="h-5 w-5" />
            账户信息
          </CardTitle>
          <CardDescription>
            查看您的账户基本信息
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label>用户名</Label>
              <div className="p-3 bg-muted rounded-lg">
                <span className="font-medium">{profile?.username || '-'}</span>
              </div>
            </div>
            <div className="space-y-2">
              <Label>注册时间</Label>
              <div className="p-3 bg-muted rounded-lg flex items-center gap-2">
                <Calendar className="h-4 w-4 text-muted-foreground" />
                <span>{profile?.created_at ? formatDate(profile.created_at) : '-'}</span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 账户统计 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Activity className="h-5 w-5" />
            账户统计
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-3">
            <div className="p-4 border rounded-lg text-center">
              <Key className="h-6 w-6 mx-auto mb-2 text-muted-foreground" />
              <p className="text-2xl font-bold">{profile?.keys_count || 0}</p>
              <p className="text-sm text-muted-foreground">API 密钥数</p>
            </div>
            <div className="p-4 border rounded-lg text-center">
              <Key className="h-6 w-6 mx-auto mb-2 text-muted-foreground" />
              <p className="text-2xl font-bold">{profile?.tokens_count || 0}</p>
              <p className="text-sm text-muted-foreground">共享 Token 数</p>
            </div>
            <div className="p-4 border rounded-lg text-center">
              <Activity className="h-6 w-6 mx-auto mb-2 text-muted-foreground" />
              <p className="text-2xl font-bold">{profile?.total_requests || 0}</p>
              <p className="text-sm text-muted-foreground">总请求数</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 修改密码 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Lock className="h-5 w-5" />
            修改密码
          </CardTitle>
          <CardDescription>
            更改您的账户密码
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleChangePassword} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="old-password">当前密码</Label>
              <Input
                id="old-password"
                type="password"
                value={oldPassword}
                onChange={(e) => setOldPassword(e.target.value)}
                placeholder="请输入当前密码"
              />
            </div>

            <Separator />

            <div className="space-y-2">
              <Label htmlFor="new-password">新密码</Label>
              <Input
                id="new-password"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="请输入新密码（至少6位）"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="confirm-password">确认新密码</Label>
              <Input
                id="confirm-password"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="请再次输入新密码"
              />
            </div>

            <Button type="submit" disabled={saving}>
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <Save className="h-4 w-4 mr-2" />
              )}
              修改密码
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}

