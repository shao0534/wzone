// ffmpeg 可执行文件定位
// 顺序: 环境变量 FFMPEG_PATH -> 项目内置 vendor 目录 -> ffmpeg-static 包 -> 系统 PATH
const fs = require('fs');
const path = require('path');

const VENDOR = path.join(__dirname, '../../vendor');

let cached;

function resolveFfmpeg() {
  if (cached !== undefined) return cached;

  const env = process.env.FFMPEG_PATH;
  if (env && fs.existsSync(env)) {
    cached = env;
    return cached;
  }

  const vendorBin = path.join(VENDOR, process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
  if (fs.existsSync(vendorBin)) {
    cached = vendorBin;
    return cached;
  }

  try {
    // npm 源内置二进制(推荐, 无需访问 github)
    const installer = require('@ffmpeg-installer/ffmpeg');
    if (installer && installer.path && fs.existsSync(installer.path)) {
      cached = installer.path;
      return cached;
    }
  } catch {
    /* 未安装 @ffmpeg-installer/ffmpeg */
  }

  try {
    const p = require('ffmpeg-static');
    if (p && fs.existsSync(p)) {
      cached = p;
      return cached;
    }
  } catch {
    /* 未安装 ffmpeg-static */
  }

  // 交给系统 PATH, 由调用方在 spawn 失败时给出明确提示
  cached = 'ffmpeg';
  return cached;
}

function hasFfmpeg() {
  const p = resolveFfmpeg();
  if (p === 'ffmpeg') return false;
  return fs.existsSync(p);
}

module.exports = { resolveFfmpeg, hasFfmpeg };
