// 生成 10000 条北京市内模拟摄像头数据(名称以「爱北京」开头, 70% 在线)
// 经纬度分布在北京城区范围内, 用于与高德地图联动打点
const pool = require('../config/db');

// 北京城区经纬度范围(覆盖东城/西城/朝阳/海淀/丰台/石景山及周边)
const BEIJING = {
  lngMin: 116.10, lngMax: 116.72,
  latMin: 39.72, latMax: 40.10,
};

// 北京行政区
const DISTRICTS = [
  '东城区', '西城区', '朝阳区', '海淀区', '丰台区', '石景山区',
  '通州区', '大兴区', '昌平区', '顺义区', '房山区', '门头沟区',
];

// 常见道路/地标(用于拼地址)
const ROADS = [
  '长安街', '王府井大街', '中关村大街', '建国路', '朝阳门外大街',
  '复兴路', '西单北大街', '学院路', '平安大街', '广安路',
  '北三环', '东三环', '南三环', '西三环', '二环路',
];

// 示例视频地址(在线摄像头使用)
const SAMPLE_VIDEO = 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4';

function rand(min, max) { return min + Math.random() * (max - min); }
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function fmt(d) { return d.toISOString().slice(0, 19).replace('T', ' '); }

// 批量插入
async function insertBatch(batch) {
  const sql = `INSERT INTO camera
    (cameraName, videoUrl, imgUrl, address, addressNum, longitude, latitude, state, type, startTime, endTime)
    VALUES ?`;
  await pool.query(sql, [batch]);
}

// 摄像头类别: 1 普通 / 2 人工上传视频生成 / 3 车辆摄像头
// 生成时按比例随机, 便于验证三类图标
function randomType() {
  const r = Math.random();
  if (r < 0.2) return 3;
  if (r < 0.32) return 2;
  return 1;
}

async function run() {
  console.log('[seed-cameras] 开始生成 10000 条北京市内摄像头数据(名称以「爱北京」开头)...');
  // 清空旧数据: 用 DELETE 而非 TRUNCATE, 避免需要 DROP 权限(dashu 用户仅增删改查)
  await pool.query('DELETE FROM camera');

  const TOTAL = 10000;
  const BATCH_SIZE = 500;
  const batch = [];

  for (let i = 0; i < TOTAL; i++) {
    const lng = rand(BEIJING.lngMin, BEIJING.lngMax).toFixed(6);
    const lat = rand(BEIJING.latMin, BEIJING.latMax).toFixed(6);
    const online = Math.random() > 0.3; // 70% 在线
    const district = pick(DISTRICTS);
    const road = pick(ROADS);
    const start = new Date(Date.now() - rand(0, 365) * 86400000);
    const end = new Date(start.getTime() + rand(1, 30) * 86400000);

    batch.push([
      `爱北京-监控点-${String(i + 1).padStart(5, '0')}`,
      online ? SAMPLE_VIDEO : '',
      '',
      `北京市${district}${road}${Math.floor(rand(1, 999))}号`,
      `BJ${district}${Math.floor(rand(100000, 999999))}`,
      lng, lat,
      online ? 1 : 0,
      randomType(),
      fmt(start), fmt(end),
    ]);

    if (batch.length >= BATCH_SIZE) {
      await insertBatch(batch);
      batch.length = 0;
      process.stdout.write(`\r已生成 ${i + 1} / ${TOTAL}`);
    }
  }
  if (batch.length) await insertBatch(batch);

  console.log('\n[seed-cameras] 完成: 10000 条北京市内摄像头数据');
  process.exit(0);
}

run().catch((e) => { console.error('[seed-cameras] 失败:', e.message); process.exit(1); });
