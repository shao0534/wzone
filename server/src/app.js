// 后端服务入口
const fs = require('fs');
const path = require('path');
const express = require('express');
const cors = require('cors');
const routes = require('./routes');
const cameraSync = require('./services/cameraSync');
const mediaLibrary = require('./services/mediaLibrary');
const authService = require('./services/authService');

// 确保上传目录存在
fs.mkdirSync(path.join(__dirname, '../../uploads/videos'), { recursive: true });
fs.mkdirSync(path.join(__dirname, '../../uploads/images'), { recursive: true });

const app = express();

// 禁用 ETag 缓存协商: 避免动态 API 返回 304(无响应体)导致前端拿到空数据
app.set('etag', false);

// 跨域与请求体解析(大视频上传需要较大体积上限)
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// 静态资源: 供上传的视频/图片访问
app.use('/uploads', express.static(path.join(__dirname, '../../uploads')));

// 业务路由统一挂载在 /api 前缀下
app.use('/api', routes);

// 404 兜底
app.use((req, res) => res.status(404).json({ code: 404, message: '接口不存在' }));

// 全局错误处理
app.use((err, req, res, next) => {
  console.error('[server error]', err);
  res.status(500).json({ code: 500, message: '服务器内部错误' });
});

const PORT = process.env.PORT || 9000;
app.listen(PORT, () => {
  console.log(`[wzone-server] 服务已启动: http://localhost:${PORT}`);
  // 幂等确保两个初始用户存在; 数据库暂不可用时仅告警, 不阻塞服务
  authService.ensureSeedUsers()
    .then(() => console.log('[auth] 初始用户就绪'))
    .catch((e) => console.warn('[auth] 初始用户检查失败:', e.message));
  // 后台定时任务: 每 30s 随机切换 100 台摄像头状态(可通过环境变量覆盖)
  cameraSync.startAutoFlip(
    Number(process.env.CAMERA_FLIP_INTERVAL) || cameraSync.DEFAULT_FLIP_INTERVAL,
    Number(process.env.CAMERA_FLIP_COUNT) || cameraSync.DEFAULT_FLIP_COUNT
  );
  // 模拟视频库: 确保目录存在, 并预热 H265 样本的 H264 转码缓存(不阻塞启动)
  mediaLibrary.ensureDirs();
  mediaLibrary
    .warmup()
    .then(() => console.log('[media] 模拟流预热完成'))
    .catch((e) => console.warn('[media] 预热失败:', e.message));
});
