import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 8000,
    cors: true,
    // 开发环境同源代理: 前端统一用相对路径 /api, 由 dev server 转发到后端,
    // 与生产环境(Nginx 反代)行为一致, 避免硬编码 localhost
    proxy: {
      '/api': { target: 'http://localhost:9000', changeOrigin: true },
      '/uploads': { target: 'http://localhost:9000', changeOrigin: true },
    },
  },
  css: {
    preprocessorOptions: {
      less: { javascriptEnabled: true },
    },
  },
});
