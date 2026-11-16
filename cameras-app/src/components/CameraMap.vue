<template>
  <div class="camera-map-wrap" @contextmenu.prevent>
    <div ref="mapRef" class="camera-map"></div>

    <!-- 地图工具栏: 框选摄像头 -->
    <div class="map-toolbar">
      <button class="map-tool" :class="{ active: boxSelectActive }" @click="toggleBoxSelect">
        <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
          <path d="M20 4v16H4V4h16m0-2H4a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2z" fill="currentColor"/>
          <path d="M8 8h8v8H8z" fill="currentColor"/>
        </svg>
        <span>框选</span>
      </button>
      <button class="map-tool" @click="clearBoxSelect">
        <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
          <path d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" fill="currentColor"/>
        </svg>
        <span>清除框选</span>
      </button>
      <div v-if="selectedCount" class="map-chip">已选中 {{ selectedCount }} 个</div>
    </div>

    <!-- 悬停提示: 单摄像头显示信息, 同点位多摄像头显示名称列表 -->
    <div
      v-if="tip.visible && tip.site"
      class="map-tip"
      :style="{ left: tip.x + 'px', top: tip.y + 'px' }"
      @mouseenter="cancelHideTip"
      @mouseleave="scheduleHideTip"
    >
      <!-- 一个点只有一台摄像头 -->
      <template v-if="tip.site.cameras.length === 1">
        <div class="tip-name">
          <svg class="type-ico" viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
            <path :d="typeDef(tip.site.cameras[0]).path" :fill="typeDef(tip.site.cameras[0]).color" />
          </svg>
          <span class="name-text" :title="tip.site.cameras[0].cameraName">
            {{ tip.site.cameras[0].cameraName }}
          </span>
          <span class="row-state" :style="{ color: stateColor(tip.site.cameras[0]) }">
            {{ stateText(tip.site.cameras[0]) }}
          </span>
        </div>
        <div class="tip-sub">
          {{ typeDef(tip.site.cameras[0]).label }} · {{ tip.site.cameras[0].address || '未知地址' }}
        </div>
        <div class="tip-hint">单击选中 / 双击播放 / 右键更多</div>
      </template>

      <!-- 一个点多台摄像头: 名称列表, 每行执行单摄像头逻辑 -->
      <template v-else>
        <div class="tip-head">该点位 {{ tip.site.cameras.length }} 台摄像头 · 可多选</div>
        <div
          v-for="cam in tip.site.cameras"
          :key="cam.id"
          class="tip-row"
          :class="{ on: selectedSet.has(cam.id) }"
          @click="onTipRowClick(cam)"
          @dblclick="onTipRowDblClick(cam)"
          @contextmenu.prevent.stop="openMenuAt(cam, localPoint($event))"
        >
          <svg class="type-ico" viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
            <path :d="typeDef(cam).path" :fill="typeDef(cam).color" />
          </svg>
          <span class="row-name" :title="cam.cameraName">{{ cam.cameraName }}</span>
          <span class="row-state" :style="{ color: stateColor(cam) }">{{ stateText(cam) }}</span>
        </div>
      </template>
    </div>

    <!-- 右键操作菜单 -->
    <div
      v-if="menu.visible && menu.camera"
      class="map-menu"
      :style="{ left: menu.x + 'px', top: menu.y + 'px' }"
      @contextmenu.prevent
    >
      <div class="menu-title" :title="menu.camera.cameraName">{{ menu.camera.cameraName }}</div>
      <button class="menu-item" @click="fireAction('test')">连接测试</button>
      <button v-if="buttonStore.can('uploadVideo')" class="menu-item" @click="fireAction('upload')">上传视频</button>
      <button
        v-if="buttonStore.can('changeState')"
        class="menu-item"
        @click="fireAction('state')"
      >
        修改状态为{{ Number(menu.camera.state) === 1 ? '离线' : '在线' }}
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { loadAMap } from '../utils/amap';
import { useButtonStore } from '../store/button';
import { CAMERA_TYPES, cameraTypeOf, typeIconSvg, typeMarkerDataUri } from '../utils/cameraType';
import type { CleanCamera, CleanSite, SiteFeed } from '../types/camera';

type Site = CleanSite;

const props = defineProps<{
  positions: CleanCamera[];
  /** Worker 清洗聚合后的点位: list 全量, changed 为本次增量变化的点位 */
  siteFeed: SiteFeed;
  plotted: any[];
  selected?: number[]; // 选中的摄像头 id(单选 / 描点 / 框选)
}>();
const emit = defineEmits<{
  (e: 'select', id: number): void;
  (e: 'openVideo', id: number): void;
  (e: 'menuAction', payload: { action: string; camera: any }): void;
  (e: 'boxSelect', ids: number[]): void;
}>();

const mapRef = ref<HTMLDivElement | null>(null);
const boxSelectActive = ref(false);

// 点位数据由 Worker 聚合后传入, 组件只负责渲染, 不再自己遍历 1 万条原始数据
let siteList: Site[] = [];
const siteMap = new Map<string, Site>();        // key -> 点位(海量点点击 / 浮层刷新用)
const siteMarkersByKey = new Map<string, any>(); // key -> DOM 标记(增量刷新用)

const selectedSet = computed(() => new Set<number>(props.selected || []));

// 右键菜单的「上传视频 / 修改状态」按当前登录角色权限显隐(fail closed)
const buttonStore = useButtonStore();
const selectedCount = computed(() => selectedSet.value.size);

let map: any = null;
let AMapGlobal: any = null;
let massMarks: any = null;
let polyline: any = null;
let mouseTool: any = null;
let resizeObserver: ResizeObserver | null = null;

let siteMarkers: any[] = [];       // 站点标记(DOM, zoom >= 14)
let bubbleMarkers: any[] = [];     // 聚合气泡(zoom <= 12)
let plottedMarkers: any[] = [];    // 描点标记
let selDotMarkers: any[] = [];     // 气泡模式下的选中高亮点

type ViewMode = 'bubble' | 'mass' | 'site';
let viewMode: ViewMode = 'site';

// 北京中心与初始缩放(用户指定 16)
const CENTER = [116.397428, 39.90923] as [number, number];
const ZOOM = 16;
// 分级: <=12 气泡聚合; 13 海量点(Canvas); >=14 站点标记(支持 hover/双击/右键)
const BUBBLE_MAX_ZOOM = 12;
const MASS_ZOOM = 13;
// DOM 站点标记上限(视口内), 超出则按数量截断, 保证流畅
const SITE_MARKER_MAX = 1200;

const CHINA_BOUNDS = {
  southwest: [73.5, 18.0] as [number, number],
  northeast: [135.0, 53.5] as [number, number],
};

const COLOR_ONLINE = '#52c41a';
const COLOR_OFFLINE = '#909399';
const COLOR_SELECTED = '#409eff';

// ---------------- 点位数据接入(清洗/聚合在 Worker 中完成) ----------------

// 接手 Worker 的清洗结果: list 为全量点位, changed 为本次增量变化的点位
// initial=true 时只建索引, 由 onMounted 统一首绘(此时地图还没初始化)
function applySiteFeed(feed: SiteFeed | undefined, initial = false) {
  if (!feed) return;
  siteList = feed.list || [];
  siteMap.clear();
  for (let i = 0; i < siteList.length; i++) siteMap.set(siteList[i].key, siteList[i]);

  const changed = feed.changed || [];
  const removed = feed.removed || [];
  if (initial) return;
  if (!map) return;

  if (!changed.length && !removed.length) {
    applyViewMode(); // 全量: 整体重绘
    return;
  }

  // 增量: 只刷新变化/消失的那几个点位
  if (viewMode === 'site') {
    removed.forEach(removeSiteMarker);
    changed.forEach((s) => replaceSiteMarker(s));
  } else if (viewMode === 'mass') {
    massMarks?.setData(buildMassData()); // 海量点是 Canvas, 数据整体下发(5k 级, 开销很小)
  } else {
    renderBubbles();
  }

  // 浮层里持有的是旧点位对象, 换成最新的, 避免悬停面板显示过期状态
  if (tip.value.visible && tip.value.site) {
    const fresh = siteMap.get(tip.value.site.key);
    if (fresh) tip.value.site = fresh;
  }
  if (menu.value.visible && menu.value.camera) {
    const freshSite = siteMap.get(menu.value.camera.siteKey);
    const fresh = freshSite?.cameras.find((c) => c.id === menu.value.camera.id);
    if (fresh) menu.value.camera = fresh;
  }
}

function siteSelected(s: Site) {
  return s.cameras.some((c) => selectedSet.value.has(c.id));
}
// 点位在线 = 该点位至少有一台在线(Worker 已预计算)
function siteOnline(s: Site) {
  return Number(s.online) > 0;
}
function stateColor(cam: any) {
  return Number(cam.state) === 1 ? COLOR_ONLINE : COLOR_OFFLINE;
}
function stateText(cam: any) {
  return Number(cam?.state) === 1 ? '在线' : '离线';
}
// 单台摄像头的类别定义(模板用)
function typeDef(cam: any) {
  return cameraTypeOf(cam?.type);
}
// 点位的状态色: 选中蓝 > 在线绿 > 离线灰
function siteColor(s: Site) {
  if (siteSelected(s)) return COLOR_SELECTED;
  return siteOnline(s) ? COLOR_ONLINE : COLOR_OFFLINE;
}
// 点位图标尺寸(选中放大)
function siteIconSize(s: Site) {
  return siteSelected(s) ? 26 : 22;
}
// 点位代表类别: 同点位多台时取第一台的类别(形状表示"这是什么设备", 数量由角标表达)
function siteTypeDef(s: Site) {
  return cameraTypeOf(s.type);
}

// ---------------- 图标(SVG, 形状=类别, 颜色=状态) ----------------

// ---------------- 清除 ----------------

function clearSiteMarkers() {
  siteMarkers.forEach((m) => m.setMap(null));
  siteMarkers = [];
  siteMarkersByKey.clear();
}
function clearBubbles() { bubbleMarkers.forEach((m) => m.setMap(null)); bubbleMarkers = []; }
function clearSelDots() { selDotMarkers.forEach((m) => m.setMap(null)); selDotMarkers = []; }
function hideMass() { if (massMarks) massMarks.hide(); }

// ---------------- 模式一: 站点标记(zoom >= 14) ----------------

function siteMarkerHtml(s: Site) {
  const sel = siteSelected(s);
  const color = siteColor(s);
  const size = siteIconSize(s);
  const iconSize = Math.round(size * 0.62);
  const multi = Number(s.count) > 1;
  const def = siteTypeDef(s);
  // 选中态: 白间隔 + 半透明蓝色光晕
  const ring = sel
    ? 'box-shadow:0 0 0 2px #fff,0 0 0 5px rgba(64,158,255,.38);'
    : multi
      ? 'box-shadow:0 0 0 2px #fff,0 0 0 4px rgba(0,0,0,.14);'
      : 'box-shadow:0 0 0 2px #fff;';
  // 同点位多台摄像头: 右上角数量角标
  const badge = multi
    ? `<span style="position:absolute;left:${size - 8}px;top:-7px;min-width:16px;height:16px;line-height:14px;` +
      `padding:0 3px;border-radius:8px;background:#fff;border:1px solid ${color};color:${color};` +
      `font-size:10px;font-family:Arial,sans-serif;text-align:center;box-sizing:border-box;">${s.count}</span>`
    : '';
  return (
    `<div style="position:relative;width:${size}px;height:${size}px;cursor:pointer;">` +
    `<div style="width:${size}px;height:${size}px;border-radius:50%;background:#fff;border:2px solid ${color};` +
    `box-sizing:border-box;display:flex;align-items:center;justify-content:center;${ring}">` +
    typeIconSvg(def.path, color, iconSize) +
    `</div>${badge}</div>`
  );
}

// 站点标记的点击延后处理: 用于区分单击(选中)与双击(播放), 避免双击时先触发两次选中
let clickTimer: any = null;
let lastMarkerClick = 0;
function markMarkerClick() { lastMarkerClick = Date.now(); }

function clickCamera(cam: any) {
  if (clickTimer) clearTimeout(clickTimer);
  clickTimer = setTimeout(() => { clickTimer = null; emit('select', cam.id); }, 240);
}
function dblClickCamera(cam: any) {
  if (clickTimer) { clearTimeout(clickTimer); clickTimer = null; }
  emit('openVideo', cam.id);
}

function onSiteClick(s: Site) {
  if (s.cameras.length === 1) { clickCamera(s.cameras[0]); return; }
  // 同点多摄像头: 钉住提示列表, 由用户在列表里挑具体某一台
  showTip(s, undefined, true);
}
function onSiteDblClick(s: Site) {
  if (s.cameras.length === 1) { dblClickCamera(s.cameras[0]); return; }
  map?.setZoomAndCenter(Math.min(map.getZoom() + 2, 18), [s.lng, s.lat]);
}
function onSiteRightClick(s: Site) {
  const px = pixelOf(s);
  if (s.cameras.length === 1) openMenuAt(s.cameras[0], px);
  else showTip(s, px, true);
}

// 单个点位标记(创建逻辑集中一处, 增量刷新时整体替换)
function createSiteMarker(s: Site) {
  if (!map) return null;
  const size = siteIconSize(s);
  const marker = new AMapGlobal.Marker({
    position: [s.lng, s.lat],
    content: siteMarkerHtml(s),
    offset: new AMapGlobal.Pixel(-size / 2, -size / 2),
    zIndex: siteSelected(s) ? 180 : 150,
  });
  marker.on('mouseover', () => showTip(s));
  marker.on('mouseout', () => scheduleHideTip());
  marker.on('click', () => { markMarkerClick(); onSiteClick(s); });
  marker.on('dblclick', () => { markMarkerClick(); onSiteDblClick(s); });
  marker.on('rightclick', () => { markMarkerClick(); onSiteRightClick(s); });
  marker.setMap(map);
  siteMarkers.push(marker);
  siteMarkersByKey.set(s.key, marker);
  return marker;
}

// 增量刷新: 只重建内容变化的点位标记, 其余 DOM 标记原样保留(不整屏重建)
function replaceSiteMarker(s: Site) {
  const old = siteMarkersByKey.get(s.key);
  if (!old) {
    // 该点位原先不在视口内(或刚由其它坐标迁入): 在视口内才补建, 否则等下次 moveend 重绘
    if (inViewport(s)) createSiteMarker(s);
    return;
  }
  const idx = siteMarkers.indexOf(old);
  old.setMap(null);
  if (idx >= 0) siteMarkers.splice(idx, 1);
  siteMarkersByKey.delete(s.key);
  createSiteMarker(s);
}

// 点位被清空(摄像头迁走/删除): 移除它的标记, 并关掉引用它的浮层/菜单
function removeSiteMarker(key: string) {
  const old = siteMarkersByKey.get(key);
  if (old) {
    const idx = siteMarkers.indexOf(old);
    old.setMap(null);
    if (idx >= 0) siteMarkers.splice(idx, 1);
    siteMarkersByKey.delete(key);
  }
  if (tip.value.visible && tip.value.site && tip.value.site.key === key) {
    tip.value.visible = false;
    tip.value.site = null;
  }
  if (menu.value.visible && menu.value.camera && menu.value.camera.siteKey === key) {
    menu.value.visible = false;
    menu.value.camera = null;
  }
}

// 点位是否落在当前视口内(带 0.001 度容差, 与 renderSites 一致)
function inViewport(s: Site) {
  if (!map) return false;
  const bounds = map.getBounds();
  if (!bounds) return true;
  const sw = bounds.getSouthWest();
  const ne = bounds.getNorthEast();
  const pad = 0.001;
  return (
    s.lng >= sw.getLng() - pad && s.lng <= ne.getLng() + pad &&
    s.lat >= sw.getLat() - pad && s.lat <= ne.getLat() + pad
  );
}

function renderSites() {
  clearSiteMarkers();
  if (!map || !siteList.length) return;

  const bounds = map.getBounds();
  const sw = bounds.getSouthWest();
  const ne = bounds.getNorthEast();
  const pad = 0.001;
  let list = siteList.filter(
    (s) =>
      s.lng >= sw.getLng() - pad && s.lng <= ne.getLng() + pad &&
      s.lat >= sw.getLat() - pad && s.lat <= ne.getLat() + pad
  );
  if (list.length > SITE_MARKER_MAX) list = list.slice(0, SITE_MARKER_MAX);

  list.forEach((s) => createSiteMarker(s));
}

// ---------------- 模式二: 海量点(zoom = 13, Canvas) ----------------

// 样式表按「类别 × 单/多点 × 状态」生成, 索引 = typeIdx * 6 + (multi ? 3 : 0) + stateIdx
// stateIdx: 0 在线 / 1 离线 / 2 选中
function buildMassStyles() {
  const styles: any[] = [];
  for (const def of CAMERA_TYPES) {
    for (const multi of [false, true]) {
      for (const color of [COLOR_ONLINE, COLOR_OFFLINE, COLOR_SELECTED]) {
        const selected = color === COLOR_SELECTED;
        const size = selected ? 26 : multi ? 24 : 22;
        styles.push({
          url: typeMarkerDataUri(def.path, color, {
            size,
            iconSize: Math.round(size * 0.58),
            doubleRing: multi,
          }),
          anchor: new AMapGlobal.Pixel(size / 2, size / 2),
          size: new AMapGlobal.Size(size, size),
        });
      }
    }
  }
  return styles;
}

function massStyleIndex(s: Site) {
  const sel = siteSelected(s);
  const multi = Number(s.count) > 1;
  const typeIdx = Math.max(0, CAMERA_TYPES.findIndex((t) => t.value === Number(s.type)));
  const stateIdx = sel ? 2 : siteOnline(s) ? 0 : 1;
  return typeIdx * 6 + (multi ? 3 : 0) + stateIdx;
}

function buildMassData() {
  return siteList.map((s) => ({
    lnglat: [s.lng, s.lat] as [number, number],
    style: massStyleIndex(s),
    key: s.key,
  }));
}

function ensureMassMarks() {
  if (!AMapGlobal?.MassMarks) return false;
  if (massMarks) return true;
  massMarks = new AMapGlobal.MassMarks([], {
    zIndex: 111,
    zooms: [MASS_ZOOM, MASS_ZOOM],
    style: buildMassStyles(),
  });
  massMarks.on('click', (e: any) => {
    const key = e?.data?.key;
    const site = key ? siteMap.get(key) : null;
    if (!site) return;
    if (Number(site.count) === 1) emit('select', site.cameras[0].id);
    else map?.setZoomAndCenter(15, [site.lng, site.lat]); // 多摄像头: 放大到可交互级别
  });
  massMarks.setMap(map);
  return true;
}

function renderMass() {
  if (!map) return;
  if (!ensureMassMarks()) { renderSites(); return; }
  massMarks.setData(buildMassData());
  massMarks.show();
}

// ---------------- 模式三: 聚合气泡(zoom <= 12) ----------------

function bubbleHtml(count: number, size: number) {
  return (
    `<div style="width:${size}px;height:${size}px;border-radius:50%;` +
    `background:rgba(64,158,255,0.18);border:2px solid ${COLOR_SELECTED};color:#1a6fd4;` +
    `display:flex;align-items:center;justify-content:center;font-size:${count > 999 ? 11 : 12}px;` +
    `font-weight:600;box-shadow:0 0 0 6px rgba(64,158,255,0.12);box-sizing:border-box;` +
    `font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;">${count}</div>`
  );
}

function renderBubbles() {
  clearBubbles();
  clearSelDots();
  if (!map) return;

  const zoom = Math.max(map.getZoom(), 3);
  const cell = 0.4 / Math.pow(2, zoom - 8); // zoom 8 -> 0.4°, 10 -> 0.1°, 12 -> 0.025°
  const buckets = new Map<string, { n: number; lng: number; lat: number }>();

  // 直接用 Worker 聚合后的点位做网格聚合, 比遍历 1 万条原始数据更快
  for (const s of siteList) {
    const lng = s.lng;
    const lat = s.lat;
    const key = `${Math.floor(lng / cell)}_${Math.floor(lat / cell)}`;
    let b = buckets.get(key);
    if (!b) { b = { n: 0, lng: 0, lat: 0 }; buckets.set(key, b); }
    b.n += Number(s.count) || 1;
    b.lng += lng * (Number(s.count) || 1);
    b.lat += lat * (Number(s.count) || 1);
  }

  buckets.forEach((b) => {
    const pos: [number, number] = [b.lng / b.n, b.lat / b.n];
    const size = Math.min(46, Math.max(20, 18 + Math.sqrt(b.n) * 2));
    const marker = new AMapGlobal.Marker({
      position: pos,
      content: bubbleHtml(b.n, size),
      offset: new AMapGlobal.Pixel(-size / 2, -size / 2),
      zIndex: 120,
    });
    marker.on('click', () => map.setZoomAndCenter(Math.min(zoom + 2, 18), pos));
    marker.setMap(map);
    bubbleMarkers.push(marker);
  });

  // 气泡模式下也让选中结果可见(最多 300 个, 保证流畅)
  if (selectedSet.value.size) {
    const list = props.positions.filter((p) => selectedSet.value.has(p.id)).slice(0, 300);
    list.forEach((p) => {
      const def = cameraTypeOf(p.type);
      const size = 24;
      const marker = new AMapGlobal.Marker({
        position: [Number(p.longitude), Number(p.latitude)],
        icon: typeMarkerDataUri(def.path, COLOR_SELECTED, { size, iconSize: Math.round(size * 0.62) }),
        offset: new AMapGlobal.Pixel(-size / 2, -size / 2),
        zIndex: 200,
      });
      marker.setMap(map);
      selDotMarkers.push(marker);
    });
  }
}

// ---------------- 视图模式切换 ----------------

function applyViewMode() {
  if (!map) return;
  const z = map.getZoom();
  const mode: ViewMode = z <= BUBBLE_MAX_ZOOM ? 'bubble' : z === MASS_ZOOM ? 'mass' : 'site';
  viewMode = mode;
  closeOverlays();

  if (mode === 'bubble') {
    hideMass();
    clearSiteMarkers();
    renderBubbles();
  } else if (mode === 'mass') {
    clearBubbles();
    clearSelDots();
    clearSiteMarkers();
    renderMass();
  } else {
    clearBubbles();
    clearSelDots();
    hideMass();
    renderSites();
  }
  renderPlotted();
}

// 选中态变化: 只刷新配色
function refreshSelection() {
  if (viewMode === 'bubble') renderBubbles();
  else if (viewMode === 'mass') renderMass();
  else renderSites();
}

// ---------------- 悬停提示 / 右键菜单 ----------------

const tip = ref<{ visible: boolean; x: number; y: number; site: Site | null; sticky: boolean }>({
  visible: false, x: 0, y: 0, site: null, sticky: false,
});
const menu = ref<{ visible: boolean; x: number; y: number; camera: any | null }>({
  visible: false, x: 0, y: 0, camera: null,
});
let hideTimer: any = null;

function wrapSize() {
  return { w: mapRef.value?.clientWidth || 0, h: mapRef.value?.clientHeight || 0 };
}

function pixelOf(s: Site) {
  try {
    const p = map.lngLatToContainer(new AMapGlobal.LngLat(s.lng, s.lat));
    return { x: p.getX(), y: p.getY() };
  } catch (_) {
    return { x: 0, y: 0 };
  }
}

function showTip(s: Site, px?: { x: number; y: number }, sticky = false) {
  cancelHideTip();
  const p = px || pixelOf(s);
  const { w, h } = wrapSize();
  tip.value = {
    visible: true,
    x: Math.max(8, Math.min(p.x + 14, Math.max(8, w - 260))),
    y: Math.max(8, Math.min(p.y - 10, Math.max(8, h - 190))),
    site: s,
    sticky,
  };
}

function scheduleHideTip() {
  if (tip.value.sticky) return;
  if (hideTimer) clearTimeout(hideTimer);
  hideTimer = setTimeout(() => {
    tip.value.visible = false;
    hideTimer = null;
  }, 180);
}
function cancelHideTip() {
  if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
}

function localPoint(e: MouseEvent) {
  const rect = mapRef.value?.getBoundingClientRect();
  return { x: e.clientX - (rect?.left || 0), y: e.clientY - (rect?.top || 0) };
}

function openMenuAt(cam: any, px: { x: number; y: number }) {
  const { w, h } = wrapSize();
  menu.value = {
    visible: true,
    x: Math.max(8, Math.min(px.x, Math.max(8, w - 180))),
    y: Math.max(8, Math.min(px.y, Math.max(8, h - 150))),
    camera: cam,
  };
  tip.value.visible = false;
}

function fireAction(action: string) {
  const cam = menu.value.camera;
  menu.value.visible = false;
  if (cam) emit('menuAction', { action, camera: cam });
}

function closeOverlays() {
  tip.value.visible = false;
  menu.value.visible = false;
}

// 提示列表里的单行 = 单摄像头逻辑(多选: 点一行追加选中, 再点同一行才反选)
function onTipRowClick(cam: any) {
  markMarkerClick();
  // 钉住提示: 选中后站点标记会重建(触发 mouseout), 不钉住的话提示会被隐藏, 无法连续多选
  tip.value.sticky = true;
  clickCamera(cam);
}
function onTipRowDblClick(cam: any) {
  markMarkerClick();
  tip.value.sticky = true;
  dblClickCamera(cam);
}

// ---------------- 描点 / 连线 ----------------

function plottedMarkerContent() {
  return `<div style="width:18px;height:18px;background:${COLOR_SELECTED};border:2px solid #fff;border-radius:50%;box-shadow:0 0 6px rgba(0,0,0,.5);"></div>`;
}

function renderPlotted() {
  plottedMarkers.forEach((m) => m.setMap(null));
  plottedMarkers = [];
  if (polyline) { polyline.setMap(null); polyline = null; }
  if (!map || !props.plotted.length) return;

  props.plotted.forEach((p) => {
    const marker = new AMapGlobal.Marker({
      position: [Number(p.longitude), Number(p.latitude)],
      content: plottedMarkerContent(),
      offset: new AMapGlobal.Pixel(-10, -10),
      zIndex: 300,
    });
    marker.on('click', () => emit('select', p.id));
    marker.setMap(map);
    plottedMarkers.push(marker);
  });

  if (props.plotted.length >= 2) {
    polyline = new AMapGlobal.Polyline({
      path: props.plotted.map((p) => [Number(p.longitude), Number(p.latitude)]),
      strokeColor: COLOR_SELECTED,
      strokeWeight: 3,
      strokeOpacity: 0.85,
      zIndex: 250,
      showDir: true,
    });
    polyline.setMap(map);
  }
}

// 飞到指定坐标(列表点击 / 描点时调用)
function flyTo(lnglat: [number, number]) {
  if (!map) return;
  const zoom = Math.max(map.getZoom(), ZOOM);
  map.setZoomAndCenter(zoom, lnglat, false, 400);
}

// ---------------- 框选 ----------------

function initMouseTool() {
  if (!AMapGlobal?.MouseTool || mouseTool) return;
  mouseTool = new AMapGlobal.MouseTool(map);
  mouseTool.on('draw', (e: any) => {
    let minLng = NaN, maxLng = NaN, minLat = NaN, maxLat = NaN;
    try {
      const obj = e.obj || e.rect || e.marker;
      const bounds = obj && obj.getBounds ? obj.getBounds() : null;
      if (bounds) {
        const sw = bounds.getSouthWest();
        const ne = bounds.getNorthEast();
        minLng = Math.min(sw.getLng(), ne.getLng());
        maxLng = Math.max(sw.getLng(), ne.getLng());
        minLat = Math.min(sw.getLat(), ne.getLat());
        maxLat = Math.max(sw.getLat(), ne.getLat());
      }
    } catch (_) { /* 取不到则视为空选 */ }

    const valid = [minLng, maxLng, minLat, maxLat].every((v) => Number.isFinite(v));
    const ids = valid
      ? props.positions
          .filter((p) => {
            const lng = Number(p.longitude);
            const lat = Number(p.latitude);
            return lng >= minLng && lng <= maxLng && lat >= minLat && lat <= maxLat;
          })
          .map((p) => p.id)
      : [];

    emit('boxSelect', ids);
    stopBoxSelect(true);
  });
}

function startBoxSelect() {
  if (mouseTool) {
    boxSelectActive.value = true;
    mouseTool.rectangle();
    return;
  }
  if (AMapGlobal?.plugin) {
    AMapGlobal.plugin(['AMap.MouseTool'], () => {
      initMouseTool();
      if (mouseTool) {
        boxSelectActive.value = true;
        mouseTool.rectangle();
      }
    });
  }
}

function stopBoxSelect(clearOverlay = false) {
  boxSelectActive.value = false;
  try { mouseTool?.close(clearOverlay); } catch (_) { /* ignore */ }
}
function toggleBoxSelect() {
  closeOverlays();
  if (boxSelectActive.value) stopBoxSelect(true);
  else startBoxSelect();
}
function clearBoxSelect() {
  stopBoxSelect(true);
  emit('boxSelect', []);
}

// ---------------- 生命周期 ----------------

onMounted(async () => {
  try {
    AMapGlobal = await loadAMap();
    map = new AMapGlobal.Map(mapRef.value, {
      zoom: ZOOM,
      center: CENTER,
      viewMode: '2D',
      doubleClickZoom: false, // 双击用于"打开视频", 不让地图缩放
    });
    map.setLimitBounds(new AMapGlobal.Bounds(CHINA_BOUNDS.southwest, CHINA_BOUNDS.northeast));

    if (typeof ResizeObserver !== 'undefined' && mapRef.value) {
      resizeObserver = new ResizeObserver(() => map?.resize());
      resizeObserver.observe(mapRef.value);
    }

    applySiteFeed(props.siteFeed, true); // 建立点位索引(数据由 Worker 清洗聚合)
    applyViewMode();

    map.on('zoomend', () => applyViewMode());
    map.on('moveend', () => {
      if (viewMode === 'site') renderSites();
    });
    // 点击空白 / 右键 / 拖动 关闭浮层(标记自身的点击不触发关闭)
    map.on('click', () => {
      if (Date.now() - lastMarkerClick < 300) return;
      closeOverlays();
    });
    map.on('rightclick', () => closeOverlays());
    map.on('movestart', () => closeOverlays());

    initMouseTool();
    renderPlotted();
  } catch (e: any) {
    console.warn('[CameraMap] 地图初始化失败:', e?.message || e);
  }
});

// 点位数据变化: 全量 -> 整体重绘; 增量 -> 只重建变化的点位标记
watch(() => props.siteFeed, (feed) => applySiteFeed(feed));
watch(() => props.plotted, () => { renderPlotted(); });
watch(selectedSet, () => { refreshSelection(); });

onBeforeUnmount(() => {
  resizeObserver?.disconnect();
  resizeObserver = null;
  stopBoxSelect(true);
  if (clickTimer) clearTimeout(clickTimer);
  if (hideTimer) clearTimeout(hideTimer);
  plottedMarkers.forEach((m) => m.setMap(null));
  plottedMarkers = [];
  clearSiteMarkers();
  clearBubbles();
  clearSelDots();
  siteMap.clear();
  siteList = [];
  if (polyline) { polyline.setMap(null); polyline = null; }
  if (massMarks) { massMarks.setMap(null); massMarks = null; }
  map?.destroy();
  map = null;
});

defineExpose({ flyTo });
</script>

<style scoped>
.camera-map-wrap {
  position: relative;
  width: 100%;
  height: 100%;
  /* 关键: 让地图容器自成一个层叠上下文, 把内部所有 z-index
     (工具栏 10 / 悬停提示 20 / 右键菜单 30, 以及高德自带的 logo、版权层)
     全部锁在地图内部, 不再与页面同级元素(视频面板、弹窗)抢层级。
     否则窗口较矮时, 地图右上角的「框选 / 清除框选」会盖在视频面板之上。 */
  isolation: isolate;
}
.camera-map {
  width: 100%;
  height: 100%;
}

/* 工具栏 */
.map-toolbar {
  position: absolute;
  top: 12px;
  right: 12px;
  z-index: 10;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 8px;
}
.map-tool {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 5px 10px;
  font-size: 12px;
  color: #333;
  background: #fff;
  border: 1px solid #dcdfe6;
  border-radius: 4px;
  cursor: pointer;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.12);
}
.map-tool:hover { color: #409eff; border-color: #409eff; }
.map-tool.active { color: #fff; background: #409eff; border-color: #409eff; }
.map-chip {
  padding: 3px 8px;
  font-size: 12px;
  color: #1a6fd4;
  background: #ecf5ff;
  border: 1px solid #b3d8ff;
  border-radius: 10px;
}

/* 悬停提示 */
.map-tip {
  position: absolute;
  z-index: 20;
  min-width: 180px;
  max-width: 250px;
  max-height: 280px;
  overflow-y: auto;
  padding: 8px 10px;
  background: rgba(255, 255, 255, 0.98);
  border: 1px solid #e4e7ed;
  border-radius: 6px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.16);
  font-size: 12px;
  color: #303133;
  pointer-events: auto;
}
.tip-name {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  font-weight: 600;
}
.name-text {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.type-ico { flex-shrink: 0; display: block; }
.tip-sub { margin-top: 4px; color: #909399; word-break: break-all; }
.tip-hint { margin-top: 6px; color: #c0c4cc; font-size: 11px; }
.tip-head {
  margin-bottom: 6px;
  padding-bottom: 6px;
  border-bottom: 1px solid #f0f0f0;
  color: #909399;
  font-size: 12px;
}
.tip-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 6px;
  border-radius: 4px;
  cursor: pointer;
}
.tip-row:hover { background: #f5f7fa; }
.tip-row.on { background: #ecf5ff; box-shadow: inset 2px 0 0 #409eff; }
.row-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.row-state { flex-shrink: 0; font-size: 11px; }

/* 右键菜单 */
.map-menu {
  position: absolute;
  z-index: 30;
  min-width: 150px;
  padding: 4px;
  background: #fff;
  border: 1px solid #e4e7ed;
  border-radius: 6px;
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.18);
}
.menu-title {
  padding: 6px 8px;
  border-bottom: 1px solid #f0f0f0;
  color: #909399;
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.menu-item {
  display: block;
  width: 100%;
  padding: 7px 10px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: #303133;
  font-size: 13px;
  text-align: left;
  cursor: pointer;
}
.menu-item:hover { background: #ecf5ff; color: #409eff; }
</style>
