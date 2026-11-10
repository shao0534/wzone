// 模拟视频库
// 职责:
//   1. 定位视频源(本地上传目录 / 远程 http(s) 地址)并做编码探测(区分 H264 / H265)
//   2. H265 源按需转码为 H264 并落盘缓存(浏览器普遍不支持 HEVC 软解), 同一文件只转一次
//   3. 转码任务限量并发排队, 避免 64 路批量播放时把 CPU 打满
//
// 编码探测不依赖 ffprobe: 直接扫 MP4 的 stsd 采样描述里的 fourcc
//   avc1 / avc3 -> H264;  hvc1 / hev1 -> H265(HEVC);  av01 -> AV1
// 只要文件头/尾各取一段就能命中(+faststart 的文件 moov 在前, 未优化的在后)
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { spawn } = require('child_process');

const UPLOAD_ROOT = path.join(__dirname, '../../../uploads');
const VIDEO_ROOT = path.join(UPLOAD_ROOT, 'videos');
const SIM_DIR = path.join(VIDEO_ROOT, 'sim');
const CACHE_DIR = path.join(VIDEO_ROOT, 'cache');
const MANIFEST_PATH = path.join(SIM_DIR, 'manifest.json');

// 转码并发上限: 2 路足够(批量播放同一批样本只会命中 1~2 个文件, 天然去重)
const MAX_TRANSCODE = 2;
// 单个文件转码时长上限(秒), 防止误传超大文件长期占用 CPU
const TRANSCODE_MAX_SECONDS = 180;

// ffmpeg 可执行文件: 统一由 utils/ffmpeg 解析(环境变量 / vendor / npm 内置二进制 / PATH)
const { resolveFfmpeg, hasFfmpeg } = require('../utils/ffmpeg');
const ffmpegPath = resolveFfmpeg();

// ---------------- 目录与清单 ----------------

function ensureDirs() {
  fs.mkdirSync(SIM_DIR, { recursive: true });
  fs.mkdirSync(CACHE_DIR, { recursive: true });
}

// 样本清单(由 scripts/gen-sample-videos.js 生成): file / label / codec / durationMs
let manifest = null;
let manifestMtime = 0;

function getManifest() {
  let st;
  try {
    st = fs.statSync(MANIFEST_PATH);
  } catch {
    return { clips: [] };
  }
  if (manifest && st.mtimeMs === manifestMtime) return manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
    manifestMtime = st.mtimeMs;
  } catch {
    manifest = { clips: [] };
  }
  return manifest;
}

function findClip(relPath) {
  const base = path.basename(String(relPath || ''));
  return getManifest().clips.find((c) => c.file === base) || null;
}

// ---------------- 编码探测 ----------------

const codecCache = new Map(); // `${absPath}:${size}:${mtimeMs}` -> codec

const FOURCC = [
  ['hvc1', 'hevc'],
  ['hev1', 'hevc'],
  ['avc1', 'h264'],
  ['avc3', 'h264'],
  ['av01', 'av1'],
];

function scanCodec(buf) {
  for (const [tag, codec] of FOURCC) {
    if (buf.indexOf(Buffer.from(tag, 'latin1')) >= 0) return codec;
  }
  return 'unknown';
}

/** 探测本地文件编码(头 4MB + 尾 4MB, 覆盖 moov 在前/在后两种情况) */
async function detectCodec(absPath, size) {
  const key = `${absPath}:${size}`;
  if (codecCache.has(key)) return codecCache.get(key);

  const CHUNK = 4 * 1024 * 1024;
  const fh = await fsp.open(absPath, 'r');
  let codec = 'unknown';
  try {
    if (size <= CHUNK * 2) {
      const buf = Buffer.alloc(size);
      await fh.read(buf, 0, size, 0);
      codec = scanCodec(buf);
    } else {
      const head = Buffer.alloc(CHUNK);
      await fh.read(head, 0, CHUNK, 0);
      codec = scanCodec(head);
      if (codec === 'unknown') {
        const tail = Buffer.alloc(CHUNK);
        await fh.read(tail, 0, CHUNK, size - CHUNK);
        codec = scanCodec(tail);
      }
    }
  } finally {
    await fh.close();
  }
  codecCache.set(key, codec);
  return codec;
}

// ---------------- 源描述 ----------------

/** 把数据库里的 videoUrl 解析成可访问的本地绝对路径 */
function toAbsPath(videoUrl) {
  if (!videoUrl) return null;
  const clean = String(videoUrl).split('?')[0];
  // /uploads/videos/xxx.mp4 -> <root>/uploads/videos/xxx.mp4
  const idx = clean.indexOf('/uploads/');
  const rel = idx >= 0 ? clean.slice(idx + '/uploads/'.length) : null;
  if (!rel) return null;
  // /uploads/videos/xxx -> <root>/uploads/videos/xxx
  const abs = path.join(UPLOAD_ROOT, rel);
  // 防目录穿越
  if (!abs.startsWith(UPLOAD_ROOT)) return null;
  return abs;
}

/**
 * 描述一个视频源
 * 返回 { ok, source, codec, durationMs, sizeBytes, absPath?, httpUrl?, label?, error? }
 */
async function describe(videoUrl) {
  if (!videoUrl) return { ok: false, source: 'none', error: '未配置视频源' };

  const clip = findClip(videoUrl);
  const durationMs = clip ? clip.durationMs : 30_000;
  const label = clip ? clip.label : '';

  if (/^https?:\/\//i.test(videoUrl)) {
    // 远程流: 只做可达性 + 编码粗判(拉前 3MB 扫 fourcc), 不下载整段
    const started = Date.now();
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 5000);
      const res = await fetch(videoUrl, {
        method: 'GET',
        headers: { Range: 'bytes=0-3145727' },
        signal: ctrl.signal,
      }).finally(() => clearTimeout(timer));
      const buf = Buffer.from(await res.arrayBuffer());
      const codec = scanCodec(buf);
      return {
        ok: res.ok || res.status === 206,
        source: 'remote',
        httpUrl: videoUrl,
        codec,
        durationMs,
        label,
        latencyMs: Date.now() - started,
        sizeBytes: Number(res.headers.get('content-range')?.split('/')?.[1]) || 0,
      };
    } catch (e) {
      return { ok: false, source: 'remote', httpUrl: videoUrl, codec: 'unknown', durationMs, label, error: `远端不可达: ${e.message}` };
    }
  }

  const absPath = toAbsPath(videoUrl);
  if (!absPath) return { ok: false, source: 'none', error: '无法解析视频路径' };

  const started = Date.now();
  try {
    const st = await fsp.stat(absPath);
    if (!st.isFile()) return { ok: false, source: 'local', error: '视频文件不存在' };
    if (st.size < 1024) return { ok: false, source: 'local', error: '视频文件损坏(体积过小)' };
    const codec = await detectCodec(absPath, st.size);
    return {
      ok: true,
      source: 'local',
      absPath,
      codec,
      durationMs,
      label,
      sizeBytes: st.size,
      mtimeMs: st.mtimeMs,
      latencyMs: Date.now() - started,
    };
  } catch (e) {
    return { ok: false, source: 'local', error: `视频文件不可读: ${e.code || e.message}` };
  }
}

// ---------------- H265 -> H264 转码 ----------------

let activeJobs = 0;
const waiting = [];
const jobs = new Map(); // cacheFile -> Promise<string>

function schedule(task) {
  return new Promise((resolve, reject) => {
    const run = () => {
      activeJobs += 1;
      task()
        .then(resolve, reject)
        .finally(() => {
          activeJobs -= 1;
          const next = waiting.shift();
          if (next) next();
        });
    };
    if (activeJobs < MAX_TRANSCODE) run();
    else waiting.push(run);
  });
}

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    if (!hasFfmpeg()) return reject(new Error('未安装 ffmpeg, 无法转码 H265'));
    const child = spawn(ffmpegPath, args, { windowsHide: true });
    let err = '';
    child.stderr.on('data', (d) => {
      err += String(d);
      if (err.length > 4000) err = err.slice(-4000);
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg 退出码 ${code}: ${err.slice(-300)}`));
    });
  });
}

/**
 * 确保拿到 H264 版本: 已是 H264 直接返回原路径, H265 则转码后返回缓存路径
 * 同一源文件并发调用会复用同一个任务(批量播放 64 路不会重复转码)
 */
async function ensureH264(desc) {
  if (desc.codec === 'h264' || desc.codec === 'unknown') return desc.absPath;
  if (!hasFfmpeg()) throw new Error('服务端未安装 ffmpeg, 无法播放 H265');

  const base = path.basename(desc.absPath, path.extname(desc.absPath));
  const cacheFile = path.join(
    CACHE_DIR,
    `${base}.${desc.sizeBytes}.${Math.round(desc.mtimeMs || 0)}.h264.mp4`
  );

  try {
    const st = await fsp.stat(cacheFile);
    if (st.size > 1024) return cacheFile;
  } catch {
    // 未缓存, 走转码
  }

  if (jobs.has(cacheFile)) return jobs.get(cacheFile);

  const job = schedule(async () => {
    const tmp = `${cacheFile}.part.mp4`;
    await runFfmpeg([
      '-hide_banner',
      '-loglevel', 'error',
      '-y',
      '-i', desc.absPath,
      '-t', String(TRANSCODE_MAX_SECONDS),
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-crf', '26',
      '-pix_fmt', 'yuv420p',
      '-profile:v', 'main',
      '-g', '50',
      '-c:a', 'aac',
      '-b:a', '96k',
      '-movflags', '+faststart',
      tmp,
    ]);
    // 先写临时文件再改名: 避免并发请求读到半截文件
    await fsp.rename(tmp, cacheFile);
    const st = await fsp.stat(cacheFile);
    if (st.size < 1024) throw new Error('转码输出异常');
    return cacheFile;
  }).finally(() => jobs.delete(cacheFile));

  jobs.set(cacheFile, job);
  return job;
}

/** 预热: 启动时把样本里的 H265 预先转好, 首个用户不再等待 */
async function warmup() {
  ensureDirs();
  const clips = getManifest().clips || [];
  for (const clip of clips) {
    if (clip.codec !== 'hevc') continue;
    try {
      const desc = await describe(`/uploads/videos/sim/${clip.file}`);
      if (desc.ok) await ensureH264(desc);
    } catch (e) {
      console.warn(`[media] 预热转码失败 ${clip.file}: ${e.message}`);
    }
  }
}

function getStats() {
  return {
    ffmpeg: hasFfmpeg(),
    transcoding: activeJobs,
    queued: waiting.length,
    cached: jobs.size,
    clips: (getManifest().clips || []).length,
  };
}

module.exports = {
  UPLOAD_ROOT,
  VIDEO_ROOT,
  SIM_DIR,
  CACHE_DIR,
  MAX_TRANSCODE,
  ensureDirs,
  getManifest,
  findClip,
  describe,
  ensureH264,
  detectCodec,
  warmup,
  getStats,
};
