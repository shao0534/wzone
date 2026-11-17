import axios from 'axios';

// 统一 axios 实例
// 同源相对路径: 开发走 vite proxy, 生产走 Nginx 反代, 无跨域问题
export const API_BASE = import.meta.env.VITE_API_BASE || '/api';

const request = axios.create({
  baseURL: API_BASE,
  timeout: 30000,
});

// 请求拦截: 注入登录 token(主应用与子应用同源, localStorage 共享)。
// 服务端按角色校验写操作权限, 无 token 的写操作会得到 401。
request.interceptors.request.use((config) => {
  const token = localStorage.getItem('shuwu.auth.token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// 响应拦截: 统一解包
request.interceptors.response.use(
  (res) => {
    const data = res.data;
    if (data && data.code !== 0) return Promise.reject(new Error(data.message || '请求失败'));
    return data ? data.data : res.data;
  },
  (err) => {
    // 主动取消(AbortController)的请求原样抛出: 调用方据此静默忽略, 不当成业务错误
    if (axios.isCancel?.(err) || err?.code === 'ERR_CANCELED' || err?.name === 'CanceledError') {
      return Promise.reject(err);
    }
    return Promise.reject(new Error(err?.response?.data?.message || err.message || '网络错误'));
  }
);

export default request;
