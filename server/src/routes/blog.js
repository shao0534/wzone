// 我的博客接口: 读取公开, 写操作仅管理员(requireAdmin 中间件统一校验)
const router = require('express').Router();
const pool = require('../config/db');
const { success, fail } = require('../utils/response');
const requireAdmin = require('../middleware/requireAdmin');

const MAX_TITLE_LEN = 255;
const MAX_CONTEXT_BYTES = 4 * 1024 * 1024; // 与 MEDIUMTEXT(16MB) 留足余量

/** 统一校验写入字段, 返回 { title, context } 或 { error } */
function parseBody(body) {
  const title = typeof body?.title === 'string' ? body.title.trim() : '';
  const context = typeof body?.context === 'string' ? body.context : '';
  if (!title) return { error: '标题不能为空' };
  if (title.length > MAX_TITLE_LEN) return { error: `标题不能超过 ${MAX_TITLE_LEN} 个字符` };
  if (!context.trim()) return { error: '内容不能为空' };
  if (Buffer.byteLength(context, 'utf8') > MAX_CONTEXT_BYTES) return { error: '内容过大，请控制在 4MB 以内' };
  return { title, context };
}

// ---------- 读取: 所有登录用户(含普通用户)都可查看 ----------

// 博客列表(按时间倒序)
router.get('/', async (req, res, next) => {
  try {
    const [rows] = await pool.query('SELECT * FROM blog ORDER BY dateTime DESC, id DESC');
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

// ---------- 写入: 仅管理员 ----------

// 新增博客
router.post('/', requireAdmin, async (req, res, next) => {
  try {
    const parsed = parseBody(req.body);
    if (parsed.error) return fail(res, parsed.error, 400);
    const [r] = await pool.query(
      'INSERT INTO blog (title, context, dateTime) VALUES (?, ?, NOW())',
      [parsed.title, parsed.context]
    );
    const [rows] = await pool.query('SELECT * FROM blog WHERE id = ?', [r.insertId]);
    success(res, rows[0], '新增成功');
  } catch (e) { next(e); }
});

// 修改博客(不改发布时间)
router.put('/:id', requireAdmin, async (req, res, next) => {
  try {
    const parsed = parseBody(req.body);
    if (parsed.error) return fail(res, parsed.error, 400);
    const [exists] = await pool.query('SELECT id FROM blog WHERE id = ?', [req.params.id]);
    if (!exists.length) return fail(res, '博客不存在', 404);
    await pool.query('UPDATE blog SET title = ?, context = ? WHERE id = ?', [parsed.title, parsed.context, req.params.id]);
    const [rows] = await pool.query('SELECT * FROM blog WHERE id = ?', [req.params.id]);
    success(res, rows[0], '修改成功');
  } catch (e) { next(e); }
});

// 删除博客
router.delete('/:id', requireAdmin, async (req, res, next) => {
  try {
    const [exists] = await pool.query('SELECT id, title FROM blog WHERE id = ?', [req.params.id]);
    if (!exists.length) return fail(res, '博客不存在', 404);
    await pool.query('DELETE FROM blog WHERE id = ?', [req.params.id]);
    success(res, null, '删除成功');
  } catch (e) { next(e); }
});

module.exports = router;
