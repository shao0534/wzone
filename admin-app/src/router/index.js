import Vue from 'vue';
import VueRouter from 'vue-router';
import CameraList from '../views/CameraList.vue';
import ApplyPermission from '../views/ApplyPermission.vue';

Vue.use(VueRouter);

// 微应用环境下使用 abstract 路由(不操作 URL):
// 两个子应用常驻挂载, 若都用 hash 路由会共用 window.location.hash 互相覆盖(本应用 /camera 的重定向
// 会把 cameras 子应用的 hash 改成 #/camera, 导致其路由不匹配、列表变空白)。
// abstract 模式将路由状态保存在内存, 与主应用 history 及另一子应用完全隔离。
const router = new VueRouter({
  mode: window.__POWERED_BY_QIANKUN__ ? 'abstract' : 'history',
  routes: [
    { path: '/', redirect: '/camera' },
    { path: '/camera', component: CameraList },
    { path: '/apply', component: ApplyPermission },
  ],
});

export default router;
