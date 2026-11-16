// SSE 实时通知服务: 维护在线客户端连接池, 向前端推送业务事件(申请/审核/权限变更)。
// - 连接按用户名索引: 同一用户多标签页/多端各自持有连接
// - 心跳: 每 25s 写一次注释行, 防中间代理空闲断连
// - 推送失败(客户端已断开)时静默清理连接, 由前端 EventSource 自动重连
class Notifier {
  constructor() {
    /** @type {Map<string, Set<import('express').Response>>} */
    this.clients = new Map();
    // 全局心跳定时器
    this.heartbeat = setInterval(() => this.ping(), 25_000);
    // 定时器不阻塞进程退出
    if (this.heartbeat.unref) this.heartbeat.unref();
  }

  /** 建立连接: 客户端接入连接池并立即发送一次握手消息 */
  addClient(userName, res) {
    let set = this.clients.get(userName);
    if (!set) {
      set = new Set();
      this.clients.set(userName, set);
    }
    set.add(res);
    // 握手: 告知前端连接已就绪
    this.write(res, { type: 'connected' });
    console.log(`[notifier] ${userName} 已连接, 当前在线连接: ${this.count()}`);
  }

  /** 断开连接: 仅从该用户的连接集合中移除, 其余连接不受影响 */
  removeClient(userName, res) {
    const set = this.clients.get(userName);
    if (!set) return;
    set.delete(res);
    if (set.size === 0) this.clients.delete(userName);
    console.log(`[notifier] ${userName} 已断开, 当前在线连接: ${this.count()}`);
  }

  /** 推送给指定用户的全部连接 */
  pushTo(userName, event) {
    const set = this.clients.get(userName);
    if (!set) return 0;
    for (const res of set) {
      if (!this.write(res, event)) {
        set.delete(res); // 写失败说明连接已断, 就地清理
      }
    }
    if (set.size === 0) this.clients.delete(userName);
    return set.size;
  }

  /** 推送给所有在线用户 */
  pushAll(event) {
    let n = 0;
    for (const [userName, set] of this.clients) {
      for (const res of set) {
        if (this.write(res, event)) n += 1;
        else set.delete(res);
      }
      if (set.size === 0) this.clients.delete(userName);
    }
    return n;
  }

  /** 当前在线连接总数 */
  count() {
    let n = 0;
    for (const set of this.clients.values()) n += set.size;
    return n;
  }

  /** 心跳: 注释行不触发前端 message 事件 */
  ping() {
    for (const set of this.clients.values()) {
      for (const res of set) {
        try { res.write(': ping\n\n'); } catch { /* 断开的连接由下次推送清理 */ }
      }
    }
  }

  /** 写入一条事件; 返回是否写入成功 */
  write(res, event) {
    try {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
      return true;
    } catch {
      return false;
    }
  }
}

// 单例: 全局共享一个连接池
module.exports = new Notifier();
