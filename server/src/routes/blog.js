// 我的博客接口: title / context / dateTime / id
const router = require('express').Router();
const pool = require('../config/db');
const { success, fail } = require('../utils/response');

// 博客列表(按时间倒序)
router.get('/', async (req, res, next) => {
  try {
    const [rows] = await pool.query('SELECT * FROM blog ORDER BY dateTime DESC');
    success(res, rows);
  } catch (e) { next(e); }
});

// 博客详情
router.get('/:id', async (req, res, next) => {
  try {
    const [rows] = await pool.query('SELECT * FROM blog WHERE id = ?', [req.params.id]);
    if (!rows.length) return fail(res, '博客不存在', 404);
    success(res, rows[0]);
  } catch (e) { next(e); }
});

// 新增博客
router.post('/', async (req, res, next) => {
  try {
    const { title, context } = req.body;
    if (!title || !context) return fail(res, '标题和内容不能为空');
    const [r] = await pool.query(
      'INSERT INTO blog (title, context, dateTime) VALUES (?, ?, NOW())',
      [title, context]
    );
    success(res, { id: r.insertId }, '新增成功');
  } catch (e) { next(e); }
});

// 修改博客
router.put('/:id', async (req, res, next) => {
  try {
    const { title, context } = req.body;
    await pool.query('UPDATE blog SET title = ?, context = ? WHERE id = ?', [title, context, req.params.id]);
    success(res, null, '修改成功');
  } catch (e) { next(e); }
});

// 删除博客
router.delete('/:id', async (req, res, next) => {
  try {
    await pool.query('DELETE FROM blog WHERE id = ?', [req.params.id]);
    success(res, null, '删除成功');
  } catch (e) { next(e); }
});

module.exports = router;
