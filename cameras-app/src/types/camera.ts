// 摄像头数据(Types)
// RawCamera: 接口原始数据(字段可能为字符串/脏值)
// CleanCamera: Worker 清洗后的标准数据
// CleanSite: Worker 按经纬度聚合后的点位(同一点位可能挂多台摄像头)

/** 接口原始数据(未清洗) */
export interface RawCamera {
  id: number | string;
  cameraName?: string | null;
  address?: string | null;
  longitude: number | string | null;
  latitude: number | string | null;
  state: number | string | null;
  type?: number | string | null;
}

/** 清洗后的摄像头(列表 / 地图共用, 只保留渲染必需字段) */
export interface CleanCamera {
  id: number;
  cameraName: string;
  address: string;
  longitude: number;
  latitude: number;
  /** 0 离线 / 1 在线 */
  state: 0 | 1;
  /** 1 普通 / 2 人工上传 / 3 车辆 */
  type: number;
  /** 同坐标聚合键(经纬度保留 5 位小数) */
  siteKey: string;
}

/** 聚合点位 */
export interface CleanSite {
  key: string;
  lng: number;
  lat: number;
  /** 该点位摄像头数量 */
  count: number;
  /** 该点位在线数量(>0 即视为在线点位) */
  online: number;
  /** 是否多点位(1 是 / 0 否), Worker 预计算避免每次渲染重复判断 */
  multi: number;
  /** 代表类别(取该点位第一台) */
  type: number;
  cameras: CleanCamera[];
}

/** 清洗统计 */
export interface CameraStats {
  /** 有效摄像头数 */
  total: number;
  online: number;
  offline: number;
  /** 被剔除的脏数据条数(坐标非法 / id 重复等) */
  dropped: number;
  /** 点位总数 */
  sites: number;
  /** 多点位数量 */
  multiSites: number;
}

/** 全量清洗结果 */
export interface CleanResult {
  list: CleanCamera[];
  sites: CleanSite[];
  stats: CameraStats;
}

/** 增量清洗结果(只含真正变化的摄像头与点位) */
export interface PatchResult {
  /** 出现未知 id(新增/删除了摄像头)时为 true, 调用方需全量重建 */
  needFull: boolean;
  cameras: CleanCamera[];
  sites: CleanSite[];
  /** 因摄像头迁走而被清空的点位 key */
  removedSites: string[];
  stats: CameraStats;
  changed: number;
  unknown: number;
}

/** 传给地图的站点数据包: list 为全量, changed 为本次增量变化的点位, removed 为被移除的点位 key */
export interface SiteFeed {
  list: CleanSite[];
  changed: CleanSite[];
  removed: string[];
}
