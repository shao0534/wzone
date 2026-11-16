// 实时通知接口: 基于 SSE(Server-Sent Events) 的服务端单向推送。
// EventSource 无法自定义请求头, token 从 query 参数传入(与 header 鉴权同一套校验)。
const router = require('express').Router();
const authService = require('../services/authService');
const notifier = require('../services/notifier');
const { fail } = require('../utils/response');

router.get('/stream', async (req, res, next) => {
  try {
    const user = await authService.currentUser(String(req.query.token || '')).catch(() => null);
    if (!user) return fail(res, '登录状态已失效, 无法建立通知连接', 401);

    // SSE 响应头; X-Accel-Buffering 防止 nginx 等反向代理缓冲事件流
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    // 告知前端断线后 5s 自动重连
    res.write('retry: 5000\n\n');

    notifier.addClient(user.name, res);
    // 客户端断开(关标签页/登出)时清理连接, 防止连接池泄漏
    req.on('close', () => notifier.removeClient(user.name, res));
  } catch (e) { next(e); }
});

module.exports = router;
