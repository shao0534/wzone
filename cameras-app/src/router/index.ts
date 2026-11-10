import { createRouter, createWebHistory, createMemoryHistory } from 'vue-router';
import { qiankunWindow } from 'vite-plugin-qiankun/dist/helper';
import MonitorView from '../views/MonitorView.vue';

// 微应用环境下使用 memory 路由(不操作 URL):
// 两个子应用常驻挂载, 若都用 hash 路由会共用 window.location.hash 互相覆盖(admin 的 /camera 重定向
// 会把 cameras 的 hash 改成 #/camera, 导致 cameras 路由不匹配、列表变空白)。
// memory history 将路由状态保存在内存, 与主应用 history 及另一子应用完全隔离。
const history = qiankunWindow.__POWERED_BY_QIANKUN__
  ? createMemoryHistory()
  : createWebHistory();

const router = createRouter({
  history,
  routes: [{ path: '/', component: MonitorView }],
});

export default router;
