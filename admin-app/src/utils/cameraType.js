// 摄像头类别定义与图标(与 cameras-app 保持一致)
// type: 1 普通摄像头 / 2 人工上传视频生成的摄像头 / 3 车辆摄像头
export const CAMERA_TYPES = [
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
export function cameraTypeOf(type) {
  const v = Number(type);
  return CAMERA_TYPES.find((t) => t.value === v) || DEFAULT_TYPE;
}
