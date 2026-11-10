// 统一响应格式工具
// 约定: code === 0 表示成功, 其余表示失败; data 为业务数据

/** 成功响应 */
function success(res, data = null, message = 'success') {
  // 禁止缓存: 确保接口每次返回最新数据, 避免浏览器缓存导致数据不刷新
  res.set('Cache-Control', 'no-store');
  res.json({ code: 0, message, data });
}

/** 失败响应 */
function fail(res, message = '操作失败', code = 1) {
  res.set('Cache-Control', 'no-store');
  res.json({ code, message, data: null });
}

module.exports = { success, fail };
