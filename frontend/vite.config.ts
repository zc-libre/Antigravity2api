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
      // API 代理配置 - 使用 /antigravity/api 前缀
      '/antigravity/api': {
        target: 'http://localhost:8045',
        changeOrigin: true,
      },
      // Amazon Q API 代理 - 使用 /amazonq/api 前缀
      '/amazonq/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/amazonq\/api/, '/api'),
      },
      // Amazon Q 健康检查代理
      '/amazonq/health': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/amazonq\/health/, '/health'),
      },
      // 上传文件代理
      '/uploads': {
        target: 'http://localhost:8045',
        changeOrigin: true,
      },
    },
  },
})
