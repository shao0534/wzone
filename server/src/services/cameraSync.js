// 摄像头数据同步中心
// 1. 维护单调递增的变更版本号 + 变更日志, 供前端「增量拉取」(只取变化的那几十条)
// 2. 维护结构版本号(新增/删除摄像头), 前端发现结构变化时才会全量重建
// 3. 后台定时任务: 每 30s 随机挑 100 台摄像头切换在线/离线
//
// 变更日志为什么记「完整字段快照」而不是只记 state:
// 管理后台除了改状态, 还会改名称/地址/类别/经纬度, 这些字段前端同样要跟着变;
// 若只下发 { id, state }, 前端拿不到新名称和新坐标, 修改永远不会同步到监控端。
const pool = require('../config/db');

const MAX_LOG = 20000;                  // 变更日志上限(100 条/轮 -> 可回溯约 200 轮)
const DEFAULT_FLIP_COUNT = 100;         // 每轮随机切换的数量
const DEFAULT_FLIP_INTERVAL = 30000;    // 每轮间隔(ms)
// 变更快照字段: 与前端 Worker 清洗所需字段保持一致, 避免全量字段拖慢响应
const SNAPSHOT_FIELDS = 'id, cameraName, longitude, latitude, state, type, address';

let version = 0;          // 数据版本号: 任何一条记录的字段变化都会 +1
let changeLog = [];       // [{ id, cameraName, longitude, latitude, state, type, address, v }]
let structureRev = 0;     // 结构版本号: 增删摄像头时 +1
let flipTimer = null;
let lastFlipAt = 0;
let lastFlipCount = 0;

function getVersion() {
  return version;
}

function getStructureRev() {
  return structureRev;
}

/** 把数据库行收敛成前端需要的最小快照(数值化 + 裁剪非法类别) */
function toSnapshot(row) {
  const type = Number(row.type);
  return {
    id: Number(row.id),
    cameraName: row.cameraName == null ? '' : String(row.cameraName),
    longitude: Number(row.longitude),
    latitude: Number(row.latitude),
    state: Number(row.state) === 1 ? 1 : 0,
    type: type === 2 || type === 3 ? type : 1,
    address: row.address == null ? '' : String(row.address),
  };
}

/** 记录一批摄像头的最新快照(同一版本号), 返回新版本号 */
function record(rows) {
  if (!rows || !rows.length) return version;
  version += 1;
  for (let i = 0; i < rows.length; i++) {
    changeLog.push({ ...toSnapshot(rows[i]), v: version });
  }
  if (changeLog.length > MAX_LOG) changeLog = changeLog.slice(-MAX_LOG);
  return version;
}

/**
 * 增删改之后统一调用: 回查这批 id 的最新快照并写入变更日志
 * 必须在 UPDATE/INSERT 之后调用, 保证下发的是"落库后的真实值"
 */
async function notifyCameras(ids) {
  const list = (Array.isArray(ids) ? ids : [ids])
    .map((n) => Number(n))
    .filter((n) => Number.isFinite(n) && n > 0);
  if (!list.length) return version;
  const [rows] = await pool.query(`SELECT ${SNAPSHOT_FIELDS} FROM camera WHERE id IN (?)`, [list]);
  return record(rows);
}

/** 结构变更(新增/删除摄像头): 前端拿到变化的 structure 后会做一次全量重建 */
function markStructure() {
  structureRev += 1;
  return structureRev;
}

/**
 * 拉取 since 之后的状态变更
 * - 版本号超前/落后(例如服务重启后版本归零) 或日志已被裁剪 -> full = true, 让前端全量重建
 */
function changesSince(rawSince) {
  const since = Number(rawSince);
  if (!Number.isFinite(since) || since < 0 || since > version) {
    return { version, structure: structureRev, full: true, list: [] };
  }
  if (since === version) {
    return { version, structure: structureRev, full: false, list: [] };
  }
  const oldest = changeLog.length ? changeLog[0].v : version;
  if (since + 1 < oldest) {
    // 中间有日志缺口, 无法保证增量完整
    return { version, structure: structureRev, full: true, list: [] };
  }
  // 同一台摄像头在区间内被改了多次, 只保留最后一次(增量对比前置收敛, 减少传输量)
  const latest = new Map();
  for (let i = 0; i < changeLog.length; i++) {
    const item = changeLog[i];
    if (item.v > since) latest.set(item.id, item);
  }
  // v 是内部游标, 不下发
  const list = [];
  latest.forEach((item) => {
    const { v, ...snapshot } = item;
    list.push(snapshot);
  });
  return { version, structure: structureRev, full: false, list };
}

/**
 * 随机切换 n 台摄像头的在线状态
 * ① 随机取 id ② 批量取反 ③ 回查最新状态写入变更日志
 */
async function flipRandomStates(count = DEFAULT_FLIP_COUNT) {
  const n = Math.max(1, Math.min(1000, Number(count) || DEFAULT_FLIP_COUNT));
  const [rows] = await pool.query('SELECT id FROM camera ORDER BY RAND() LIMIT ?', [n]);
  if (!rows.length) return { count: 0, version, at: Date.now() };

  const ids = rows.map((r) => r.id);
  await pool.query('UPDATE camera SET state = IF(state = 1, 0, 1) WHERE id IN (?)', [ids]);
  const [after] = await pool.query(
    `SELECT ${SNAPSHOT_FIELDS} FROM camera WHERE id IN (?)`,
    [ids]
  );

  record(after);
  lastFlipAt = Date.now();
  lastFlipCount = after.length;
  return { count: after.length, version, at: lastFlipAt };
}

/** 启动后台定时任务(每 intervalMs 毫秒随机切换 count 台) */
function startAutoFlip(intervalMs = DEFAULT_FLIP_INTERVAL, count = DEFAULT_FLIP_COUNT) {
  if (flipTimer) return;
  flipTimer = setInterval(() => {
    flipRandomStates(count).catch((e) => {
      console.error('[cameraSync] 随机切换摄像头状态失败:', e && e.message ? e.message : e);
    });
  }, intervalMs);
  // 定时任务不应阻止进程退出
  if (typeof flipTimer.unref === 'function') flipTimer.unref();
  console.log(`[cameraSync] 后台任务已启动: 每 ${Math.round(intervalMs / 1000)}s 随机切换 ${count} 台摄像头状态`);
}

function stopAutoFlip() {
  if (flipTimer) {
    clearInterval(flipTimer);
    flipTimer = null;
  }
}

function getStatus() {
  return { version, structure: structureRev, logSize: changeLog.length, lastFlipAt, lastFlipCount, running: !!flipTimer };
}

module.exports = {
  DEFAULT_FLIP_COUNT,
  DEFAULT_FLIP_INTERVAL,
  getVersion,
  getStructureRev,
  record,
  notifyCameras,
  markStructure,
  changesSince,
  flipRandomStates,
  startAutoFlip,
  stopAutoFlip,
  getStatus,
};
