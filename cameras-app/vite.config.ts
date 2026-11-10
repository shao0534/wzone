import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import qiankun from 'vite-plugin-qiankun';

export default defineConfig({
  base: '/',
  server: {
    port: 8001,
    cors: true,
    headers: { 'Access-Control-Allow-Origin': '*' },
  },
  plugins: [
    vue(),
    // 注册为 qiankun 微应用, useDevMode 支持开发环境独立运行
    qiankun('cameras', { useDevMode: true }),
  ],
});
