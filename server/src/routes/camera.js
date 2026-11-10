// 摄像头接口
// 字段: cameraName / id / videoUrl / imgUrl / address / addressNum / longitude / latitude / state / startTime / endTime
const path = require('path');
const router = require('express').Router();
const multer = require('multer');
const pool = require('../config/db');
const cameraSync = require('../services/cameraSync');
const { success, fail } = require('../utils/response');

// 视频上传配置(保存到 uploads/videos)
const videoStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.join(__dirname, '../../../uploads/videos')),
  filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`),
});
const upload = multer({ storage: videoStorage });

// 获取全部摄像头坐标(仅地图打点所需字段, 避免大字段拖慢响应)
// 返回 version: 数据版本号, 前端携带它调用 /changes 做增量同步
router.get('/all/positions', async (req, res, next) => {
  try {
    // 先取版本号再查数据: 查询期间新产生的变更会在下一次增量拉取时重复下发(幂等), 不会漏
    const version = cameraSync.getVersion();
    const structure = cameraSync.getStructureRev();
    const [rows] = await pool.query(
      'SELECT id, cameraName, longitude, latitude, state, type, address FROM camera'
    );
    success(res, { list: rows, version, structure, serverTime: Date.now() });
  } catch (e) { next(e); }
});

// 增量变更查询(?since=上次拿到的 version): 只返回这期间状态变化的摄像头
// full=true 表示版本不连续(如服务重启), 前端需重新全量拉取
router.get('/changes', (req, res, next) => {
  try {
    const result = cameraSync.changesSince(req.query.since);
    success(res, { ...result, serverTime: Date.now() });
  } catch (e) { next(e); }
});

// 手动触发一次"随机切换 N 台摄像头状态"(定时任务同款逻辑, 便于联调/演示)
router.post('/state/flip', async (req, res, next) => {
  try {
    const result = await cameraSync.flipRandomStates(req.body && req.body.count);
    success(res, result, `已随机切换 ${result.count} 台摄像头状态`);
  } catch (e) { next(e); }
});

// 同步中心运行状态(排查用)
router.get('/sync/status', (req, res) => {
  success(res, cameraSync.getStatus());
});

// 分页查询摄像头列表(支持关键字、在线状态、类别筛选)
router.get('/', async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const pageSize = Math.min(200, Math.max(1, parseInt(req.query.pageSize) || 20));
    const keyword = (req.query.keyword || '').trim();
    const state = req.query.state;
    const type = req.query.type;

    const where = [];
    const params = [];
    if (keyword) { where.push('cameraName LIKE ?'); params.push(`%${keyword}%`); }
    if (state !== undefined && state !== '') { where.push('state = ?'); params.push(state); }
    if (type !== undefined && type !== '') { where.push('type = ?'); params.push(type); }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total FROM camera ${whereSql}`, params);
    const [rows] = await pool.query(
      `SELECT * FROM camera ${whereSql} ORDER BY id LIMIT ? OFFSET ?`,
      [...params, pageSize, (page - 1) * pageSize]
    );
    success(res, { list: rows, total, page, pageSize });
  } catch (e) { next(e); }
});

// 摄像头详情
router.get('/:id', async (req, res, next) => {
  try {
    const [rows] = await pool.query('SELECT * FROM camera WHERE id = ?', [req.params.id]);
    if (!rows.length) return fail(res, '摄像头不存在', 404);
    success(res, rows[0]);
  } catch (e) { next(e); }
});

// 新增摄像头
router.post('/', async (req, res, next) => {
  try {
    const { cameraName, videoUrl, imgUrl, address, addressNum, longitude, latitude, state, type, startTime, endTime } = req.body;
    if (!cameraName) return fail(res, '摄像头名称不能为空');
    const [r] = await pool.query(
      `INSERT INTO camera (cameraName, videoUrl, imgUrl, address, addressNum, longitude, latitude, state, type, startTime, endTime)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [cameraName, videoUrl || '', imgUrl || '', address || '', addressNum || '',
       longitude || 0, latitude || 0, state === undefined ? 1 : state,
       type === undefined ? 1 : Number(type), startTime || null, endTime || null]
    );
    cameraSync.markStructure(); // 新增了一条记录 -> 结构变化, 前端下次同步会全量重建
    success(res, { id: r.insertId }, '新增成功');
  } catch (e) { next(e); }
});

// 修改摄像头
router.put('/:id', async (req, res, next) => {
  try {
    const { cameraName, videoUrl, imgUrl, address, addressNum, longitude, latitude, state, type, startTime, endTime } = req.body;
    const [old] = await pool.query('SELECT id FROM camera WHERE id = ?', [req.params.id]);
    if (!old.length) return fail(res, '摄像头不存在', 404);
    const nextState = state === undefined ? 1 : Number(state) === 1 ? 1 : 0;
    await pool.query(
      `UPDATE camera SET cameraName=?, videoUrl=?, imgUrl=?, address=?, addressNum=?,
       longitude=?, latitude=?, state=?, type=?, startTime=?, endTime=? WHERE id=?`,
      [cameraName, videoUrl || '', imgUrl || '', address || '', addressNum || '',
       longitude || 0, latitude || 0, nextState,
       type === undefined ? 1 : Number(type), startTime || null, endTime || null, req.params.id]
    );
    // 无论改的是状态还是名称/地址/类别/坐标, 都要推送快照:
    // 监控端只靠这条日志做增量更新, 漏推就会"后台改了但地图列表没变"
    await cameraSync.notifyCameras(req.params.id);
    success(res, null, '修改成功');
  } catch (e) { next(e); }
});

// 删除摄像头
router.delete('/:id', async (req, res, next) => {
  try {
    const [r] = await pool.query('DELETE FROM camera WHERE id = ?', [req.params.id]);
    if (!r.affectedRows) return fail(res, '摄像头不存在', 404);
    cameraSync.markStructure();
    success(res, null, '删除成功');
  } catch (e) { next(e); }
});

// 链接摄像头生成视频: 为指定摄像头设置视频流地址
router.post('/link', async (req, res, next) => {
  try {
    const { id, videoUrl } = req.body;
    if (!id || !videoUrl) return fail(res, '摄像头 id 和视频地址不能为空');
    await pool.query('UPDATE camera SET videoUrl = ?, state = 1 WHERE id = ?', [videoUrl, id]);
    await cameraSync.notifyCameras(id);
    success(res, null, '链接成功');
  } catch (e) { next(e); }
});

// 手动上传大视频生成离线摄像头
router.post('/upload', upload.single('video'), async (req, res, next) => {
  try {
    if (!req.file) return fail(res, '未收到视频文件');
    const { cameraName, address, addressNum, longitude, latitude } = req.body;
    // 视频保存在服务器, 生成离线摄像头(state = 0), 类别为「人工上传视频生成」
    const videoUrl = `/uploads/videos/${req.file.filename}`;
    const [r] = await pool.query(
      `INSERT INTO camera (cameraName, videoUrl, imgUrl, address, addressNum, longitude, latitude, state, type, startTime, endTime)
       VALUES (?, ?, '', ?, ?, ?, ?, 0, 2, NOW(), NULL)`,
      [cameraName || `离线摄像头-${Date.now()}`, videoUrl, address || '', addressNum || '', longitude || 0, latitude || 0]
    );
    cameraSync.markStructure(); // 生成了一台新摄像头
    success(res, { id: r.insertId, videoUrl }, '上传成功, 已生成离线摄像头');
  } catch (e) { next(e); }
});

// 上传视频到指定摄像头: 替换该摄像头的视频源并置为在线
// (区别于 POST /upload —— 那个是"上传视频生成一台新的离线摄像头")
router.post('/:id/video', upload.single('video'), async (req, res, next) => {
  try {
    if (!req.file) return fail(res, '未收到视频文件');
    const videoUrl = `/uploads/videos/${req.file.filename}`;
    const [r] = await pool.query(
      'UPDATE camera SET videoUrl = ?, state = 1 WHERE id = ?',
      [videoUrl, req.params.id]
    );
    if (!r.affectedRows) return fail(res, '摄像头不存在', 404);
    await cameraSync.notifyCameras(req.params.id);
    success(res, { id: Number(req.params.id), videoUrl, state: 1 }, '上传成功, 摄像头已置为在线');
  } catch (e) { next(e); }
});

// 修改摄像头在线状态(0 离线 / 1 在线)
router.patch('/:id/state', async (req, res, next) => {
  try {
    const state = Number(req.body.state);
    if (![0, 1].includes(state)) return fail(res, 'state 只能为 0 或 1');
    const [r] = await pool.query('UPDATE camera SET state = ? WHERE id = ?', [state, req.params.id]);
    if (!r.affectedRows) {
      // 值未变化时 affectedRows 为 0, 需再查一次确认是"不存在"还是"无变化"
      const [rows] = await pool.query('SELECT state FROM camera WHERE id = ?', [req.params.id]);
      if (!rows.length) return fail(res, '摄像头不存在', 404);
      // 无变化: 不记变更
      return success(res, { id: Number(req.params.id), state: Number(rows[0].state) }, '状态未变化');
    }
    await cameraSync.notifyCameras(req.params.id);
    success(res, { id: Number(req.params.id), state }, '状态修改成功');
  } catch (e) { next(e); }
});

module.exports = router;
