// 微应用通信模块: 保存主应用传入的 actions, 并封装按钮/激活标签监听
import type { MicroAppStateActions } from 'qiankun';

let actions: MicroAppStateActions | null = null;
// 缓存主应用广播的按钮状态(供同步读取; qiankun 的 actions 只有 onGlobalStateChange/setGlobalState, 无 getGlobalState)
let cachedButtons: Record<string, boolean> = {};
// 最近一次全局状态(供后注册的订阅者立即拿到当前值)
let lastState: any = null;

// qiankun 的 onGlobalStateChange 在同一 actions 上重复调用会"覆盖"前一个监听,
// 因此只注册一次全局监听, 再分发给所有订阅者, 避免 onButtonsChange 被 onActiveTabChange 覆盖。
const stateSubscribers = new Set<(state: any) => void>();
// 已绑定监听的 actions 实例(避免同一实例重复注册导致覆盖告警)
let boundActions: MicroAppStateActions | null = null;

/** 保存主应用传入的通信 actions */
export function setMicroActions(a?: MicroAppStateActions) {
  actions = a || null;
  if (!actions || actions === boundActions) return;
  boundActions = actions;
  actions.onGlobalStateChange((state: any) => {
    const s = state || {};
    lastState = s;
    if (s.buttons) cachedButtons = s.buttons;
    stateSubscribers.forEach((fn) => fn(s));
  }, true);
}

// 统一订阅全局状态变化, 返回取消订阅函数。
// fireImmediately=true 时若已有当前状态会立即回调一次(按钮权限要"当前值");
// 切换标签只关心"变化", 传 false, 避免子应用挂载时重复拉取数据。
export function onGlobalChange(cb: (state: any) => void, fireImmediately = true) {
  stateSubscribers.add(cb);
  if (fireImmediately && lastState) cb(lastState);
  return () => { stateSubscribers.delete(cb); };
}

/** 监听主应用广播的按钮状态 */
export function onButtonsChange(cb: (buttons: Record<string, boolean>) => void) {
  onGlobalChange((state) => {
    if (state && state.buttons) cb(state.buttons);
  }, true);
}

/** 获取当前全局按钮状态(返回缓存副本) */
export function getGlobalButtons(): Record<string, boolean> {
  return cachedButtons;
}

/** 监听主应用广播的当前激活标签(cameras / admin) */
export function onActiveTabChange(cb: (tab: string) => void) {
  // qiankun 的 setGlobalState 每次都会把合并后的完整全局状态推一遍,
  // 无论是按钮权限还是"摄像头已改"信号; 这里必须按值去重, 否则每次广播都会被当成切了一次标签
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

/**
 * 监听「管理后台增删改了摄像头」
 * 管理后台操作成功后会在全局状态里写 cameraMutatedAt 时间戳, 这里只认时间戳变化,
 * 避免其它全局状态(按钮权限/标签切换)把它误触发一遍。
 */
export function onCameraMutated(cb: (payload: any) => void) {
  let lastAt = 0;
  onGlobalChange((state) => {
    const at = state ? Number(state.cameraMutatedAt) : 0;
    if (!at || at === lastAt) return;
    lastAt = at;
    cb(state.cameraMutation || {});
  }, false);
}
