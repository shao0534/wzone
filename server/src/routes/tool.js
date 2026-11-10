// 我的工具接口: name / description / link / id / mdcode(安装使用说明)
const router = require('express').Router();
const pool = require('../config/db');
const { success, fail } = require('../utils/response');

// 工具列表
router.get('/', async (req, res, next) => {
  try {
    const [rows] = await pool.query('SELECT * FROM tool ORDER BY id');
    success(res, rows);
  } catch (e) { next(e); }
});

// 工具详情
router.get('/:id', async (req, res, next) => {
  try {
    const [rows] = await pool.query('SELECT * FROM tool WHERE id = ?', [req.params.id]);
    if (!rows.length) return fail(res, '工具不存在', 404);
    success(res, rows[0]);
  } catch (e) { next(e); }
});

// 新增工具
router.post('/', async (req, res, next) => {
  try {
    const { name, description, link, mdcode } = req.body;
    if (!name) return fail(res, '工具名称不能为空');
    const [r] = await pool.query(
      'INSERT INTO tool (name, description, link, mdcode) VALUES (?, ?, ?, ?)',
      [name, description || '', link || '', mdcode || '']
    );
    success(res, { id: r.insertId }, '新增成功');
  } catch (e) { next(e); }
});

// 修改工具
router.put('/:id', async (req, res, next) => {
  try {
    const { name, description, link, mdcode } = req.body;
    await pool.query(
      'UPDATE tool SET name = ?, description = ?, link = ?, mdcode = ? WHERE id = ?',
      [name, description || '', link || '', mdcode || '', req.params.id]
    );
    success(res, null, '修改成功');
  } catch (e) { next(e); }
});

// 删除工具
router.delete('/:id', async (req, res, next) => {
  try {
    await pool.query('DELETE FROM tool WHERE id = ?', [req.params.id]);
    success(res, null, '删除成功');
  } catch (e) { next(e); }
});

module.exports = router;
