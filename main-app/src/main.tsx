import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import { start } from 'qiankun';
import App from './App';
import './styles/global.less';

start({ sandbox: { experimentalStyleIsolation: true } });

// 过滤浏览器扩展注入的报错, 避免其触发子应用 webpack-dev-server 的全屏错误覆盖层。
// 背景: React DevTools 扩展在 qiankun 子应用卸载/重挂(如「我的项目 -> 我的博客 -> 我的项目」)时,
// 会在扩展自身代码里抛 "Cannot read properties of undefined (reading 'app')" —— 属扩展兼容问题,
// 与项目代码无关, 但会被 admin 子应用 dev-server 挂在 window 上的错误覆盖层捕获并弹全屏红框。
// 同时覆盖 'error'(同步异常)与 'unhandledrejection'(Promise 异常)两条路径, 否则 Promise 形态的
// 扩展报错仍会穿透。本监听在 main.tsx 最早注册(先于 dev-server 客户端), window 级事件按注册
// 顺序执行, 因此 stopImmediatePropagation 能确保覆盖层监听收不到这类事件。
// 只拦截来源为 chrome-extension:// 的错误, 项目自身的错误不受影响。
function isExtensionError(err: unknown): boolean {
  const stack = err instanceof Error ? String(err.stack || '') : String(err || '');
  return stack.includes('chrome-extension://');
}

window.addEventListener('error', (e) => {
  if (String(e.filename || '').startsWith('chrome-extension://') || isExtensionError(e.error)) {
    e.stopImmediatePropagation();
    e.preventDefault();
    console.warn('[main] 已忽略浏览器扩展报错:', e.message);
  }
}, true);

window.addEventListener('unhandledrejection', (e) => {
  if (isExtensionError(e.reason)) {
    e.stopImmediatePropagation();
    e.preventDefault();
    console.warn('[main] 已忽略浏览器扩展 Promise 报错:', e.reason?.message ?? e.reason);
  }
}, true);

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: false },
  },
});

// 注意: 这里刻意不使用 React.StrictMode。
// StrictMode 在开发模式下会双调用 useEffect(mount→cleanup→mount), 导致 qiankun 的 loadMicroApp
// 对同名子应用「第一次加载→立即 unmount→第二次复用已卸载实例(不再重新挂载)」,
// 最终子应用内容被清空、camera 列表无法渲染。移除后 useEffect 只执行一次, 子应用正常挂载。
ReactDOM.createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={queryClient}>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </QueryClientProvider>
);
