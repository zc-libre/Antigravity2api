import { useEffect, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Separator } from '@/components/ui/separator'
import { adminApi } from '@/services/api'
import {
  Save,
  Loader2,
  Shield,
  Palette,
  Database,
} from 'lucide-react'

interface SystemSettings {
  site_name: string
  allow_registration: boolean
  require_email_verification: boolean
  max_keys_per_user: number
  max_tokens_per_user: number
  default_rate_limit: {
    enabled: boolean
    max_requests: number
    window_seconds: number
  }
  maintenance_mode: boolean
  announcement_enabled: boolean
}

export function Settings() {
  const [settings, setSettings] = useState<SystemSettings>({
    site_name: 'Antigravity API',
    allow_registration: true,
    require_email_verification: false,
    max_keys_per_user: 5,
    max_tokens_per_user: 10,
    default_rate_limit: {
      enabled: false,
      max_requests: 100,
      window_seconds: 60,
    },
    maintenance_mode: false,
    announcement_enabled: true,
  })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  useEffect(() => {
    loadSettings()
  }, [])

  const loadSettings = async () => {
    try {
      const res = await adminApi.getSettings()
      if (res.success && res.data) {
        const data = res.data as Partial<SystemSettings>
        // 合并默认值，确保所有字段都存在
        setSettings(prev => ({
          ...prev,
          ...data,
          default_rate_limit: {
            enabled: false,
            max_requests: 100,
            window_seconds: 60,
            ...data.default_rate_limit,
          },
        }))
      }
    } catch (error) {
      console.error('Failed to load settings:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      const res = await adminApi.updateSettings(settings)
      if (res.success) {
        setMessage({ type: 'success', text: '设置保存成功' })
      } else {
        setMessage({ type: 'error', text: res.error || '设置保存失败' })
      }
    } catch (error) {
      setMessage({ type: 'error', text: '设置保存失败' })
    } finally {
      setSaving(false)
    }
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

      {/* 基本设置 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Palette className="h-5 w-5" />
            基本设置
          </CardTitle>
          <CardDescription>
            配置系统基本信息
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>站点名称</Label>
            <Input
              value={settings.site_name}
              onChange={(e) => setSettings({ ...settings, site_name: e.target.value })}
              placeholder="Antigravity API"
            />
          </div>

          <div className="flex items-center justify-between">
            <div>
              <Label>维护模式</Label>
              <p className="text-sm text-muted-foreground">
                开启后将显示维护页面，禁止访问
              </p>
            </div>
            <Switch
              checked={settings.maintenance_mode}
              onCheckedChange={(checked) => setSettings({ ...settings, maintenance_mode: checked })}
            />
          </div>

          <div className="flex items-center justify-between">
            <div>
              <Label>显示公告</Label>
              <p className="text-sm text-muted-foreground">
                在用户界面显示系统公告
              </p>
            </div>
            <Switch
              checked={settings.announcement_enabled}
              onCheckedChange={(checked) => setSettings({ ...settings, announcement_enabled: checked })}
            />
          </div>
        </CardContent>
      </Card>

      {/* 用户设置 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5" />
            用户设置
          </CardTitle>
          <CardDescription>
            配置用户注册和权限
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <Label>允许注册</Label>
              <p className="text-sm text-muted-foreground">
                允许新用户注册账号
              </p>
            </div>
            <Switch
              checked={settings.allow_registration}
              onCheckedChange={(checked) => setSettings({ ...settings, allow_registration: checked })}
            />
          </div>

          <div className="flex items-center justify-between">
            <div>
              <Label>邮箱验证</Label>
              <p className="text-sm text-muted-foreground">
                注册时需要验证邮箱
              </p>
            </div>
            <Switch
              checked={settings.require_email_verification}
              onCheckedChange={(checked) =>
                setSettings({ ...settings, require_email_verification: checked })
              }
            />
          </div>

          <Separator />

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label>每用户最大密钥数</Label>
              <Input
                type="number"
                value={settings.max_keys_per_user}
                onChange={(e) =>
                  setSettings({ ...settings, max_keys_per_user: parseInt(e.target.value) || 5 })
                }
                min="1"
              />
            </div>
            <div className="space-y-2">
              <Label>每用户最大 Token 数</Label>
              <Input
                type="number"
                value={settings.max_tokens_per_user}
                onChange={(e) =>
                  setSettings({ ...settings, max_tokens_per_user: parseInt(e.target.value) || 10 })
                }
                min="1"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 频率限制 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Database className="h-5 w-5" />
            默认频率限制
          </CardTitle>
          <CardDescription>
            新密钥的默认频率限制设置
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <Label>启用默认限制</Label>
              <p className="text-sm text-muted-foreground">
                为新创建的密钥自动应用频率限制
              </p>
            </div>
            <Switch
              checked={settings.default_rate_limit?.enabled ?? false}
              onCheckedChange={(checked) =>
                setSettings({
                  ...settings,
                  default_rate_limit: { 
                    enabled: false,
                    max_requests: 100,
                    window_seconds: 60,
                    ...settings.default_rate_limit, 
                    enabled: checked 
                  },
                })
              }
            />
          </div>

          {settings.default_rate_limit?.enabled && (
            <div className="grid gap-4 md:grid-cols-2 p-4 border rounded-lg bg-muted/50">
              <div className="space-y-2">
                <Label>最大请求数</Label>
                <Input
                  type="number"
                  value={settings.default_rate_limit?.max_requests ?? 100}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      default_rate_limit: {
                        enabled: false,
                        max_requests: 100,
                        window_seconds: 60,
                        ...settings.default_rate_limit,
                        max_requests: parseInt(e.target.value) || 100,
                      },
                    })
                  }
                  min="1"
                />
              </div>
              <div className="space-y-2">
                <Label>时间窗口（秒）</Label>
                <Input
                  type="number"
                  value={settings.default_rate_limit?.window_seconds ?? 60}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      default_rate_limit: {
                        enabled: false,
                        max_requests: 100,
                        window_seconds: 60,
                        ...settings.default_rate_limit,
                        window_seconds: parseInt(e.target.value) || 60,
                      },
                    })
                  }
                  min="1"
                />
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* 保存按钮 */}
      <div className="flex justify-end">
        <Button onClick={handleSave} disabled={saving}>
          {saving ? (
            <Loader2 className="h-4 w-4 animate-spin mr-2" />
          ) : (
            <Save className="h-4 w-4 mr-2" />
          )}
          保存设置
        </Button>
      </div>
    </div>
  )
}

