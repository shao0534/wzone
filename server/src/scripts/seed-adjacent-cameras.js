// 生成「同一路口多摄像头」场景数据
// 做法: 从已有「爱北京-监控点」中随机挑若干个点位当作路口,
//       在**完全相同的经纬度**上再插入 2~4 台摄像头, 名称为「爱北京-相邻-xxxxx」。
// 这样地图上一个坐标就会对应多台摄像头, 用于验证点位聚合与多摄像头交互。
// 脚本可重复执行(每次先清掉旧的「爱北京-相邻」数据)。
const pool = require('../config/db');

// 路口数量(每个路口插入 2~4 台)
const CLUSTER_COUNT = 120;
// 在线比例
const ONLINE_RATE = 0.8;
// 示例视频地址
const SAMPLE_VIDEO = 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4';

function rand(min, max) { return min + Math.random() * (max - min); }
function fmt(d) { return d.toISOString().slice(0, 19).replace('T', ' '); }

async function run() {
  console.log('[seed-adjacent] 生成同路口多摄像头数据...');

  // 1. 清理旧的相邻数据
  const [del] = await pool.query("DELETE FROM camera WHERE cameraName LIKE '爱北京-相邻%'");
  console.log(`[seed-adjacent] 已清理旧数据 ${del.affectedRows} 条`);

  // 2. 随机挑选路口(以现有点位的地址与经纬度为基准)
  const [roads] = await pool.query(
    `SELECT address, longitude, latitude FROM camera
     WHERE cameraName LIKE '爱北京-监控点%'
     ORDER BY RAND() LIMIT ?`,
    [CLUSTER_COUNT]
  );
  if (!roads.length) {
    console.error('[seed-adjacent] 没有可用的基准点位, 请先执行 seed-cameras');
    process.exit(1);
  }

  // 3. 同一坐标插入 2~4 台摄像头
  const rows = [];
  let seq = 0;
  for (const r of roads) {
    const n = 2 + Math.floor(Math.random() * 3); // 2 ~ 4 台
    for (let i = 0; i < n; i++) {
      seq += 1;
      const online = Math.random() < ONLINE_RATE;
      const now = new Date(Date.now() - rand(0, 180) * 86400000);
      rows.push([
        `爱北京-相邻-${String(seq).padStart(5, '0')}`,
        online ? SAMPLE_VIDEO : '',
        '',
        r.address || '北京市未知路口',
        `BJ-ADJ-${String(seq).padStart(5, '0')}`,
        r.longitude, // 与基准点位完全一致
        r.latitude,
        online ? 1 : 0,
        // 路口场景偏车辆摄像头: 一半车辆、三成普通、两成人工上传
        Math.random() < 0.5 ? 3 : Math.random() < 0.6 ? 1 : 2,
        fmt(now), null,
      ]);
    }
  }

  // 4. 批量插入
  const BATCH_SIZE = 200;
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    await pool.query(
      `INSERT INTO camera
        (cameraName, videoUrl, imgUrl, address, addressNum, longitude, latitude, state, type, startTime, endTime)
       VALUES ?`,
      [rows.slice(i, i + BATCH_SIZE)]
    );
  }

  // 5. 校验: 统计"同坐标多摄像头"的点位情况
  const [[stat]] = await pool.query(
    `SELECT COUNT(*) AS sites, SUM(cnt) AS cameras FROM (
       SELECT longitude, latitude, COUNT(*) AS cnt FROM camera
       GROUP BY longitude, latitude HAVING cnt > 1
     ) t`
  );
  const [[total]] = await pool.query('SELECT COUNT(*) AS total FROM camera');

  console.log(
    `[seed-adjacent] 完成: 新增 ${rows.length} 台摄像头, 覆盖 ${roads.length} 个路口\n` +
    `[seed-adjacent] 当前库内共 ${total.total} 条; 同坐标多摄像头点位 ${stat.sites || 0} 个, 涉及摄像头 ${stat.cameras || 0} 台`
  );
  process.exit(0);
}

run().catch((e) => {
  console.error('[seed-adjacent] 失败:', e.message);
  process.exit(1);
});
