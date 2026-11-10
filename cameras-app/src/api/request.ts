import axios from 'axios';

// 统一 axios 实例
export const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:9000/api';

const request = axios.create({
  baseURL: API_BASE,
  timeout: 30000,
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
