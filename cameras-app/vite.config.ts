import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import qiankun from 'vite-plugin-qiankun';

export default defineConfig(({ mode }) => ({
  // 生产构建资源前缀: 子应用部署在主应用同域名下的 /apps/cameras/ 路径
  base: mode === 'production' ? '/apps/cameras/' : '/',
  server: {
    port: 8001,
    cors: true,
    headers: { 'Access-Control-Allow-Origin': '*' },
    // 开发环境同源代理: 前端统一用相对路径 /api, 与生产 Nginx 反代行为一致
    proxy: {
      '/api': { target: 'http://localhost:9000', changeOrigin: true },
      '/uploads': { target: 'http://localhost:9000', changeOrigin: true },
    },
  },
  plugins: [
    vue(),
    // 注册为 qiankun 微应用, useDevMode 支持开发环境独立运行
    qiankun('cameras', { useDevMode: true }),
  ],
}));
