import axios from 'axios';

// 统一 axios 实例
const request = axios.create({
  baseURL: import.meta.env.VITE_API_BASE || 'http://localhost:9000/api',
  timeout: 30000,
});

// 请求拦截: 统一注入登录 token。
// 注意直接读 localStorage, 不导入 authStore —— 否则会形成
// request -> authStore -> api/auth -> request 的循环依赖。
const TOKEN_KEY = 'shuwu.auth.token';
request.interceptors.request.use((config) => {
  const token = localStorage.getItem(TOKEN_KEY);
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// 响应拦截: 统一解包 { code, message, data }
request.interceptors.response.use(
  (res) => {
    const data = res.data;
    if (data && data.code !== 0) return Promise.reject(new Error(data.message || '请求失败'));
    return data ? data.data : res.data;
  },
  (err) => Promise.reject(new Error(err?.response?.data?.message || err.message || '网络错误'))
);

export default request;
