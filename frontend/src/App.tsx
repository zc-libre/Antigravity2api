import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { MainLayout } from '@/components/layout/MainLayout'

// Admin pages
import { AdminLogin } from '@/pages/admin/Login'
import { Dashboard } from '@/pages/admin/Dashboard'
import { TokenManage } from '@/pages/admin/TokenManage'
import { KeyManage } from '@/pages/admin/KeyManage'
import { Announcements } from '@/pages/admin/Announcements'
import { UserManage } from '@/pages/admin/UserManage'
import { AIManage } from '@/pages/admin/AIManage'
import { ApiTest } from '@/pages/admin/ApiTest'
import { ApiDocs } from '@/pages/admin/ApiDocs'
import { Logs } from '@/pages/admin/Logs'
import { Monitor } from '@/pages/admin/Monitor'
import { Settings } from '@/pages/admin/Settings'

// Amazon Q pages
import { AmazonQDashboard } from '@/pages/amazonq/Dashboard'
import { AmazonQAccounts } from '@/pages/amazonq/Accounts'
import { AmazonQTasks } from '@/pages/amazonq/Tasks'

function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Admin routes */}
        <Route path="/admin/login" element={<AdminLogin />} />
        <Route path="/admin" element={<MainLayout />}>
          <Route index element={<Dashboard />} />
          <Route path="tokens" element={<TokenManage />} />
          <Route path="keys" element={<KeyManage />} />
          <Route path="announcements" element={<Announcements />} />
          <Route path="users" element={<UserManage />} />
          <Route path="ai" element={<AIManage />} />
          <Route path="test" element={<ApiTest />} />
          <Route path="docs" element={<ApiDocs />} />
          <Route path="logs" element={<Logs />} />
          <Route path="monitor" element={<Monitor />} />
          <Route path="settings" element={<Settings />} />
        </Route>

        {/* Amazon Q routes */}
        <Route path="/amazonq" element={<MainLayout />}>
          <Route index element={<AmazonQDashboard />} />
          <Route path="accounts" element={<AmazonQAccounts />} />
          <Route path="tasks" element={<AmazonQTasks />} />
        </Route>

        {/* Default redirect */}
        <Route path="/" element={<Navigate to="/admin" replace />} />
        <Route path="*" element={<Navigate to="/admin" replace />} />
      </Routes>
    </BrowserRouter>
  )
}

export default App
