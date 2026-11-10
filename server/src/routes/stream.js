// 视频流接口
// 设计要点:
//   - 播放前必须先做网络测试(POST /stream/probe), 通了才取流(GET /stream/:id/play)
//   - 批量播放用 POST /stream/batch: 一次往返拿回 ≤64 路的探活 + 播放描述,
//     避免 64 路各自"探活 + 取流"造成 128 次并发请求
//   - 媒体数据走 /stream/:id/media, 支持 Range(实时流靠拖动到同步位置实现对齐)
const router = require('express').Router();
const path = require('path');
const stream = require('../services/streamService');
const media = require('../services/mediaLibrary');
const { success, fail } = require('../utils/response');

// 服务端时钟(客户端可用它估算时钟偏差, 做更精确的同步)
router.get('/clock', (req, res) => {
  success(res, { serverTime: Date.now(), epochMs: stream.getStatus().epochMs });
});

// 运行状态(排查转码队列/时间轴)
router.get('/stats', (req, res) => {
  success(res, stream.getStatus());
});

// 批量网络测试: 不通的摄像头不会进入播放
router.post('/probe', async (req, res, next) => {
  try {
    const ids = Array.isArray(req.body && req.body.ids) ? req.body.ids.slice(0, 64) : [];
    if (!ids.length) return fail(res, 'ids 不能为空');
    const cameras = await stream.getCameras(ids);
    const byId = new Map(cameras.map((c) => [Number(c.id), c]));
    const list = [];
    for (const id of ids) {
      const cam = byId.get(Number(id));
      if (!cam) {
        list.push({ id: Number(id), ok: false, reason: '摄像头不存在' });
        continue;
      }
      list.push(await stream.probeOne(cam));
    }
    success(res, { list, serverTime: Date.now() });
  } catch (e) { next(e); }
});

// 批量取流: 返回每路的播放描述(含实时同步位置)
router.post('/batch', async (req, res, next) => {
  try {
    const ids = Array.isArray(req.body && req.body.ids) ? req.body.ids.slice(0, 64) : [];
    if (!ids.length) return fail(res, 'ids 不能为空');
    const data = await stream.buildBatch(ids, { hevc: !!req.body.hevc });
    success(res, data);
  } catch (e) { next(e); }
});

// 单路网络测试
router.get('/:id/probe', async (req, res, next) => {
  try {
    const camera = await stream.getCamera(req.params.id);
    if (!camera) return fail(res, '摄像头不存在', 404);
    success(res, await stream.probeOne(camera));
  } catch (e) { next(e); }
});

// 单路取流(要求先通过网络测试)
router.get('/:id/play', async (req, res, next) => {
  try {
    const camera = await stream.getCamera(req.params.id);
    if (!camera) return fail(res, '摄像头不存在', 404);
    const probe = await stream.probeOne(camera);
    if (!probe.ok) return fail(res, `网络测试未通过: ${probe.reason}`, 412);
    const info = await stream.buildPlayInfo(camera, { hevc: req.query.hevc === '1' });
    success(res, { ...info, probeMs: probe.latencyMs });
  } catch (e) { next(e); }
});

// 实时流当前位置: 播放中周期性校正漂移
router.get('/:id/position', async (req, res, next) => {
  try {
    const camera = await stream.getCamera(req.params.id);
    if (!camera) return fail(res, '摄像头不存在', 404);
    success(res, await stream.currentPosition(camera));
  } catch (e) { next(e); }
});

// 媒体数据: 支持 Range, 供 <video> 拖动/分段加载
router.get('/:id/media', async (req, res, next) => {
  try {
    const camera = await stream.getCamera(req.params.id);
    if (!camera) return res.status(404).json({ code: 404, message: '摄像头不存在' });

    const desc = await media.describe(camera.videoUrl);
    if (!desc.ok) return res.status(404).json({ code: 404, message: desc.error || '视频源不可达' });

    // 远程源直接 302, 由浏览器/CDN 去拉
    if (desc.source === 'remote') return res.redirect(302, desc.httpUrl);

    const wantHevc = req.query.hevc === '1';
    let file = desc.absPath;
    let servedCodec = desc.codec;
    if (desc.codec === 'hevc' && !wantHevc) {
      try {
        file = await media.ensureH264(desc);
        servedCodec = 'h264';
      } catch (e) {
        return res.status(415).json({ code: 415, message: `H265 转码失败: ${e.message}` });
      }
    }

    // sendFile 自带 Range(206) / Accept-Ranges 处理
    res.sendFile(
      path.resolve(file),
      {
        headers: {
          'Content-Type': 'video/mp4',
          'Cache-Control': 'no-store',
          'X-Codec': servedCodec,
        },
        cacheControl: false,
        etag: false,
        lastModified: false,
      },
      (err) => {
        if (!err) return;
        if (res.headersSent) return res.end();
        if (err.code === 'ECONNABORTED') return; // 客户端主动断开(关闭播放窗口), 正常现象
        next(err);
      }
    );
  } catch (e) { next(e); }
});

module.exports = router;
