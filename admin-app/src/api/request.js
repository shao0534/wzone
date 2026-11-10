import axios from 'axios';

// 统一 axios 实例
const request = axios.create({
  baseURL: 'http://localhost:9000/api',
  timeout: 60000, // 大视频上传需要更长超时
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
