import workerSource from '../workers/cameraData.worker.js?raw';
import type { RawCamera, CleanResult, PatchResult } from '../types/camera';

// 清洗 Worker 的生命周期管理
// ---------------------------------------------------------------------------
// 1. 懒创建: 第一次清洗任务才创建, 不做常驻
// 2. 同源加载: 子应用与主应用不同源, 直接用远程 URL new Worker 会被同源策略拦截,
//    因此把 Worker 源码以字符串(?raw)打进包, 用 Blob URL 创建 —— 天然同源
// 3. 空闲自动回收: 任务结束后空闲 30s 自动 terminate, 释放栈内存与模块内存;
//    下次任务到来时重新初始化(重新播种全量数据), 避免后台常驻占资源
// 4. 泄漏防控: dispose() 会终止 Worker、撤销 Blob URL、清掉空闲定时器、拒绝所有在途请求

/** 空闲多久自动销毁 Worker(ms) */
export const WORKER_IDLE_MS = 30_000;
/** 单次清洗请求超时(ms) */
const REQUEST_TIMEOUT_MS = 20_000;

/** Worker 已休眠/未初始化: 增量任务无法执行, 调用方需要重新全量播种 */
export class WorkerColdError extends Error {
  readonly code = 'WORKER_COLD';
  constructor(message = '清洗 Worker 已休眠, 需要重新初始化') {
    super(message);
    this.name = 'WorkerColdError';
  }
}

/** Worker 已被销毁: 在途请求被中止 */
export class WorkerGoneError extends Error {
  readonly code = 'WORKER_GONE';
  constructor(message = '清洗 Worker 已销毁') {
    super(message);
    this.name = 'WorkerGoneError';
  }
}

interface Pending {
  resolve: (value: any) => void;
  reject: (err: any) => void;
  timer: any;
}

let worker: Worker | null = null;
let blobUrl: string | null = null;
let idleTimer: any = null;
let seq = 0;
let seeded = false;      // Worker 内存里是否已有全量数据(决定能否做增量)
let disabled = false;    // Worker 不可用(构造失败等) -> 永久走主线程兜底
let failures = 0;        // 连续运行异常次数
let idleHold = false;    // 是否暂缓空闲回收(轮询进行中 = 随时有下一个任务, 不算空闲)
let fallbackCore: any = null;
const pending = new Map<number, Pending>();

/** 创建 Worker(失败时标记 disabled, 由调用方走主线程兜底) */
function createWorker(): Worker | null {
  if (worker) return worker;
  if (disabled) return null;
  try {
    blobUrl = URL.createObjectURL(new Blob([workerSource], { type: 'application/javascript' }));
    const w = new Worker(blobUrl);
    w.onmessage = (e: MessageEvent) => settle(e.data);
    w.onerror = (e: any) => {
      failures += 1;
      console.error('[cameraWorker] 运行异常, 回收 Worker:', e?.message || e);
      rejectAll(new WorkerGoneError('清洗 Worker 运行异常'));
      destroy();
      // 连续两次异常视为环境不支持, 永久切到主线程清洗
      if (failures >= 2) disabled = true;
    };
    worker = w;
    seeded = false;
    return w;
  } catch (e) {
    disabled = true;
    console.warn('[cameraWorker] Worker 创建失败, 改用主线程清洗:', e);
    return null;
  }
}

function settle(msg: any) {
  if (!msg) return;
  const p = pending.get(msg.reqId);
  if (!p) return;
  pending.delete(msg.reqId);
  clearTimeout(p.timer);
  if (msg.type === 'error') p.reject(new Error(msg.message || 'Worker 处理失败'));
  else p.resolve(msg);
  failures = 0;
  scheduleIdle();
}

function request(msg: Record<string, any>): Promise<any> {
  const w = createWorker();
  if (!w) return Promise.reject(new WorkerColdError());

  const reqId = ++seq;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(reqId);
      reject(new Error('清洗 Worker 响应超时'));
      scheduleIdle();
    }, REQUEST_TIMEOUT_MS);
    pending.set(reqId, { resolve, reject, timer });
    cancelIdle(); // 有任务在执行, 不允许空闲回收
    try {
      w.postMessage({ ...msg, reqId });
    } catch (e) {
      pending.delete(reqId);
      clearTimeout(timer);
      reject(new WorkerGoneError());
      destroy();
    }
  });
}

function cancelIdle() {
  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }
}

/** 任务结束后开始计时, 空闲 30s 自动销毁 */
function scheduleIdle() {
  cancelIdle();
  if (pending.size) return;
  if (idleHold) return; // 轮询进行中: 30s 后必定还有任务, 此时销毁只会白白重建
  idleTimer = setTimeout(() => {
    idleTimer = null;
    destroy();
  }, WORKER_IDLE_MS);
}

/**
 * 暂缓/恢复空闲回收
 * - 开启轮询时 hold=true: 轮询期间 Worker 一直有任务排队, 不触发回收
 * - 停止轮询/切换菜单时 hold=false: 空闲 30s 后自动销毁, 释放内存
 * (轮询间隔与空闲时长同为 30s, 不区分的话会周期性把 Worker 销毁又重建)
 */
export function holdIdle(hold: boolean) {
  idleHold = hold;
  if (hold) cancelIdle();
  else scheduleIdle();
}

function rejectAll(err: Error) {
  pending.forEach((p) => {
    clearTimeout(p.timer);
    p.reject(err);
  });
  pending.clear();
}

/** 立即销毁 Worker(释放内存), 保留 disabled 标记 */
function destroy() {
  cancelIdle();
  if (worker) {
    worker.onmessage = null;
    worker.onerror = null;
    worker.terminate();
    worker = null;
  }
  if (blobUrl) {
    URL.revokeObjectURL(blobUrl);
    blobUrl = null;
  }
  seeded = false;
}

/** 主线程兜底: 执行同一份 Worker 源码, 保证清洗规则只有一处实现 */
function getFallback(): any {
  if (fallbackCore) return fallbackCore;
  try {
    // eslint-disable-next-line no-new-func
    const factory = new Function(`${workerSource}\nreturn self.__CAMERA_CORE__;`);
    fallbackCore = factory.call(globalThis);
  } catch (e) {
    console.error('[cameraWorker] 主线程兜底初始化失败:', e);
  }
  if (!fallbackCore) throw new WorkerColdError('清洗能力不可用');
  return fallbackCore;
}

/**
 * 全量清洗(首次加载 / 版本失效 / 结构变化时调用)
 * 会把全量数据播种进 Worker, 后续才能做增量
 */
export async function clean(raw: RawCamera[]): Promise<CleanResult> {
  if (!disabled) {
    try {
      const res = await request({ type: 'clean', raw });
      seeded = true;
      return { list: res.list, sites: res.sites, stats: res.stats };
    } catch (e) {
      if (!disabled) throw e; // Worker 本身可用但清洗报错 -> 交给调用方处理
    }
  }
  return getFallback().clean(raw);
}

/**
 * 增量清洗(定时轮询 / 跨应用变更通知)
 * 变更项可只带发生变化的字段(状态/名称/地址/类别/经纬度)
 * Worker 已休眠时抛 WorkerColdError, 调用方应改为全量重建(顺便重新播种)
 */
export interface CameraPatch {
  id: number;
  cameraName?: string;
  address?: string;
  longitude?: number;
  latitude?: number;
  state?: number;
  type?: number;
}

export async function patch(changes: CameraPatch[]): Promise<PatchResult> {
  if (disabled) return getFallback().patch(changes);
  if (!worker || !seeded) throw new WorkerColdError();
  const res = await request({ type: 'patch', changes });
  return res as PatchResult;
}

/** 组件销毁 / 应用卸载时调用: 终止 Worker + 清定时器 + 中止在途请求 */
export function dispose() {
  rejectAll(new WorkerGoneError());
  destroy();
  fallbackCore = null;
  idleHold = false;
}

/** 运行状态(排查用) */
export function getStatus() {
  return { alive: !!worker, seeded, pending: pending.size, disabled, idle: !!idleTimer, idleHold };
}

export const cameraWorker = { clean, patch, dispose, holdIdle, getStatus };
