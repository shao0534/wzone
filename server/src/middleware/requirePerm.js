// 操作权限中间件: 按「当前登录用户角色」校验该按钮的可用配置
// 数据源: role_button (app, buttonKey, role, enabled)
// 用法: router.post('/', requirePerm('admin', 'add'), handler)
// - 无/无效 token  -> 401 (未登录或登录过期)
// - 配置缺失或禁用 -> 403 (该角色未开放此操作)
const authService = require('../services/authService');
const pool = require('../config/db');
const { fail } = require('../utils/response');

function requirePerm(app, buttonKey) {
  return async (req, res, next) => {
    try {
      const header = req.headers.authorization || '';
      const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
      if (!token) return fail(res, '请先登录后再操作', 401);

      // 每次回查数据库角色: 用户被降级/删除后, 旧 token 立即失去写权限
      const user = await authService.currentUser(token);
      if (!user) return fail(res, '登录状态已失效, 请重新登录', 401);

      const [rows] = await pool.query(
        'SELECT enabled FROM role_button WHERE app = ? AND buttonKey = ? AND role = ? LIMIT 1',
        [app, buttonKey, user.role]
      );
      if (!rows.length || rows[0].enabled !== 1) {
        return fail(res, `「${buttonKey}」操作未对当前角色开放, 请在角色菜单申请开启`, 403);
      }

      req.authUser = user; // 透传给后续处理(如申请记录申请者)
      next();
    } catch (e) { next(e); }
  };
}

module.exports = requirePerm;
