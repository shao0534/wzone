// 写操作鉴权中间件: 只有管理员(role = 1)可以新增/修改/删除博客
// 说明: 前端隐藏按钮只是体验层, 真正的权限边界必须在这里, 且角色每次都回查数据库
//      (用户被降级/删除后, 旧 token 立即失效, 不依赖 token 里缓存的 role)。
const auth = require('../services/authService');

function deny(res, status, message) {
  // 权限错误必须用真实 HTTP 状态码, 便于 axios 走 error 分支并展示 message
  res.set('Cache-Control', 'no-store');
  return res.status(status).json({ code: status, message, data: null });
}

module.exports = async function requireAdmin(req, res, next) {
  try {
    const header = req.get('Authorization') || '';
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    if (!token) return deny(res, 401, '请先登录');

    const user = await auth.currentUser(token);
    if (!user) return deny(res, 401, '登录已过期，请重新登录');
    if (Number(user.role) !== 1) return deny(res, 403, '权限不足，仅管理员可操作');

    req.authUser = user;
    next();
  } catch (e) {
    next(e);
  }
};
