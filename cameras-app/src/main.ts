import { createApp } from 'vue';
import { createPinia } from 'pinia';
import ElementPlus from 'element-plus';
import 'element-plus/dist/index.css';
import { renderWithQiankun, qiankunWindow } from 'vite-plugin-qiankun/dist/helper';
import App from './App.vue';
import router from './router';
import { setMicroActions } from './micro';
import './styles/global.less';

let app: any = null;

function render(props: any = {}) {
  if (props.actions) setMicroActions(props.actions);

  const { container } = props;

  let appEl: HTMLElement | null = container
    ? container.querySelector('#app')
    : document.querySelector('#app');
  if (!appEl) {
    appEl = document.createElement('div');
    appEl.id = 'app';
    if (container) container.appendChild(appEl);
    else document.body.appendChild(appEl);
  }

  app = createApp(App);
  app.use(createPinia());
  app.use(ElementPlus);
  app.use(router);
  app.mount(appEl);
}

renderWithQiankun({
  bootstrap() {},
  mount(props: any) { render(props); },
  unmount() { app?.unmount(); app = null; },
  update() {},
});

if (!qiankunWindow.__POWERED_BY_QIANKUN__) {
  render();
}
