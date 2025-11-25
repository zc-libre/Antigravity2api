import { useState, useEffect } from 'react'
import { Outlet, useNavigate } from 'react-router-dom'
import { Sidebar } from './Sidebar'
import { Header } from './Header'
import { useTheme } from '@/hooks/useTheme'
import { cn } from '@/lib/utils'
import { adminApi, userApi } from '@/services/api'
import { Loader2 } from 'lucide-react'

interface MainLayoutProps {
  type: 'admin' | 'user'
}

export function MainLayout({ type }: MainLayoutProps) {
  const [isCollapsed, setIsCollapsed] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const { theme, toggleTheme } = useTheme()
  const navigate = useNavigate()

  useEffect(() => {
    const checkAuth = async () => {
      try {
        if (type === 'admin') {
          const token = localStorage.getItem('admin_token')
          if (!token) {
            navigate('/admin/login', { replace: true })
            return
          }
          const res = await adminApi.verifyToken()
          if (!res.success) {
            localStorage.removeItem('admin_token')
            navigate('/admin/login', { replace: true })
            return
          }
        } else {
          const token = localStorage.getItem('user_token')
          if (!token) {
            navigate('/login', { replace: true })
            return
          }
          const res = await userApi.verifyToken()
          if (!res.success) {
            localStorage.removeItem('user_token')
            navigate('/login', { replace: true })
            return
          }
        }
        setIsAuthenticated(true)
      } catch {
        if (type === 'admin') {
          navigate('/admin/login', { replace: true })
        } else {
          navigate('/login', { replace: true })
        }
      } finally {
        setIsLoading(false)
      }
    }

    checkAuth()
  }, [type, navigate])

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-muted-foreground">验证登录状态...</p>
        </div>
      </div>
    )
  }

  if (!isAuthenticated) {
    return null
  }

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar
        isCollapsed={isCollapsed}
        onToggle={() => setIsCollapsed(!isCollapsed)}
        theme={theme}
        onThemeToggle={toggleTheme}
        type={type}
      />
      <div className="flex flex-1 flex-col overflow-hidden">
        <Header type={type} />
        <main className={cn(
          'flex-1 overflow-auto bg-muted/30 p-6',
          'transition-all duration-300'
        )}>
          <Outlet />
        </main>
      </div>
    </div>
  )
}

