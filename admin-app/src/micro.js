// 微应用通信模块: 保存主应用传入的 actions, 并封装按钮/激活标签监听
let actions = null;
// 缓存主应用广播的按钮状态(供同步读取; qiankun 的 actions 无 getGlobalState 方法)
let cachedButtons = {};
// 最近一次全局状态(供后注册的订阅者立即拿到当前值)
let lastState = null;

// qiankun 的 onGlobalStateChange 在同一 actions 上重复调用会"覆盖"前一个监听,
// 因此这里只注册一次全局监听, 再分发给所有订阅者, 避免 onButtonsChange 被 onActiveTabChange 覆盖。
const stateSubscribers = new Set();
// 已绑定监听的 actions 实例(避免同一实例重复注册导致覆盖告警)
let boundActions = null;

export function setMicroActions(a) {
  actions = a || null;
  if (!actions || actions === boundActions) return;
  boundActions = actions;
  actions.onGlobalStateChange((state) => {
    const s = state || {};
    lastState = s;
    if (s.buttons) cachedButtons = s.buttons;
    stateSubscribers.forEach((fn) => fn(s));
  }, true);
}

// 统一订阅全局状态变化, 返回取消订阅函数。
// fireImmediately=true 时若已有当前状态会立即回调一次(用于按钮权限这类"要当前值"的订阅);
// 切换标签这类"只关心变化"的订阅传 false, 避免子应用挂载时重复拉取数据。
export function onGlobalChange(cb, fireImmediately = true) {
  stateSubscribers.add(cb);
  if (fireImmediately && lastState) cb(lastState);
  return () => stateSubscribers.delete(cb);
}

export function onButtonsChange(cb) {
  onGlobalChange((state) => {
    if (state && state.buttons) cb(state.buttons);
  }, true);
}

export function onActiveTabChange(cb) {
  // qiankun 每次 setGlobalState 都会推送合并后的完整状态(按钮权限/摄像头变更信号都算),
  // 必须按值去重, 否则每次广播都会被误判成"切了一次标签"而重复拉列表
  let last = '';
  onGlobalChange((state) => {
    if (!state || typeof state.activeTab !== 'string') return;
    if (state.activeTab === last) return;
    last = state.activeTab;
    cb(state.activeTab);
  }, false);
  // 已收到过全局状态时, 用当前标签作为基线, 避免"第一次无关广播"被当成切换
  if (lastState && typeof lastState.activeTab === 'string') last = lastState.activeTab;
}

export function getGlobalButtons() {
  return cachedButtons;
}

/**
 * 摄像头被增删改后广播一次
 * 摄像头监控是另一个常驻挂载的子应用, 它监听到 cameraMutatedAt 变化会立即增量同步,
 * 不必等自己的 30s 轮询 —— 否则「后台改完切过去看还是旧数据」。
 */
export function broadcastCameraMutated(payload) {
  if (!actions || typeof actions.setGlobalState !== 'function') return;
  actions.setGlobalState({
    cameraMutatedAt: Date.now(),
    cameraMutation: payload || {},
  });
}
