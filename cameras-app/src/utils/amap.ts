// 高德地图 JS API 加载器(按需加载, 复用同一实例)
const AMAP_KEY = import.meta.env.VITE_AMAP_KEY || '你的高德地图key';
let promise: Promise<any> | null = null;

export function loadAMap(): Promise<any> {
  const w = window as any;
  if (w.AMap) return Promise.resolve(w.AMap);
  if (promise) return promise;

  promise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    // 预加载插件: 聚合(MarkerClusterer) / 框选(MouseTool) / 万级点位彩点渲染(MassMarks)
    script.src = `https://webapi.amap.com/maps?v=2.0&key=${AMAP_KEY}&plugin=AMap.MarkerClusterer,AMap.MouseTool,AMap.MassMarks`;
    script.onload = () => {
      // 即使脚本加载完成, key 无效时 window.AMap 仍为 undefined, 需明确判空
      if (w.AMap) resolve(w.AMap);
      else { promise = null; reject(new Error('高德地图加载失败, 请检查 VITE_AMAP_KEY 是否有效')); }
    };
    script.onerror = () => { promise = null; reject(new Error('高德地图加载失败')); };
    document.head.appendChild(script);
  });
  return promise;
}
