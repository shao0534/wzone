// 摄像头类别定义与图标
// type: 1 普通摄像头 / 2 人工上传视频生成的摄像头 / 3 车辆摄像头
// 说明: 列表里的图标按「类别色 + 类别形状」展示; 地图点位用「类别形状 + 状态色」,
//       这样在地图上既能看出是哪一类, 又能看出在线(绿)/离线(灰)/选中(蓝)。
export interface CameraTypeDef {
  value: number;
  label: string; // 完整类别名
  short: string; // 简称(列表 tag / 提示文案)
  color: string; // 类别标识色
  path: string;  // SVG path, viewBox 0 0 24 24
}

export const CAMERA_TYPES: CameraTypeDef[] = [
  {
    value: 1,
    label: '普通摄像头',
    short: '普通',
    color: '#409eff',
    // videocam: 摄像机机身 + 镜头
    path:
      'M17 10.5V7a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-3.5l4 4v-11l-4 4z',
  },
  {
    value: 2,
    label: '人工上传视频',
    short: '上传',
    color: '#e6a23c',
    // file_upload: 上传箭头 + 底座
    path: 'M9 16h6v-6h4l-7-7-7 7h4v6zm-4 2h14v2H5v-2z',
  },
  {
    value: 3,
    label: '车辆摄像头',
    short: '车辆',
    color: '#1fb6a6',
    // directions_car: 汽车
    path:
      'M18.92 6.01C18.72 5.42 18.16 5 17.5 5h-11c-.66 0-1.21.42-1.42 1.01L3 12v8c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-1h12v1c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-8l-2.08-5.99zM6.5 16c-.83 0-1.5-.67-1.5-1.5S5.67 13 6.5 13s1.5.67 1.5 1.5S7.33 16 6.5 16zm11 0c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zM5 11l1.5-4.5h11L19 11H5z',
  },
];

const DEFAULT_TYPE = CAMERA_TYPES[0];

// 取类别定义(未知/空值兜底为普通摄像头)
export function cameraTypeOf(type?: number | string | null): CameraTypeDef {
  const v = Number(type);
  return CAMERA_TYPES.find((t) => t.value === v) || DEFAULT_TYPE;
}

// 生成带颜色的单色图标 SVG 字符串(可指定尺寸, 便于内联到地图标记或 data URI)
export function typeIconSvg(path: string, color: string, size = 14): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="${color}">` +
    `<path d="${path}"/></svg>`
  );
}

// SVG 字符串 -> data URI(MassMarks 等 Canvas 图层需要图片地址)
export function svgToDataUri(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

// 生成「圆形底 + 类别图标」的地图点位图标(data URI)
// opts: bg 底色 / ring 圆环色 / size 整体尺寸 / iconSize 图标尺寸 / doubleRing 是否加外圈(用于"同点位多台")
export function typeMarkerDataUri(
  path: string,
  color: string,
  opts: { size?: number; iconSize?: number; bg?: string; ring?: string; doubleRing?: boolean } = {}
): string {
  const size = opts.size ?? 24;
  const iconSize = opts.iconSize ?? Math.round(size * 0.6);
  const bg = opts.bg ?? '#ffffff';
  const ring = opts.ring ?? color;
  const r = size / 2;
  const offset = (size - iconSize) / 2;
  const scale = iconSize / 24; // path 使用 24x24 坐标系, 需缩放到目标尺寸
  const outer = opts.doubleRing
    ? `<circle cx="${r}" cy="${r}" r="${r - 0.6}" fill="none" stroke="${color}" stroke-width="1.4" opacity="0.45"/>`
    : '';
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">` +
    `<circle cx="${r}" cy="${r}" r="${r - 1.8}" fill="${bg}" stroke="${ring}" stroke-width="2.2"/>` +
    outer +
    `<g transform="translate(${offset},${offset}) scale(${scale})" fill="${color}"><path d="${path}"/></g>` +
    `</svg>`;
  return svgToDataUri(svg);
}
