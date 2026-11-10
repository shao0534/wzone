import Vue from 'vue';
import ElementUI from 'element-ui';
import 'element-ui/lib/theme-chalk/index.css';
import App from './App.vue';
import router from './router';
import store from './store';
import { setMicroActions } from './micro';
import './styles/global.less';

Vue.use(ElementUI);

let instance = null;

function render(props = {}) {
  if (props.actions) setMicroActions(props.actions);

  const { container } = props;

  let appEl = container
    ? container.querySelector('#app')
    : document.querySelector('#app');
  if (!appEl) {
    appEl = document.createElement('div');
    appEl.id = 'app';
    if (container) container.appendChild(appEl);
    else document.body.appendChild(appEl);
  }

  instance = new Vue({
    router,
    store,
    render: (h) => h(App),
  }).$mount(appEl);

  // Vue Router 3 的 abstract 模式不会自动执行初始导航(其 init 方法仅对 HTML5History/HashHistory 调用
  // transitionTo), 导致 router-view 一直停留在 START 空状态、CameraList 不渲染。
  // 挂载完成后手动跳转到默认路由 /camera 触发导航。
  if (window.__POWERED_BY_QIANKUN__) {
    router.replace('/camera').catch(() => {});
  }
}

if (!window.__POWERED_BY_QIANKUN__) {
  render();
}

export async function bootstrap() {}
export async function mount(props) { render(props); }
export async function unmount() {
  if (instance) {
    instance.$destroy();
    instance.$el.innerHTML = '';
    instance = null;
  }
}
