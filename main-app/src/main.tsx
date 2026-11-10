import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import { start } from 'qiankun';
import App from './App';
import './styles/global.less';

start({ sandbox: { experimentalStyleIsolation: true } });

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
