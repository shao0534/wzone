import axios from 'axios';

// 统一 axios 实例
const request = axios.create({
  baseURL: 'http://localhost:9000/api',
  timeout: 60000, // 大视频上传需要更长超时
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
  (err) => Promise.reject(new Error((err && err.response && err.response.data && err.response.data.message) || err.message || '网络错误'))
);

export default request;
