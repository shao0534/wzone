// 视频流服务
// 1. 流类型判定: 管理后台「人工上传视频生成」的(type = 2)是点播回放, 其余都是实时流
// 2. 网络测试: 播放实时流前先探测源可达性/首包延迟, 通了才取流
// 3. 同步播放: 所有实时流共享同一条时间轴, 任意客户端在任意时刻看到的画面位置一致
// 4. 编码协商: 浏览器支持 HEVC 就直连原始 H265, 否则用服务端转码后的 H264
const pool = require('../config/db');
const fsp = require('fs/promises');
const media = require('./mediaLibrary');

// ---------------- 播放方式总开关 ----------------
// 实时那套(共享时间轴 + 周期性 seek 校正)在弱网/多路场景下容易卡, 因此支持整体切换:
//   'vod'  (默认) 全部按「人工上传视频」的点播方式播放: 直接拉 MP4 从头播, 不 seek、
//                 不推算实时位置、不做漂移校正; 循环播放靠 <video loop>, 全程零额外请求
//   'auto'        还原原始逻辑: type=2 点播, 其余(type 1/3)实时
// 实时流相关代码全部保留, 只需把环境变量 STREAM_PLAY_MODE 设成 auto 即可切回。
// 注意: 该开关只影响"怎么播", 不影响取流地址、编码协商与 H265 转码。
const PLAY_MODE = String(process.env.STREAM_PLAY_MODE || 'vod').toLowerCase() === 'auto' ? 'auto' : 'vod';
const FORCE_VOD = PLAY_MODE === 'vod';

// 全局实时时间轴起点: 所有实时流共用, 保证多个窗口/多台设备看到同一帧
const LIVE_EPOCH_MS = Math.floor(Date.now() / 1000) * 1000;
// 客户端漂移校正参数
const SYNC_EVERY_MS = 5000;   // 每 5s 校正一次
const SYNC_TOLERANCE_MS = 600; // 偏差超过 600ms 才重新对齐(避免频繁 seek 卡顿)
// 转码等待上限: 超过就先返回 preparing, 让前端稍后重试(任务仍在后台跑)
const TRANSCODE_WAIT_MS = 8000;

/**
 * 流类型: 2 = 人工上传的点播视频, 其余(type 1/3)为实时流
 * 开关为 vod 时一律返回 'vod'(全部按上传视频的方式播放)
 */
function modeOf(type) {
  if (FORCE_VOD) return 'vod';
  return Number(type) === 2 ? 'vod' : 'live';
}

/** 实时流当前应播放到的位置(循环取模) */
function livePosition(durationMs, now = Date.now()) {
  const d = durationMs > 0 ? durationMs : 30_000;
  const elapsed = now - LIVE_EPOCH_MS;
  return ((elapsed % d) + d) % d;
}

// ---------------- 摄像头读取 ----------------

async function getCamera(id) {
  const [rows] = await pool.query('SELECT * FROM camera WHERE id = ?', [id]);
  return rows[0] || null;
}

async function getCameras(ids) {
  if (!ids.length) return [];
  const [rows] = await pool.query('SELECT * FROM camera WHERE id IN (?)', [ids]);
  return rows;
}

// 源描述缓存: 批量播放时同一批摄像头往往指向同一个样本文件
const descCache = new Map();
const DESC_TTL = 30_000;

async function describeCached(videoUrl) {
  const key = String(videoUrl || '');
  const hit = descCache.get(key);
  if (hit && Date.now() - hit.at < DESC_TTL) return hit.value;
  const value = await media.describe(videoUrl);
  descCache.set(key, { at: Date.now(), value });
  if (descCache.size > 500) descCache.delete(descCache.keys().next().value);
  return value;
}

// ---------------- 网络测试 ----------------

/**
 * 单路网络测试
 * ok 的含义: 视频源可达且下发路径可用(实时流还要求摄像头在线)
 * 延迟是真测的: 本地源读首个数据块, 远程源取 desc 里记录的首包耗时
 */
async function probeOne(camera) {
  const mode = modeOf(camera.type);
  const desc = await describeCached(camera.videoUrl);

  let latencyMs = desc.latencyMs || 0;
  if (desc.ok && desc.source === 'local' && desc.absPath) {
    // 真读一次首块, 拿到真实的 IO/首包延迟(而不是缓存命中后的 0)
    const t0 = process.hrtime.bigint();
    try {
      const fh = await fsp.open(desc.absPath, 'r');
      const buf = Buffer.alloc(64 * 1024);
      await fh.read(buf, 0, buf.length, 0);
      await fh.close();
    } catch {
      return { id: camera.id, cameraName: camera.cameraName, mode, codec: desc.codec, ok: false, reason: '视频源读取失败', latencyMs: 0 };
    }
    latencyMs = Math.max(1, Math.round(Number(process.hrtime.bigint() - t0) / 1e6));
  }

  const base = {
    id: camera.id,
    cameraName: camera.cameraName,
    mode,
    type: Number(camera.type),
    codec: desc.codec,
    source: desc.source,
    latencyMs,
    durationMs: desc.durationMs,
  };

  if (!desc.ok) {
    return { ...base, ok: false, reason: desc.error || '视频源不可达' };
  }
  if (mode === 'live' && Number(camera.state) !== 1) {
    return { ...base, ok: false, reason: '摄像头离线' };
  }
  // H265 且浏览器不支持时, 还要确认服务端能转码
  if (desc.codec === 'hevc' && !media.getStats().ffmpeg) {
    return { ...base, ok: false, reason: 'H265 需转码, 但服务端未安装 ffmpeg' };
  }
  return { ...base, ok: true, sizeBytes: desc.sizeBytes };
}

// ---------------- 播放描述 ----------------

function withTimeout(promise, ms) {
  let timer;
  return Promise.race([
    promise.then((v) => ({ done: true, value: v })),
    new Promise((resolve) => {
      timer = setTimeout(() => resolve({ done: false }), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

/**
 * 生成播放描述
 * @param camera 摄像头行
 * @param opts { hevc: 浏览器是否支持 HEVC, mediaBase: 媒体地址前缀 }
 */
async function buildPlayInfo(camera, opts = {}) {
  const mode = modeOf(camera.type);
  const desc = await describeCached(camera.videoUrl);
  const serverTime = Date.now();

  const fail = (reason) => ({
    id: camera.id,
    cameraName: camera.cameraName,
    mode,
    type: Number(camera.type),
    status: 'error',
    error: reason,
  });

  if (!desc.ok) return fail(desc.error || '视频源不可达');
  if (mode === 'live' && Number(camera.state) !== 1) return fail('摄像头离线');

  // 编码协商: 支持 HEVC 直连原始流, 否则转成 H264
  let playCodec = desc.codec;
  let transcoded = false;
  if (desc.codec === 'hevc' && !opts.hevc) {
    const mediaUrl = `/api/stream/${camera.id}/media`;
    if (!media.getStats().ffmpeg) return fail('H265 需转码, 但服务端未安装 ffmpeg');
    try {
      const job = media.ensureH264(desc); // 同一文件并发调用会复用同一个任务
      const r = await withTimeout(job, TRANSCODE_WAIT_MS);
      if (!r.done) {
        return {
          id: camera.id,
          cameraName: camera.cameraName,
          mode,
          type: Number(camera.type),
          codec: desc.codec,
          status: 'preparing',
          transcoded: true,
          retryAfterMs: 800,
          url: mediaUrl,
          message: 'H265 转码中, 请稍候',
          serverTime,
        };
      }
      playCodec = 'h264';
      transcoded = true;
    } catch (e) {
      return fail(`H265 转码失败: ${e.message}`);
    }
  }

  const url = `/api/stream/${camera.id}/media${opts.hevc ? '?hevc=1' : ''}`;
  const durationMs = desc.durationMs || 30_000;

  const info = {
    id: camera.id,
    cameraName: camera.cameraName,
    mode,
    type: Number(camera.type),
    status: 'ready',
    codec: desc.codec,
    playCodec,
    transcoded,
    url,
    durationMs,
    sizeBytes: desc.sizeBytes,
    label: desc.label || '',
    serverTime,
  };

  if (mode === 'live') {
    info.live = {
      epochMs: LIVE_EPOCH_MS,
      positionMs: livePosition(durationMs, serverTime),
      durationMs,
      syncEveryMs: SYNC_EVERY_MS,
      toleranceMs: SYNC_TOLERANCE_MS,
    };
  } else {
    // 点播: 从头播放, 播完由 <video loop> 自动循环(纯本地行为, 不发任何请求)
    info.vod = { startMs: 0, loop: true };
  }
  return info;
}

/** 批量: 一次请求拿回最多 64 路的探活 + 播放描述(避免 64 次往返) */
async function buildBatch(ids, opts = {}) {
  const list = ids.slice(0, 64);
  const cameras = await getCameras(list);
  const byId = new Map(cameras.map((c) => [Number(c.id), c]));

  const out = [];
  for (const id of list) {
    const cam = byId.get(Number(id));
    if (!cam) {
      out.push({ id: Number(id), status: 'error', error: '摄像头不存在' });
      continue;
    }
    // 先做一次真实的网络测试(读首块), 把耗时带给前端展示 "测速 xx ms"
    const probe = await probeOne(cam);
    const info = await buildPlayInfo(cam, opts);
    info.probeMs = probe.latencyMs;
    if (!probe.ok && info.status !== 'error') {
      info.status = 'error';
      info.error = probe.reason;
    }
    out.push(info);
  }
  return { list: out, serverTime: Date.now(), playMode: PLAY_MODE };
}

/** 实时流当前位置(播放中做漂移校正用) */
async function currentPosition(camera) {
  const desc = await describeCached(camera.videoUrl);
  const durationMs = desc.durationMs || 30_000;
  const serverTime = Date.now();
  return {
    id: camera.id,
    mode: modeOf(camera.type),
    serverTime,
    durationMs,
    positionMs: livePosition(durationMs, serverTime),
  };
}

function getStatus() {
  return {
    playMode: PLAY_MODE, // 'vod' = 全部按上传视频点播播放 / 'auto' = 按摄像头类型判定
    epochMs: LIVE_EPOCH_MS,
    syncEveryMs: SYNC_EVERY_MS,
    toleranceMs: SYNC_TOLERANCE_MS,
    uptimeMs: Date.now() - LIVE_EPOCH_MS,
    media: media.getStats(),
  };
}

module.exports = {
  PLAY_MODE,
  modeOf,
  livePosition,
  getCamera,
  getCameras,
  probeOne,
  buildPlayInfo,
  buildBatch,
  currentPosition,
  getStatus,
};
