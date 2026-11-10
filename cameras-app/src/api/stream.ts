// 视频流接口
// 流程: 网络测试(probe) -> 取流(play) -> 播放; 批量场景走 batch 一次拿回全部
import request from './request';
import { toAbsoluteUrl } from './camera';

/** 流类型: live 实时流 / vod 点播(人工上传的视频) */
export type StreamMode = 'live' | 'vod';

/** 网络测试结果 */
export interface StreamProbe {
  id: number;
  cameraName?: string;
  ok: boolean;
  mode: StreamMode;
  type?: number;
  /** 源编码: h264 / hevc(H265) / unknown */
  codec: string;
  source?: 'local' | 'remote' | 'none';
  /** 探测延迟(ms), 即"网络测试"耗时 */
  latencyMs: number;
  durationMs?: number;
  sizeBytes?: number;
  reason?: string;
}

/** 实时同步参数 */
export interface LiveSync {
  epochMs: number;
  /** 打开播放器那一刻应该定位到的位置 */
  positionMs: number;
  /** 循环周期(样本时长) */
  durationMs: number;
  /** 漂移校正间隔 */
  syncEveryMs: number;
  /** 允许的漂移上限, 超过才重新对齐 */
  toleranceMs: number;
}

/** 播放描述 */
export interface PlayInfo {
  id: number;
  cameraName?: string;
  mode: StreamMode;
  type?: number;
  status: 'ready' | 'preparing' | 'error';
  /** 源编码 */
  codec?: string;
  /** 实际下发编码(HEVC 不支持时服务端会转成 h264) */
  playCodec?: string;
  /** 是否经过服务端转码 */
  transcoded?: boolean;
  url?: string;
  durationMs?: number;
  label?: string;
  /** 服务端时间(与 positionMs 同一时刻, 用于推算本地时钟偏差) */
  serverTime?: number;
  live?: LiveSync;
  /** 点播参数: startMs 起播位置, loop 播完是否本地循环(不发请求) */
  vod?: { startMs: number; loop?: boolean };
  /** 网络测试耗时 */
  probeMs?: number;
  /** 客户端收到响应的时间(本地时钟), 用于补偿"排队/分波放行"造成的定位滞后 */
  receivedAt?: number;
  error?: string;
  message?: string;
  retryAfterMs?: number;
}

export interface BatchPayload {
  list: PlayInfo[];
  serverTime: number;
  /** 服务端当前播放方式('vod' 全部点播 / 'auto' 按类型), 用于占位文案 */
  playMode?: StreamMode;
}

// 播放方式缓存: 取流成功后记录下来, 供"排队中"等占位场景使用
// (真正的播放一律以每路返回的 mode 为准, 这里只影响还没拿到结果的临时标签)
let cachedMode: StreamMode = 'vod';
export function currentStreamMode(): StreamMode {
  return cachedMode;
}

/** 批量网络测试(≤64) */
export function probeStreams(ids: number[], signal?: AbortSignal) {
  return request.post<any, { list: StreamProbe[]; serverTime: number }>(
    '/stream/probe',
    { ids },
    { signal }
  );
}

/** 单路网络测试 */
export function probeStream(id: number, signal?: AbortSignal) {
  return request.get<any, StreamProbe>(`/stream/${id}/probe`, { signal });
}

/**
 * 单路取流
 * hevc=true 表示浏览器支持 HEVC, 可直连原始 H265(省掉服务端转码)
 */
export async function getPlayInfo(id: number, hevc = false, signal?: AbortSignal) {
  const info = await request.get<any, PlayInfo>(`/stream/${id}/play`, {
    params: { hevc: hevc ? 1 : 0 },
    signal,
  });
  // 子应用与接口不同源, 相对地址会被解析到主应用域名 -> 统一补成绝对地址
  if (info.url) info.url = toAbsoluteUrl(info.url);
  if (info.mode) cachedMode = info.mode;
  info.receivedAt = Date.now();
  return info;
}

/** 批量取流: 一次请求拿回 ≤64 路的播放描述 */
export async function getStreamBatch(ids: number[], hevc = false, signal?: AbortSignal) {
  const res = await request.post<any, BatchPayload>('/stream/batch', { ids, hevc }, { signal });
  const at = Date.now();
  if (res.playMode) cachedMode = res.playMode;
  // 打上本地接收时间: 批量播放分波拉流时, 靠它把定位推进到"当前应有的位置"
  res.list.forEach((i) => {
    if (i.url) i.url = toAbsoluteUrl(i.url);
    i.receivedAt = at;
  });
  return res;
}

/** 实时流当前位置(播放中校正漂移) */
export function getStreamPosition(id: number) {
  return request.get<any, { positionMs: number; serverTime: number; durationMs: number }>(
    `/stream/${id}/position`
  );
}

/** 服务端时钟 */
export function getStreamClock() {
  return request.get<any, { serverTime: number; epochMs: number }>('/stream/clock');
}
