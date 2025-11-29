import { useLocation, Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { LogOut, Settings, Bell } from 'lucide-react'

interface HeaderProps {
  username?: string
}

const pageTitles: Record<string, string> = {
  '/admin': '首页',
  '/admin/tokens': 'Token 管理',
  '/admin/keys': '密钥管理',
  '/admin/announcements': '公告管理',
  '/admin/users': '用户管理',
  '/admin/ai': 'AI 管理',
  '/admin/test': 'API 测试',
  '/admin/docs': 'API 文档',
  '/admin/logs': '日志查看',
  '/admin/monitor': '系统监控',
  '/admin/settings': '系统设置',
}

export function Header({ username = '管理员' }: HeaderProps) {
  const location = useLocation()
  const title = pageTitles[location.pathname] || '页面'

  const handleLogout = () => {
    localStorage.removeItem('admin_token')
    window.location.href = '/admin/login'
  }

  return (
    <header className="sticky top-0 z-40 flex h-16 items-center justify-between border-b bg-background/95 backdrop-blur px-6 transition-all">
      <div className="flex flex-col gap-0.5">
        <h1 className="text-lg font-semibold text-foreground">{title}</h1>
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          <span>Workspace</span>
          <span>/</span>
          <span>{title}</span>
        </div>
      </div>

      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" className="h-9 w-9 text-muted-foreground hover:text-foreground">
          <Bell className="h-4 w-4" />
        </Button>
        
        <div className="h-4 w-px bg-border" />

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="relative h-9 w-9 rounded-full">
              <Avatar className="h-9 w-9">
                <AvatarFallback className="bg-primary/10 text-primary font-medium text-xs">
                  {username.slice(0, 1).toUpperCase()}
                </AvatarFallback>
              </Avatar>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-56" align="end" forceMount>
            <DropdownMenuLabel className="font-normal">
              <div className="flex flex-col space-y-1">
                <p className="text-sm font-medium leading-none">{username}</p>
                <p className="text-xs leading-none text-muted-foreground">
                  管理员
                </p>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild className="cursor-pointer">
              <Link to="/admin/settings">
                <Settings className="mr-2 h-4 w-4" />
                设置
              </Link>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="text-destructive focus:text-destructive cursor-pointer" onClick={handleLogout}>
              <LogOut className="mr-2 h-4 w-4" />
              退出登录
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  )
}
