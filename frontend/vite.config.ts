import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    proxy: {
      // API v1 接口
      '/v1': {
        target: 'http://localhost:8045',
        changeOrigin: true,
      },
      // 通用 API 接口
      '/api': {
        target: 'http://localhost:8045',
        changeOrigin: true,
      },
      // 上传文件
      '/uploads': {
        target: 'http://localhost:8045',
        changeOrigin: true,
      },
      // 后端管理 API - 使用正则匹配具体的 API 路径
      // 注意：/admin 本身是前端路由，不应该代理
      // 只代理 /admin/ 后面有具体路径的请求
      '^/admin/(login|logout|verify|oauth-callback|oauth-config|shared|user|keys|tokens|logs|status|settings|users|announcements|models|ai|add-token)': {
        target: 'http://localhost:8045',
        changeOrigin: true,
      },
    },
  },
})
