// 生成模拟视频流样本(带时间码, 用于验证多路同步播放)
// 用法: npm run gen-samples
//
// 生成的每个片段时长一致(30s)且画面里烧录了片内位置(POS mm:ss.mmm),
// 所有实时流共享同一条时间轴 -> 64 路平铺时每格显示的时间码完全相同,
// 一眼就能看出"同步播放"是否生效。
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { resolveFfmpeg, hasFfmpeg } = require('../utils/ffmpeg');

const SIM_DIR = path.join(__dirname, '../../../uploads/videos/sim');
const DURATION = 30; // 秒, 所有片段必须一致
const SIZE = '480x270';
const FPS = 25;

if (!hasFfmpeg() && !process.env.FFMPEG_PATH) {
  console.error('未找到 ffmpeg, 请先安装: pnpm add @ffmpeg-installer/ffmpeg');
  process.exit(1);
}
const ffmpeg = resolveFfmpeg();

// Windows 字体路径在 ffmpeg 滤镜里需要转义盘符冒号
const FONT = process.platform === 'win32'
  ? 'C\\:/Windows/Fonts/arialbd.ttf'
  : '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf';

// 片段定义: 画面源不同, 时长与时间码一致
const CLIPS = [
  { file: 'sim-a.mp4',      label: 'SIM-A', src: `testsrc2=size=${SIZE}:rate=${FPS}`,  codec: 'h264' },
  { file: 'sim-b.mp4',      label: 'SIM-B', src: `smptebars=size=${SIZE}:rate=${FPS}`, codec: 'h264' },
  { file: 'sim-c.mp4',      label: 'SIM-C', src: `rgbtestsrc=size=${SIZE}:rate=${FPS}`, codec: 'h264' },
  { file: 'sim-a-h265.mp4', label: 'SIM-A', src: `testsrc2=size=${SIZE}:rate=${FPS}`,  codec: 'hevc' },
  { file: 'sim-b-h265.mp4', label: 'SIM-B', src: `smptebars=size=${SIZE}:rate=${FPS}`, codec: 'hevc' },
];

// 叠加文字: 片段名 + 片内位置(时间码)
function buildFilter(label) {
  const box = 'box=1:boxcolor=black@0.55:boxborderw=10';
  return [
    `drawtext=fontfile='${FONT}':text='${label}':x=24:y=24:fontsize=40:fontcolor=white:${box}`,
    `drawtext=fontfile='${FONT}':text='POS %{pts\\:hms}':x=24:y=h-72:fontsize=34:fontcolor=0xFFD400:${box}`,
  ].join(',');
}

function run(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpeg, args, { windowsHide: true });
    let err = '';
    child.stderr.on('data', (d) => { err += String(d); });
    child.on('error', (e) => reject(new Error(`无法执行 ffmpeg(${ffmpeg}): ${e.message}`)));
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(err.slice(-500)))));
  });
}

async function main() {
  fs.mkdirSync(SIM_DIR, { recursive: true });

  const manifest = [];
  for (const clip of CLIPS) {
    const out = path.join(SIM_DIR, clip.file);
    const common = [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'lavfi', '-i', `${clip.src}:duration=${DURATION}`,
      '-vf', buildFilter(clip.label),
      '-t', String(DURATION),
      '-an', // 无音轨: 浏览器允许静音自动播放
    ];
    const enc = clip.codec === 'hevc'
      ? ['-c:v', 'libx265', '-preset', 'veryfast', '-crf', '32', '-tag:v', 'hvc1', '-x265-params', 'log-level=error']
      : ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '30', '-pix_fmt', 'yuv420p', '-profile:v', 'main', '-g', '50'];

    process.stdout.write(`生成 ${clip.file} (${clip.codec}) ... `);
    await run([...common, ...enc, '-movflags', '+faststart', out]);
    const bytes = fs.statSync(out).size;
    console.log(`${(bytes / 1024).toFixed(1)} KB`);

    manifest.push({
      file: clip.file,
      label: clip.label,
      codec: clip.codec,
      durationMs: DURATION * 1000,
      bytes,
    });
  }

  fs.writeFileSync(
    path.join(SIM_DIR, 'manifest.json'),
    JSON.stringify({ generatedAt: new Date().toISOString(), durationMs: DURATION * 1000, clips: manifest }, null, 2)
  );
  console.log(`\n完成: ${manifest.length} 个片段 -> ${SIM_DIR}`);
  console.log(`  H264: ${manifest.filter((m) => m.codec === 'h264').map((m) => m.file).join(', ')}`);
  console.log(`  H265: ${manifest.filter((m) => m.codec === 'hevc').map((m) => m.file).join(', ')}`);
}

main().catch((e) => {
  console.error('生成失败:', e.message);
  process.exit(1);
});
