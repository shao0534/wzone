// 造 H265 模拟摄像头 + 给空视频源补上模拟流
// 用法: npm run seed-h265
//
// 说明:
//   1. 名称带 H265 字段的摄像头, 人工上传(type=2, 点播)与实时流(type=1/3)两类都有
//   2. 已有摄像头里 videoUrl 为空的, 补一个模拟样本(不改名, 不动已有视频)
// 幂等: 重复执行不会重复插入(按名称前缀 'H265-' 判断)
const fs = require('fs');
const path = require('path');
const pool = require('../config/db');

const SIM_DIR = path.join(__dirname, '../../../uploads/videos/sim');
const MANIFEST = path.join(SIM_DIR, 'manifest.json');

// 目标数量
const LIVE_COUNT = 24; // 实时流 H265
const VOD_COUNT = 16;  // 人工上传(点播) H265

const DISTRICTS = ['朝阳区', '海淀区', '西城区', '东城区', '丰台区', '大兴区', '通州区', '石景山区'];
const ROADS = ['建国路', '中关村大街', '金融街', '长安街', '南三环西路', '亦庄经海路', '新华大街', '阜石路'];

function pad(n, len = 3) {
  return String(n).padStart(len, '0');
}

// 北京范围内确定性坐标(避免每次运行抖动)
function coord(i) {
  const lng = 116.12 + ((i * 137) % 560) / 1000;
  const lat = 39.74 + ((i * 91) % 330) / 1000;
  return [Number(lng.toFixed(6)), Number(lat.toFixed(6))];
}

async function main() {
  if (!fs.existsSync(MANIFEST)) {
    console.error('缺少样本清单, 请先执行: npm run gen-samples');
    process.exit(1);
  }
  const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  const h265 = manifest.clips.filter((c) => c.codec === 'hevc');
  const h264 = manifest.clips.filter((c) => c.codec === 'h264');
  if (!h265.length) {
    console.error('清单里没有 H265 片段, 请重新执行 npm run gen-samples');
    process.exit(1);
  }

  // ---------------- 1. 给空视频源补模拟流 ----------------
  const h264Urls = h264.map((c) => `/uploads/videos/sim/${c.file}`);
  const eltList = h264Urls.map(() => '?').join(', ');

  const [fillLive] = await pool.query(
    `UPDATE camera SET videoUrl = ELT(MOD(id, ${h264Urls.length}) + 1, ${eltList})
     WHERE (videoUrl IS NULL OR videoUrl = '') AND type <> 2`,
    h264Urls
  );
  const [fillVod] = await pool.query(
    `UPDATE camera SET videoUrl = ELT(MOD(id, ${h264Urls.length}) + 1, ${eltList})
     WHERE (videoUrl IS NULL OR videoUrl = '') AND type = 2`,
    h264Urls
  );
  console.log(`[补流] 实时摄像头 +${fillLive.affectedRows} 台, 点播摄像头 +${fillVod.affectedRows} 台`);

  // ---------------- 2. 造 H265 摄像头 ----------------
  const [[{ exist }]] = await pool.query(
    "SELECT COUNT(*) AS exist FROM camera WHERE cameraName LIKE 'H265-%'"
  );
  if (exist >= LIVE_COUNT + VOD_COUNT) {
    console.log(`[H265] 已存在 ${exist} 台, 跳过创建`);
  } else {
    const rows = [];

    // 实时流: type 1(普通) / 3(车辆) 交替, 在线
    for (let i = 0; i < LIVE_COUNT; i++) {
      const [lng, lat] = coord(i + 1);
      const clip = h265[i % h265.length];
      const type = i % 2 === 0 ? 1 : 3;
      const district = DISTRICTS[i % DISTRICTS.length];
      const road = ROADS[(i * 3) % ROADS.length];
      rows.push([
        `H265-实时-${type === 3 ? '车辆' : '普通'}-${pad(i + 1)}`,
        `/uploads/videos/sim/${clip.file}`,
        '',
        `北京市${district}${road}${10 + i}号`,
        `BJ${district}H265${pad(i + 1)}`,
        lng,
        lat,
        1, // 在线
        type,
      ]);
    }

    // 点播: type 2(人工上传视频生成), 保持离线 —— 点播不依赖在线状态
    for (let i = 0; i < VOD_COUNT; i++) {
      const [lng, lat] = coord(i + 501);
      const clip = h265[(i + 1) % h265.length];
      const district = DISTRICTS[(i + 3) % DISTRICTS.length];
      const road = ROADS[(i * 5) % ROADS.length];
      rows.push([
        `H265-回放-人工上传-${pad(i + 1)}`,
        `/uploads/videos/sim/${clip.file}`,
        '',
        `北京市${district}${road}${100 + i}号`,
        `BJ${district}H265V${pad(i + 1)}`,
        lng,
        lat,
        0, // 离线
        2,
      ]);
    }

    await pool.query(
      `INSERT INTO camera (cameraName, videoUrl, imgUrl, address, addressNum, longitude, latitude, state, type)
       VALUES ?`,
      [rows]
    );
    console.log(`[H265] 新增 ${rows.length} 台(${LIVE_COUNT} 实时 + ${VOD_COUNT} 人工上传点播)`);
  }

  // ---------------- 3. 汇总 ----------------
  const [[stat]] = await pool.query(
    `SELECT
       SUM(cameraName LIKE 'H265-%') AS h265Total,
       SUM(cameraName LIKE 'H265-%' AND type = 2) AS h265Vod,
       SUM(videoUrl <> '') AS withVideo,
       COUNT(*) AS total
     FROM camera`
  );
  console.log('[汇总]', {
    总数: Number(stat.total),
    有视频源: Number(stat.withVideo),
    H265总数: Number(stat.h265Total),
    H265点播: Number(stat.h265Vod),
  });

  await pool.end();
}

main().catch(async (e) => {
  console.error('执行失败:', e);
  try { await pool.end(); } catch {}
  process.exit(1);
});
