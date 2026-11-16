// 按钮状态修改申请接口: 子项目提交申请 -> 角色菜单审核 -> 通过后按申请者角色同步按钮状态
// 申请必须登录(服务端从 token 解出角色, 不信任前端传入); 审核仅管理员。
const router = require('express').Router();
const pool = require('../config/db');
const authService = require('../services/authService');
const notifier = require('../services/notifier');
const requireAdmin = require('../middleware/requireAdmin');
const { success, fail } = require('../utils/response');

function bearerToken(req) {
  const header = req.headers.authorization || '';
  return header.startsWith('Bearer ') ? header.slice(7).trim() : '';
}

// 申请列表
router.get('/', async (req, res, next) => {
  try {
    const [rows] = await pool.query('SELECT * FROM application ORDER BY id DESC');
    success(res, rows);
  } catch (e) { next(e); }
});

// 提交申请(requestAction: 1 申请启用 / 0 申请禁用)
router.post('/', async (req, res, next) => {
  try {
    const { app, buttonKey, buttonLabel, requestAction, reason } = req.body;
    if (!app || !buttonKey) return fail(res, '参数不完整');

    // 申请者身份以服务端解出的为准, 前端传值不参与
    const user = await authService.currentUser(bearerToken(req)).catch(() => null);
    if (!user) return fail(res, '请先登录后再提交申请', 401);

    await pool.query(
      'INSERT INTO application (app, buttonKey, buttonLabel, applicant, role, requestAction, reason, status) VALUES (?, ?, ?, ?, ?, ?, ?, 0)',
      [app, buttonKey, buttonLabel || '', user.name || '', user.role, requestAction ? 1 : 0, reason || '']
    );
    success(res, null, '申请已提交');
    // 实时通知所有在线客户端(铃铛角标/角色菜单列表秒级刷新)
    notifier.pushAll({ type: 'application:changed' });
  } catch (e) { next(e); }
});

// 审核申请(status: 1 通过 / 2 拒绝); 通过时只更新「申请者角色」对应的按钮配置
router.put('/:id', requireAdmin, async (req, res, next) => {
  try {
    const { status } = req.body; // 1 或 2
    const [rows] = await pool.query('SELECT * FROM application WHERE id = ?', [req.params.id]);
    if (!rows.length) return fail(res, '申请不存在', 404);

    const app = rows[0];
    await pool.query('UPDATE application SET status = ? WHERE id = ?', [status, req.params.id]);

    // 审核通过时, 同步修改该角色下的按钮可用状态
    if (Number(status) === 1) {
      await pool.query(
        'UPDATE role_button SET enabled = ? WHERE app = ? AND buttonKey = ? AND role = ?',
        [app.requestAction, app.app, app.buttonKey, app.role]
      );
    }
    success(res, null, Number(status) === 1 ? '已通过' : '已拒绝');
    // 审核会改变按钮可用状态, 广播所有在线客户端同步(含子应用按钮显隐)
    notifier.pushAll({ type: 'application:changed' });
  } catch (e) { next(e); }
});

module.exports = router;
