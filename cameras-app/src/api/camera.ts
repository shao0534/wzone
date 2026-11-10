import request, { API_BASE } from './request';
import type { RawCamera } from '../types/camera';

// 摄像头数据模型
export interface Camera {
  id: number;
  cameraName: string;
  videoUrl: string;
  imgUrl: string;
  address: string;
  addressNum: string;
  longitude: number;
  latitude: number;
  state: number;
  /** 摄像头类别: 1 普通摄像头 / 2 人工上传视频生成 / 3 车辆摄像头 */
  type: number;
  startTime: string;
  endTime: string;
}

/** 全量坐标接口返回(带数据版本号, 供后续增量同步定位起点) */
export interface PositionsPayload {
  list: RawCamera[];
  /** 数据版本号 */
  version: number;
  /** 结构版本号: 增删摄像头时变化 */
  structure: number;
  serverTime: number;
}

/**
 * 单条变更快照
 * 后端下发的是"变化后"的完整点位字段(不只是状态), 因为管理后台还会改
 * 名称/地址/类别/经纬度, 这些同样要同步到监控端
 */
export interface CameraChange {
  id: number;
  cameraName?: string;
  address?: string;
  longitude?: number;
  latitude?: number;
  state?: number;
  type?: number;
}

/** 增量变更接口返回 */
export interface ChangesPayload {
  version: number;
  structure: number;
  /** true 表示版本不连续(服务重启/日志被裁剪), 前端需全量重建 */
  full: boolean;
  list: CameraChange[];
  serverTime: number;
}

// 获取全部坐标(左侧虚拟滚动列表 + 地图打点共用)
// signal 用于组件销毁/重复请求时中止在途请求, 避免旧响应回写造成脏数据与内存残留
export function getPositions(signal?: AbortSignal) {
  return request.get<any, PositionsPayload>('/camera/all/positions', { signal });
}

// 增量拉取 since 之后的状态变更(定时轮询用, 只传几十~上百条)
export function getCameraChanges(since: number, signal?: AbortSignal) {
  return request.get<any, ChangesPayload>('/camera/changes', { params: { since }, signal });
}

// 手动触发一次「随机切换 N 台摄像头状态」(后端每 30s 也会自动执行一次)
export function flipRandomCameraStates(count = 100) {
  return request.post<any, { count: number; version: number; at: number }>('/camera/state/flip', { count });
}

// 获取摄像头详情
export function getCameraDetail(id: number) {
  return request.get<any, Camera>(`/camera/${id}`);
}

// 修改摄像头在线状态(0 离线 / 1 在线)
export function updateCameraState(id: number, state: number) {
  return request.patch<any, { id: number; state: number }>(`/camera/${id}/state`, { state });
}

// 上传视频替换指定摄像头的视频源(服务端会同时置为在线)
export function uploadCameraVideo(
  id: number,
  file: File,
  onProgress?: (percent: number) => void
) {
  const fd = new FormData();
  fd.append('video', file);
  return request.post<any, { id: number; videoUrl: string; state: number }>(
    `/camera/${id}/video`,
    fd,
    {
      onUploadProgress: (e: any) => {
        if (onProgress && e.total) onProgress(Math.round((e.loaded / e.total) * 100));
      },
    }
  );
}

// 把服务端返回的相对路径(/uploads/...)补全为绝对地址
export function toAbsoluteUrl(url: string) {
  if (!url) return '';
  if (/^https?:\/\//i.test(url)) return url;
  const origin = new URL(API_BASE).origin;
  return `${origin}${url.startsWith('/') ? '' : '/'}${url}`;
}
