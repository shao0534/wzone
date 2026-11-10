// 按钮状态修改申请接口: 子项目提交申请 -> 角色菜单审核 -> 通过后同步按钮状态
const router = require('express').Router();
const pool = require('../config/db');
const { success, fail } = require('../utils/response');

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
    await pool.query(
      'INSERT INTO application (app, buttonKey, buttonLabel, requestAction, reason, status) VALUES (?, ?, ?, ?, ?, 0)',
      [app, buttonKey, buttonLabel || '', requestAction ? 1 : 0, reason || '']
    );
    success(res, null, '申请已提交');
  } catch (e) { next(e); }
});

// 审核申请(status: 1 通过 / 2 拒绝); 通过时同步更新角色按钮状态
router.put('/:id', async (req, res, next) => {
  try {
    const { status } = req.body; // 1 或 2
    const [rows] = await pool.query('SELECT * FROM application WHERE id = ?', [req.params.id]);
    if (!rows.length) return fail(res, '申请不存在', 404);

    const app = rows[0];
    await pool.query('UPDATE application SET status = ? WHERE id = ?', [status, req.params.id]);

    // 审核通过时, 同步修改按钮可用状态
    if (Number(status) === 1) {
      await pool.query(
        'UPDATE role_button SET enabled = ? WHERE app = ? AND buttonKey = ?',
        [app.requestAction, app.app, app.buttonKey]
      );
    }
    success(res, null, Number(status) === 1 ? '已通过' : '已拒绝');
  } catch (e) { next(e); }
});

module.exports = router;
