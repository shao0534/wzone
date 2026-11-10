// Qiankun 微前端配置: 微应用入口 + 跨应用全局通信
import { initGlobalState } from 'qiankun';
import type { MicroAppStateActions } from 'qiankun';

// 微应用配置(名称 / 入口)
export const MICRO_APPS = {
  cameras: {
    appName: 'cameras',
    entry: import.meta.env.VITE_CAMERAS_ENTRY || '//localhost:8001',
  },
  admin: {
    appName: 'admin',
    entry: import.meta.env.VITE_ADMIN_ENTRY || '//localhost:8002',
  },
} as const;

export interface GlobalState {
  /** 按钮权限: `${app}.${buttonKey}` -> 是否可用 */
  buttons: Record<string, boolean>;
  /** 当前激活的子应用标签(cameras / admin / role) */
  activeTab: string;
  /** 摄像头被增删改的时间戳(监控子应用据此立即增量同步) */
  cameraMutatedAt: number;
  /** 变更描述(动作 + 摄像头 id), 仅用于调试/统计 */
  cameraMutation: Record<string, any> | null;
}

// 全局状态初始值
const initialState: GlobalState = {
  buttons: {},
  activeTab: 'cameras',
  cameraMutatedAt: 0,
  cameraMutation: null,
};

// 主应用侧的 actions(创建它会让 qiankun 初始化 globalState)
export const actions: MicroAppStateActions = initGlobalState(initialState);

// 主应用维护一份当前状态镜像:
// 后面给子应用单独创建 actions 通道时要传当前值, 否则会把已广播的状态覆盖回初始值
let current: GlobalState = { ...initialState };

// 广播按钮状态(主应用角色菜单更新后调用)
export function broadcastButtons(buttons: Record<string, boolean>) {
  current = { ...current, buttons };
  actions.setGlobalState({ buttons });
}

// 广播当前激活的子应用标签(cameras / admin), 子应用监听到自己变为激活时重新拉取数据
export function broadcastActiveTab(activeTab: string) {
  current = { ...current, activeTab };
  actions.setGlobalState({ activeTab });
}

/**
 * 为单个子应用创建独立的 actions 通道
 * ------------------------------------------------------------------
 * 为什么不能两个子应用共用一个 actions:
 * qiankun 2.10 的全局状态监听是 `deps[actionsId] = callback` —— 以 actions 实例 id 为键,
 * 同一个实例上重复注册会「后者覆盖前者」(控制台只会看到一句 warning)。
 * 之前两个子应用都拿主应用的 actions, admin 后挂载就把 cameras 的监听顶掉了,
 * 导致切标签、按钮权限、摄像头变更广播, cameras 一条都收不到。
 * 这里改成每个子应用各拿一个实例: 它们共享同一份 globalState 与同一张 deps 表,
 * 任何一端 setGlobalState 仍然会广播给所有监听者, 但监听互不覆盖。
 */
export function createChannel(): MicroAppStateActions {
  return initGlobalState({ ...current });
}
