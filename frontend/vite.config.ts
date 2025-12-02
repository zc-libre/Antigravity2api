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
      // Antigravity API 代理
      '/antigravity/api': {
        target: 'http://localhost:8045',
        changeOrigin: true,
      },
      // 上传文件代理
      '/uploads': {
        target: 'http://localhost:8045',
        changeOrigin: true,
      },
      // Amazon Q API 代理
      '/amazonq/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/amazonq\/api/, '/api'),
      },
      '/amazonq/health': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/amazonq\/health/, '/health'),
      },
      // Kiro API 代理
      '/kiro/api': {
        target: 'http://localhost:8989',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/kiro\/api/, '/api'),
      },
      '/kiro/health': {
        target: 'http://localhost:8989',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/kiro\/health/, '/health'),
      },
    },
  },
})
