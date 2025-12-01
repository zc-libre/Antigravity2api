import { useState } from 'react'
import { Outlet } from 'react-router-dom'
import { Sidebar } from './Sidebar'
import { Header } from './Header'
import { useTheme } from '@/hooks/useTheme'

export function MainLayout() {
  const [isCollapsed, setIsCollapsed] = useState(false)
  const { theme, toggleTheme } = useTheme()

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {/* 侧边栏 */}
      <Sidebar
        isCollapsed={isCollapsed}
        onToggle={() => setIsCollapsed(!isCollapsed)}
        theme={theme}
        onThemeToggle={toggleTheme}
        className="border-r border-border/40 shadow-sm"
      />
      
      {/* 主内容区 */}
      <div className="flex flex-1 flex-col overflow-hidden transition-all duration-300 ease-out">
        <Header />
        <main className="flex-1 overflow-y-auto p-8 scroll-smooth">
          <div className="mx-auto max-w-6xl">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  )
}
