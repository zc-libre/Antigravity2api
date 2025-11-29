import { useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import {
  Home,
  Key,
  KeyRound,
  Megaphone,
  Users,
  Bot,
  TestTube,
  FileText,
  ScrollText,
  Activity,
  Settings,
  Moon,
  Sun,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Rocket,
  Cloud,
  ListTodo,
  type LucideIcon,
} from 'lucide-react'

interface SidebarProps {
  isCollapsed: boolean
  onToggle: () => void
  theme: 'light' | 'dark'
  onThemeToggle: () => void
  className?: string
}

interface NavItem {
  icon: LucideIcon
  label: string
  path: string
}

interface NavGroup {
  icon: LucideIcon
  label: string
  basePath: string
  children: NavItem[]
}

// 菜单结构：支持二级菜单
const navGroups: NavGroup[] = [
  {
    icon: Rocket,
    label: 'Antigravity',
    basePath: '/admin',
    children: [
      { icon: Home, label: '首页', path: '/admin' },
      { icon: Key, label: 'Token 管理', path: '/admin/tokens' },
      { icon: KeyRound, label: '密钥管理', path: '/admin/keys' },
      { icon: Megaphone, label: '公告管理', path: '/admin/announcements' },
      { icon: Users, label: '用户管理', path: '/admin/users' },
      { icon: Bot, label: 'AI 管理', path: '/admin/ai' },
      { icon: TestTube, label: 'API 测试', path: '/admin/test' },
      { icon: FileText, label: 'API 文档', path: '/admin/docs' },
      { icon: ScrollText, label: '日志查看', path: '/admin/logs' },
      { icon: Activity, label: '系统监控', path: '/admin/monitor' },
      { icon: Settings, label: '系统设置', path: '/admin/settings' },
    ],
  },
  {
    icon: Cloud,
    label: 'Amazon Q',
    basePath: '/amazonq',
    children: [
      { icon: Home, label: '概览', path: '/amazonq' },
      { icon: Users, label: '账号管理', path: '/amazonq/accounts' },
      { icon: ListTodo, label: '任务管理', path: '/amazonq/tasks' },
    ],
  },
]

export function Sidebar({ isCollapsed, onToggle, theme, onThemeToggle, className }: SidebarProps) {
  const location = useLocation()
  const [expandedGroups, setExpandedGroups] = useState<string[]>(['Antigravity']) // 默认展开 Antigravity

  const toggleGroup = (label: string) => {
    setExpandedGroups((prev) =>
      prev.includes(label) ? prev.filter((g) => g !== label) : [...prev, label]
    )
  }

  const isGroupActive = (group: NavGroup) => {
    return group.children.some(
      (item) =>
        location.pathname === item.path ||
        (item.path !== '/admin' && location.pathname.startsWith(item.path))
    )
  }

  const isItemActive = (item: NavItem) => {
    return (
      location.pathname === item.path ||
      (item.path !== '/admin' && location.pathname.startsWith(item.path))
    )
  }

  return (
    <TooltipProvider delayDuration={0}>
      <div
        className={cn(
          'relative flex flex-col transition-all duration-300 ease-in-out bg-card',
          isCollapsed ? 'w-[70px]' : 'w-64',
          className
        )}
      >
        {/* Logo */}
        <div className="flex h-16 items-center justify-center border-b px-4">
          {!isCollapsed ? (
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                <Rocket className="h-4 w-4" />
              </div>
              <span className="font-semibold text-lg tracking-tight">AI2API</span>
            </div>
          ) : (
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <Rocket className="h-4 w-4" />
            </div>
          )}
        </div>

        {/* Navigation */}
        <ScrollArea className="flex-1 py-4">
          <nav className="grid gap-1 px-2">
            {navGroups.map((group) => {
              const isExpanded = expandedGroups.includes(group.label)
              const groupActive = isGroupActive(group)

              if (isCollapsed) {
                // 收起状态：显示下拉菜单或只显示图标
                return (
                  <div key={group.label} className="flex justify-center">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className={cn(
                            'h-9 w-9 rounded-md',
                            groupActive && 'bg-accent text-accent-foreground'
                          )}
                          onClick={() => toggleGroup(group.label)}
                        >
                          <group.icon className="h-4 w-4" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent side="right" className="flex flex-col gap-1 p-2">
                        <span className="font-semibold mb-1 px-2">{group.label}</span>
                        {group.children.map((item) => (
                          <NavLink key={item.path} to={item.path}>
                            <div
                              className={cn(
                                'flex items-center gap-2 px-3 py-2 rounded-md text-sm transition-colors hover:bg-accent hover:text-accent-foreground',
                                isItemActive(item) && 'bg-accent text-accent-foreground font-medium'
                              )}
                            >
                              <item.icon className="h-4 w-4" />
                              {item.label}
                            </div>
                          </NavLink>
                        ))}
                      </TooltipContent>
                    </Tooltip>
                  </div>
                )
              }

              // 展开状态：显示二级菜单
              return (
                <div key={group.label} className="grid gap-1">
                  {/* 一级菜单 */}
                  <Button
                    variant="ghost"
                    className={cn(
                      'w-full justify-between h-9 px-3 font-medium hover:bg-accent hover:text-accent-foreground',
                      groupActive && !isExpanded && 'bg-accent/50 text-accent-foreground'
                    )}
                    onClick={() => toggleGroup(group.label)}
                  >
                    <div className="flex items-center gap-2">
                      <group.icon className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm">{group.label}</span>
                    </div>
                    <ChevronDown
                      className={cn(
                        'h-4 w-4 transition-transform duration-200 opacity-50',
                        isExpanded && 'rotate-180'
                      )}
                    />
                  </Button>

                  {/* 二级菜单 */}
                  {isExpanded && (
                    <div className="grid gap-1 pl-4 relative animate-in slide-in-from-top-2 duration-200">
                      <div className="absolute left-4 top-0 bottom-0 w-px bg-border/50" />
                      {group.children.map((item) => {
                        const isActive = isItemActive(item)
                        return (
                          <NavLink key={item.path} to={item.path}>
                            <Button
                              variant="ghost"
                              size="sm"
                              className={cn(
                                'w-full justify-start gap-2 h-9 px-3 relative ml-2',
                                isActive 
                                  ? 'bg-accent text-accent-foreground font-medium' 
                                  : 'text-muted-foreground hover:text-foreground hover:bg-transparent'
                              )}
                            >
                              {isActive && (
                                <div className="absolute -left-[13px] top-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full bg-primary" />
                              )}
                              <span className="text-sm">{item.label}</span>
                            </Button>
                          </NavLink>
                        )
                      })}
                    </div>
                  )}
                </div>
              )
            })}
          </nav>
        </ScrollArea>

        {/* Footer */}
        <div className="p-4 border-t mt-auto">
          <div className={cn(
            'flex items-center gap-2', 
            isCollapsed ? 'flex-col' : 'justify-between'
          )}>
             <Button 
              variant="ghost" 
              size="icon" 
              onClick={onThemeToggle}
              className="h-8 w-8"
            >
              {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </Button>
            {!isCollapsed && <Separator orientation="vertical" className="h-4" />}
            <Button 
              variant="ghost" 
              size="icon" 
              onClick={onToggle}
              className="h-8 w-8"
            >
              {isCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
            </Button>
          </div>
        </div>
      </div>
    </TooltipProvider>
  )
}
