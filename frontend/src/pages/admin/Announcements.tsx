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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
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
  Megaphone,
  Plus,
  Trash2,
  RefreshCw,
  Pin,
  Loader2,
  ImagePlus,
  X,
} from 'lucide-react'

interface Announcement {
  id: string
  title: string
  content: string
  type: 'info' | 'success' | 'warning' | 'danger'
  pinned: boolean
  images?: string[]
  created_at: string
}

const typeLabels: Record<string, { label: string; color: string }> = {
  info: { label: '信息', color: 'blue' },
  success: { label: '成功', color: 'green' },
  warning: { label: '警告', color: 'yellow' },
  danger: { label: '危险', color: 'red' },
}

export function Announcements() {
  const [announcements, setAnnouncements] = useState<Announcement[]>([])
  const [loading, setLoading] = useState(true)
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [type, setType] = useState<string>('info')
  const [pinned, setPinned] = useState(false)
  const [images, setImages] = useState<File[]>([])
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [announcementToDelete, setAnnouncementToDelete] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    loadAnnouncements()
  }, [])

  const loadAnnouncements = async () => {
    try {
      const res = await adminApi.getAnnouncements()
      if (res.success && res.data) {
        setAnnouncements(res.data as Announcement[])
      }
    } catch (error) {
      console.error('Failed to load announcements:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleCreate = async () => {
    if (!title || !content) {
      setMessage({ type: 'error', text: '请填写公告标题和内容' })
      return
    }

    setSubmitting(true)
    try {
      // 先上传图片
      const imageUrls: string[] = []
      if (images.length > 0) {
        for (const file of images) {
          try {
            const uploadResult = await adminApi.uploadAnnouncementImage(file)
            if (uploadResult.url) {
              imageUrls.push(uploadResult.url)
            }
          } catch (e) {
            console.error('图片上传失败:', e)
          }
        }
      }

      // 然后创建公告
      const res = await adminApi.createAnnouncement({
        title,
        content,
        type,
        pinned,
        images: imageUrls,
      })
      if (res.success) {
        setMessage({ type: 'success', text: '公告发布成功' })
        setTitle('')
        setContent('')
        setType('info')
        setPinned(false)
        setImages([])
        loadAnnouncements()
      } else {
        setMessage({ type: 'error', text: res.error || '公告发布失败' })
      }
    } catch (error) {
      setMessage({ type: 'error', text: '公告发布失败' })
    } finally {
      setSubmitting(false)
    }
  }

  const handleDelete = async () => {
    if (!announcementToDelete) return

    try {
      const res = await adminApi.deleteAnnouncement(announcementToDelete)
      if (res.success) {
        setMessage({ type: 'success', text: '公告删除成功' })
        loadAnnouncements()
      } else {
        setMessage({ type: 'error', text: res.error || '公告删除失败' })
      }
    } catch (error) {
      setMessage({ type: 'error', text: '公告删除失败' })
    } finally {
      setDeleteDialogOpen(false)
      setAnnouncementToDelete(null)
    }
  }

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || [])
    if (images.length + files.length > 5) {
      setMessage({ type: 'error', text: '最多只能上传5张图片' })
      return
    }
    setImages([...images, ...files])
  }

  const removeImage = (index: number) => {
    setImages(images.filter((_, i) => i !== index))
  }

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleString('zh-CN')
  }

  const getTypeBadgeVariant = (type: string) => {
    switch (type) {
      case 'success':
        return 'success'
      case 'warning':
        return 'warning'
      case 'danger':
        return 'destructive'
      default:
        return 'default'
    }
  }

  return (
    <div className="space-y-6">
      {message && (
        <Alert variant={message.type === 'error' ? 'destructive' : 'default'}>
          <AlertDescription>{message.text}</AlertDescription>
        </Alert>
      )}

      {/* 创建公告 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Plus className="h-5 w-5" />
            创建新公告
          </CardTitle>
          <CardDescription>
            发布新的系统公告，通知所有用户
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>公告标题 <span className="text-destructive">*</span></Label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="请输入公告标题"
            />
          </div>

          <div className="space-y-2">
            <Label>公告内容 <span className="text-destructive">*</span></Label>
            <Textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="请输入公告内容，支持换行"
              rows={6}
            />
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label>公告类型</Label>
              <Select value={type} onValueChange={setType}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="info">信息 (蓝色)</SelectItem>
                  <SelectItem value="success">成功 (绿色)</SelectItem>
                  <SelectItem value="warning">警告 (黄色)</SelectItem>
                  <SelectItem value="danger">危险 (红色)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>置顶公告</Label>
              <div className="flex items-center gap-2 pt-2">
                <Switch checked={pinned} onCheckedChange={setPinned} />
                <span className="text-sm text-muted-foreground">
                  {pinned ? '已置顶' : '未置顶'}
                </span>
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <Label>上传图片（可选，最多5张）</Label>
            <div className="flex flex-wrap gap-2">
              {images.map((file, index) => (
                <div key={index} className="relative">
                  <img
                    src={URL.createObjectURL(file)}
                    alt={`预览 ${index + 1}`}
                    className="w-20 h-20 object-cover rounded-lg border"
                  />
                  <Button
                    variant="destructive"
                    size="icon"
                    className="absolute -top-2 -right-2 h-6 w-6"
                    onClick={() => removeImage(index)}
                  >
                    <X className="h-3 w-3" />
                  </Button>
                </div>
              ))}
              {images.length < 5 && (
                <label className="w-20 h-20 flex items-center justify-center border-2 border-dashed rounded-lg cursor-pointer hover:border-primary transition-colors">
                  <ImagePlus className="h-6 w-6 text-muted-foreground" />
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    className="hidden"
                    onChange={handleImageChange}
                  />
                </label>
              )}
            </div>
            <p className="text-sm text-muted-foreground">
              支持 JPG, PNG, GIF, WEBP 等格式，每张图片最大 10MB
            </p>
          </div>

          <Button onClick={handleCreate} disabled={submitting}>
            {submitting ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : (
              <Megaphone className="h-4 w-4 mr-2" />
            )}
            发布公告
          </Button>
        </CardContent>
      </Card>

      {/* 公告列表 */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <Megaphone className="h-5 w-5" />
              所有公告
            </CardTitle>
            <Button variant="outline" size="sm" onClick={loadAnnouncements}>
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
          ) : announcements.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              暂无公告
            </div>
          ) : (
            <div className="space-y-4">
              {announcements.map((announcement) => (
                <div
                  key={announcement.id}
                  className="p-4 border rounded-lg space-y-3"
                >
                  <div className="flex items-start justify-between">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <h4 className="font-semibold">{announcement.title}</h4>
                        {announcement.pinned && (
                          <Pin className="h-4 w-4 text-orange-500" />
                        )}
                        <Badge variant={getTypeBadgeVariant(announcement.type)}>
                          {typeLabels[announcement.type]?.label || announcement.type}
                        </Badge>
                      </div>
                      <p className="text-sm text-muted-foreground">
                        {formatDate(announcement.created_at)}
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-destructive hover:text-destructive"
                      onClick={() => {
                        setAnnouncementToDelete(announcement.id)
                        setDeleteDialogOpen(true)
                      }}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                  <p className="text-sm whitespace-pre-wrap">{announcement.content}</p>
                  {announcement.images && announcement.images.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {announcement.images.map((img, index) => (
                        <img
                          key={index}
                          src={img}
                          alt={`图片 ${index + 1}`}
                          className="w-24 h-24 object-cover rounded-lg border"
                        />
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* 删除确认对话框 */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>确认删除</DialogTitle>
            <DialogDescription>
              确定要删除这条公告吗？此操作无法撤销。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteDialogOpen(false)}>
              取消
            </Button>
            <Button variant="destructive" onClick={handleDelete}>
              删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

