// 角色按钮权限接口
// - GET /        全量配置行(含 role), 供角色菜单页渲染配置界面
// - GET /buttons 当前登录用户视角的按钮可用 map(`${app}.${buttonKey}` -> bool),
//                是主应用与两个子应用按钮显隐的统一数据源; 无/无效 token 返回全 false(fail closed)
// - PUT /:id     更新某行开关, 仅管理员
const router = require('express').Router();
const pool = require('../config/db');
const notifier = require('../services/notifier');
const authService = require('../services/authService');
const requireAdmin = require('../middleware/requireAdmin');
const { success, fail } = require('../utils/response');

function bearerToken(req) {
  const header = req.headers.authorization || '';
  return header.startsWith('Bearer ') ? header.slice(7).trim() : '';
}

// 全量配置行(角色菜单页用: 每个按钮 × 两种角色各一行)
router.get('/', async (req, res, next) => {
  try {
    const [rows] = await pool.query('SELECT * FROM role_button ORDER BY app, buttonKey, role');
    success(res, rows);
  } catch (e) { next(e); }
});

// 当前用户视角的按钮可用 map(fail closed: 缺行/禁用/未登录一律 false)
router.get('/buttons', async (req, res, next) => {
  try {
    const user = await authService.currentUser(bearerToken(req)).catch(() => null);
    // 所有按钮键的集合: 以全部配置行(distinct app+buttonKey)为准, 保证 map 键全量
    const [keys] = await pool.query('SELECT DISTINCT app, buttonKey FROM role_button');
    const [open] = user
      ? await pool.query('SELECT app, buttonKey FROM role_button WHERE role = ? AND enabled = 1', [user.role])
      : [[]];

    const enabledSet = new Set(open.map((r) => `${r.app}.${r.buttonKey}`));
    const buttons = {};
    keys.forEach((r) => { buttons[`${r.app}.${r.buttonKey}`] = enabledSet.has(`${r.app}.${r.buttonKey}`); });

    success(res, { role: user ? user.role : null, buttons });
  } catch (e) { next(e); }
});

// 更新某行开关(enabled: 1 可用 / 0 禁用), 仅管理员
router.put('/:id', requireAdmin, async (req, res, next) => {
  try {
    const { enabled } = req.body;
    await pool.query('UPDATE role_button SET enabled = ? WHERE id = ?', [enabled ? 1 : 0, req.params.id]);
    success(res, null, '更新成功');
    // 权限配置变更广播所有在线客户端, 子应用按钮显隐实时同步
    notifier.pushAll({ type: 'application:changed' });
  } catch (e) { next(e); }
});

module.exports = router;
