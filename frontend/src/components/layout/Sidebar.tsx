import { useState, useEffect } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
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
  PanelLeftClose,
  PanelLeft,
  ChevronDown,
  Rocket,
  Cloud,
  ListTodo,
  Sparkles,
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
  accentColor: string
}

// 菜单结构：支持二级菜单
const navGroups: NavGroup[] = [
  {
    icon: Rocket,
    label: 'Antigravity',
    basePath: '/admin',
    accentColor: 'from-orange-500 to-amber-500',
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
    accentColor: 'from-cyan-500 to-blue-500',
    children: [
      { icon: Home, label: '概览', path: '/amazonq' },
      { icon: Users, label: '账号管理', path: '/amazonq/accounts' },
      { icon: ListTodo, label: '任务管理', path: '/amazonq/tasks' },
    ],
  },
  {
    icon: Sparkles,
    label: 'Kiro',
    basePath: '/kiro',
    accentColor: 'from-violet-500 to-purple-500',
    children: [
      { icon: Home, label: '概览', path: '/kiro' },
      { icon: Users, label: '账号管理', path: '/kiro/accounts' },
    ],
  },
]

export function Sidebar({ isCollapsed, onToggle, theme, onThemeToggle, className }: SidebarProps) {
  const location = useLocation()
  
  // 根据当前路径自动展开对应的菜单组
  const getInitialExpandedGroups = () => {
    const activeGroup = navGroups.find((g) => location.pathname.startsWith(g.basePath))
    return activeGroup ? [activeGroup.label] : [navGroups[0].label]
  }
  
  const [expandedGroups, setExpandedGroups] = useState<string[]>(getInitialExpandedGroups)

  // 路由变化时自动展开对应组
  useEffect(() => {
    const activeGroup = navGroups.find((g) => location.pathname.startsWith(g.basePath))
    if (activeGroup && !expandedGroups.includes(activeGroup.label)) {
      setExpandedGroups((prev) => [...prev, activeGroup.label])
    }
  }, [location.pathname])

  const toggleGroup = (label: string) => {
    setExpandedGroups((prev) =>
      prev.includes(label) ? prev.filter((g) => g !== label) : [...prev, label]
    )
  }

  const isGroupActive = (group: NavGroup) => {
    return location.pathname.startsWith(group.basePath)
  }

  // 自动从 navGroups 中提取所有一级菜单的根路径
  const rootPaths = navGroups.map((g) => g.basePath)

  const isItemActive = (item: NavItem) => {
    // 对于根路径，只有精确匹配才算选中
    const isRootPath = rootPaths.includes(item.path)
    return (
      location.pathname === item.path ||
      (!isRootPath && location.pathname.startsWith(item.path))
    )
  }

  return (
    <TooltipProvider delayDuration={0}>
      <aside
        className={cn(
          'group/sidebar relative flex flex-col h-full',
          'transition-all duration-300 ease-out',
          'sidebar-glass',
          isCollapsed ? 'w-[72px]' : 'w-[260px]',
          className
        )}
      >
        {/* 装饰性背景元素 */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute -top-24 -left-24 w-48 h-48 bg-gradient-to-br from-primary/5 to-transparent rounded-full blur-3xl" />
          <div className="absolute -bottom-24 -right-24 w-48 h-48 bg-gradient-to-tl from-primary/5 to-transparent rounded-full blur-3xl" />
        </div>

        {/* Logo 区域 */}
        <div className={cn(
          'relative flex items-center h-16 border-b border-border/50',
          isCollapsed ? 'justify-center px-3' : 'px-5'
        )}>
          <div className={cn(
            'flex items-center gap-3 transition-all duration-300',
            isCollapsed && 'gap-0'
          )}>
            <div className="relative flex-shrink-0">
              <div className="absolute inset-0 bg-gradient-to-br from-orange-500 to-amber-500 rounded-xl blur-lg opacity-40 animate-pulse" />
              <div className="relative flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-orange-500 to-amber-500 shadow-lg">
                <Sparkles className="h-5 w-5 text-white" />
              </div>
            </div>
            <div className={cn(
              'flex flex-col transition-all duration-300 overflow-hidden',
              isCollapsed ? 'w-0 opacity-0' : 'w-auto opacity-100'
            )}>
              <span className="font-bold text-lg tracking-tight bg-gradient-to-r from-foreground to-foreground/70 bg-clip-text">
                AI2API
              </span>
              <span className="text-[10px] text-muted-foreground font-medium tracking-wider uppercase">
                Control Panel
              </span>
            </div>
          </div>
        </div>

        {/* 导航区域 */}
        <ScrollArea className="flex-1 py-4">
          <nav className={cn('grid gap-2', isCollapsed ? 'px-2' : 'px-3')}>
            {navGroups.map((group, groupIndex) => {
              const isExpanded = expandedGroups.includes(group.label)
              const groupActive = isGroupActive(group)

              if (isCollapsed) {
                // 收起状态：显示图标和 tooltip 菜单
                return (
                  <div key={group.label} className="relative">
                    {groupIndex > 0 && (
                      <div className="my-2 mx-2 h-px bg-border/50" />
                    )}
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          className={cn(
                            'w-full flex items-center justify-center h-11 rounded-xl',
                            'transition-all duration-200',
                            groupActive
                              ? 'bg-gradient-to-r ' + group.accentColor + ' text-white shadow-lg shadow-primary/20'
                              : 'hover:bg-accent text-muted-foreground hover:text-foreground'
                          )}
                        >
                          <group.icon className="h-5 w-5" />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent 
                        side="right" 
                        align="start"
                        sideOffset={12}
                        className="p-0 w-56 bg-popover/95 backdrop-blur-xl border-border/50 shadow-2xl rounded-xl overflow-hidden"
                      >
                        <div className={cn(
                          'px-4 py-3 bg-gradient-to-r',
                          group.accentColor,
                          'text-white'
                        )}>
                          <div className="flex items-center gap-2">
                            <group.icon className="h-4 w-4" />
                            <span className="font-semibold text-sm">{group.label}</span>
                          </div>
                        </div>
                        <div className="p-2">
                          {group.children.map((item) => (
                            <NavLink key={item.path} to={item.path}>
                              <div
                                className={cn(
                                  'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm',
                                  'transition-all duration-200',
                                  isItemActive(item) 
                                    ? 'bg-accent text-foreground font-medium' 
                                    : 'text-muted-foreground hover:text-foreground hover:bg-accent/50'
                                )}
                              >
                                <item.icon className="h-4 w-4 flex-shrink-0" />
                                <span>{item.label}</span>
                                {isItemActive(item) && (
                                  <div className={cn(
                                    'ml-auto w-1.5 h-1.5 rounded-full bg-gradient-to-r',
                                    group.accentColor
                                  )} />
                                )}
                              </div>
                            </NavLink>
                          ))}
                        </div>
                      </TooltipContent>
                    </Tooltip>
                  </div>
                )
              }

              // 展开状态：显示完整的二级菜单
              return (
                <div key={group.label}>
                  {groupIndex > 0 && (
                    <div className="my-3 mx-2 h-px bg-border/50" />
                  )}
                  
                  {/* 一级菜单标题 */}
                  <button
                    className={cn(
                      'w-full flex items-center justify-between px-3 py-2.5 rounded-xl',
                      'transition-all duration-200 group/item',
                      groupActive 
                        ? 'text-foreground' 
                        : 'text-muted-foreground hover:text-foreground'
                    )}
                    onClick={() => toggleGroup(group.label)}
                  >
                    <div className="flex items-center gap-3">
                      <div className={cn(
                        'flex h-8 w-8 items-center justify-center rounded-lg transition-all duration-200',
                        groupActive
                          ? 'bg-gradient-to-br ' + group.accentColor + ' text-white shadow-md'
                          : 'bg-accent/50 text-muted-foreground group-hover/item:bg-accent'
                      )}>
                        <group.icon className="h-4 w-4" />
                      </div>
                      <span className="font-semibold text-sm">{group.label}</span>
                    </div>
                    <ChevronDown
                      className={cn(
                        'h-4 w-4 transition-transform duration-300',
                        isExpanded ? 'rotate-180' : 'rotate-0',
                        'text-muted-foreground'
                      )}
                    />
                  </button>

                  {/* 二级菜单项 */}
                  <div
                    className={cn(
                      'overflow-hidden transition-all duration-300 ease-out',
                      isExpanded ? 'max-h-[600px] opacity-100' : 'max-h-0 opacity-0'
                    )}
                  >
                    <div className="mt-1 ml-5 pl-4 border-l-2 border-border/50 space-y-0.5">
                      {group.children.map((item) => {
                        const isActive = isItemActive(item)
                        return (
                          <NavLink key={item.path} to={item.path}>
                            <div
                              className={cn(
                                'relative flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm',
                                'transition-all duration-200',
                                isActive
                                  ? 'bg-accent text-foreground font-medium'
                                  : 'text-muted-foreground hover:text-foreground hover:bg-accent/50'
                              )}
                            >
                              {/* 激活指示器 */}
                              {isActive && (
                                <div className={cn(
                                  'absolute -left-[18px] top-1/2 -translate-y-1/2',
                                  'w-1 h-6 rounded-full bg-gradient-to-b',
                                  group.accentColor
                                )} />
                              )}
                              <item.icon className={cn(
                                'h-4 w-4 flex-shrink-0 transition-colors duration-200',
                                isActive ? 'text-foreground' : ''
                              )} />
                              <span>{item.label}</span>
                            </div>
                          </NavLink>
                        )
                      })}
                    </div>
                  </div>
                </div>
              )
            })}
          </nav>
        </ScrollArea>

        {/* 底部工具栏 */}
        <div className="relative p-3 border-t border-border/50">
          <div className={cn(
            'flex items-center gap-1 p-1 rounded-xl bg-accent/50',
            isCollapsed ? 'flex-col' : 'justify-between'
          )}>
            {/* 主题切换 */}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button 
                  variant="ghost" 
                  size="icon"
                  onClick={onThemeToggle}
                  className={cn(
                    'h-9 w-9 rounded-lg transition-all duration-200',
                    'hover:bg-background hover:shadow-sm',
                    isCollapsed && 'w-full justify-center'
                  )}
                >
                  <div className="relative">
                    <Sun className={cn(
                      'h-4 w-4 transition-all duration-300',
                      theme === 'dark' 
                        ? 'rotate-0 scale-100 text-amber-500' 
                        : 'rotate-90 scale-0 absolute'
                    )} />
                    <Moon className={cn(
                      'h-4 w-4 transition-all duration-300',
                      theme === 'light' 
                        ? 'rotate-0 scale-100 text-blue-500' 
                        : '-rotate-90 scale-0 absolute'
                    )} />
                  </div>
                </Button>
              </TooltipTrigger>
              <TooltipContent side={isCollapsed ? 'right' : 'top'}>
                {theme === 'dark' ? '切换到浅色模式' : '切换到深色模式'}
              </TooltipContent>
            </Tooltip>

            {/* 展开/收起 */}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button 
                  variant="ghost" 
                  size="icon"
                  onClick={onToggle}
                  className={cn(
                    'h-9 w-9 rounded-lg transition-all duration-200',
                    'hover:bg-background hover:shadow-sm',
                    isCollapsed && 'w-full justify-center'
                  )}
                >
                  <div className="relative">
                    <PanelLeftClose className={cn(
                      'h-4 w-4 transition-all duration-300',
                      !isCollapsed 
                        ? 'rotate-0 scale-100' 
                        : 'rotate-180 scale-0 absolute'
                    )} />
                    <PanelLeft className={cn(
                      'h-4 w-4 transition-all duration-300',
                      isCollapsed 
                        ? 'rotate-0 scale-100' 
                        : '-rotate-180 scale-0 absolute'
                    )} />
                  </div>
                </Button>
              </TooltipTrigger>
              <TooltipContent side={isCollapsed ? 'right' : 'top'}>
                {isCollapsed ? '展开侧边栏' : '收起侧边栏'}
              </TooltipContent>
            </Tooltip>
          </div>

          {/* 版本信息 */}
          {!isCollapsed && (
            <div className="mt-3 px-2 text-center">
              <span className="text-[10px] text-muted-foreground/60 font-medium tracking-wider">
                v1.0.0 · Built with ♥
              </span>
            </div>
          )}
        </div>
      </aside>
    </TooltipProvider>
  )
}
