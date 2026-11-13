// 认证接口: 公钥下发 / 登录 / 当前登录态 / 退出
// 前端提交的 username 与 password 必须整体经 RSA-OAEP(SHA-256) 加密后放在 cipher 字段
const router = require('express').Router();
const { success, fail } = require('../utils/response');
const { getPublicKey } = require('../utils/rsaKeys');
const auth = require('../services/authService');

/** 取公钥(PEM, SPKI 格式) */
router.get('/public-key', (req, res) => {
  success(res, {
    publicKey: getPublicKey(),
    algorithm: 'RSA-OAEP',
    hash: 'SHA-256',
  });
});

/** 登录 */
router.post('/login', async (req, res, next) => {
  try {
    const data = await auth.login(req.body && req.body.cipher, req.ip);
    success(res, data, '登录成功');
  } catch (e) {
    if (e instanceof auth.AuthError) return fail(res, e.message, e.status);
    next(e);
  }
});

/** 校验当前登录态 */
router.get('/me', async (req, res, next) => {
  try {
    const header = req.get('Authorization') || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    const user = await auth.currentUser(token);
    if (!user) return fail(res, '未登录或登录已过期', 401);
    success(res, user);
  } catch (e) { next(e); }
});

/** 退出: token 无状态, 前端清除本地存储即可 */
router.post('/logout', (req, res) => success(res, null, '已退出'));

module.exports = router;
