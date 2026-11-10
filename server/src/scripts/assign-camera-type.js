// 为现有摄像头分配「类别」(type), 可重复执行
// type: 1 普通摄像头 / 2 人工上传视频生成的摄像头 / 3 车辆摄像头
// 分配比例: 普通 68% / 车辆 20% / 人工上传 12%
const pool = require('../config/db');

const RATIO = { normal: 0.68, vehicle: 0.20, upload: 0.12 };

async function run() {
  console.log('[assign-type] 开始为摄像头分配类别...');

  // 1. 全部重置为普通摄像头
  const [reset] = await pool.query('UPDATE camera SET type = 1');
  console.log(`[assign-type] 重置为普通摄像头: ${reset.affectedRows} 条`);

  const [[{ total }]] = await pool.query('SELECT COUNT(*) AS total FROM camera');
  const vehicleCnt = Math.round(total * RATIO.vehicle);
  const uploadCnt = Math.round(total * RATIO.upload);

  // 2. 随机挑一部分改为车辆摄像头
  const [v] = await pool.query('UPDATE camera SET type = 3 ORDER BY RAND() LIMIT ?', [vehicleCnt]);
  // 3. 再从剩余的普通摄像头里随机挑一部分改为人工上传
  const [u] = await pool.query('UPDATE camera SET type = 2 WHERE type = 1 ORDER BY RAND() LIMIT ?', [uploadCnt]);

  console.log(`[assign-type] 车辆摄像头: ${v.affectedRows} 条 | 人工上传: ${u.affectedRows} 条`);

  // 4. 让「同一点位的多台摄像头」类型尽量不同, 便于在聚合提示里展示不同类别图标
  const [diversify] = await pool.query(
    `UPDATE camera c JOIN (
       SELECT longitude, latitude, MAX(id) AS maxId
       FROM camera
       GROUP BY longitude, latitude
       HAVING COUNT(*) > 1 AND COUNT(DISTINCT type) = 1
     ) t ON c.id = t.maxId
     SET c.type = IF(c.type = 1, 3, 1)`
  );
  console.log(`[assign-type] 多点位类型多样化: 调整 ${diversify.affectedRows} 台`);

  // 5. 校验: 各类数量 + 同点位是否出现混合类别
  const [rows] = await pool.query(
    'SELECT type, COUNT(*) AS cnt FROM camera GROUP BY type ORDER BY type'
  );
  const label = { 1: '普通摄像头', 2: '人工上传', 3: '车辆摄像头' };
  rows.forEach((r) => console.log(`  type=${r.type} ${label[r.type] || ''}: ${r.cnt} 条`));

  const [[mix]] = await pool.query(
    `SELECT COUNT(*) AS sites FROM (
       SELECT longitude, latitude, COUNT(DISTINCT type) AS kinds
       FROM camera GROUP BY longitude, latitude HAVING kinds > 1
     ) t`
  );
  console.log(`[assign-type] 同点位包含多种类别的点位数: ${mix.sites || 0}`);

  process.exit(0);
}

run().catch((e) => { console.error('[assign-type] 失败:', e.message); process.exit(1); });
