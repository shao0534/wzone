// 角色按钮状态接口: 控制两个子项目操作按钮的可用状态
const router = require('express').Router();
const pool = require('../config/db');
const { success, fail } = require('../utils/response');

// 获取全部按钮状态
router.get('/', async (req, res, next) => {
  try {
    const [rows] = await pool.query('SELECT * FROM role_button ORDER BY app, id');
    success(res, rows);
  } catch (e) { next(e); }
});

// 更新某个按钮的可用状态(enabled: 1 可用 / 0 禁用)
router.put('/:id', async (req, res, next) => {
  try {
    const { enabled } = req.body;
    await pool.query('UPDATE role_button SET enabled = ? WHERE id = ?', [enabled ? 1 : 0, req.params.id]);
    success(res, null, '更新成功');
  } catch (e) { next(e); }
});

module.exports = router;
