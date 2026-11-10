/**
 * 摄像头数据清洗 Worker(独立运行, 不 import 任何模块)
 * ------------------------------------------------------------------
 * 为什么是纯 JS: 微前端下子应用入口与主应用不同源, 直接 new Worker(远程 URL) 会被
 * 浏览器同源策略拦截。这里用 ?raw 把源码内联进包, 再用 Blob URL 创建 Worker,
 * 天然同源; 同时同一份源码还能在 Worker 不可用时回退到主线程执行(见文件末尾)。
 *
 * 职责(全量承接数据清洗, 主线程只负责渲染):
 *   1. 全量清洗: 字段归一(数字转换/去空格/兜底命名)、合法性校验、重复 id 去重、
 *      坐标精度对齐、按经纬度(5 位小数)聚合点位、统计在线/离线/点位数量
 *   2. 增量清洗: 收到变更项后只改对应摄像头(状态/名称/地址/类别/坐标),
 *      坐标变化时把摄像头从旧点位迁移到新点位, 重新计算受影响点位的聚合指标,
 *      返回"真正发生变化"的摄像头与点位 —— 未变化的直接丢弃(增量对比)
 */
'use strict';

var SITE_PRECISION = 5; // 经纬度保留 5 位小数(约 1 米)视为同一点位

// ---------------- 内部状态(Worker 常驻内存) ----------------
var list = [];              // 清洗后的摄像头(顺序稳定)
var camIndex = new Map();   // id -> list 下标
var siteMap = new Map();    // siteKey -> 点位
var siteKeys = [];          // 点位顺序
var stats = emptyStats();

function emptyStats() {
  return { total: 0, online: 0, offline: 0, dropped: 0, sites: 0, multiSites: 0 };
}

function toNum(v) {
  if (typeof v === 'number') return v;
  if (typeof v === 'string') return v.trim() === '' ? NaN : Number(v);
  return NaN;
}

function round(v, digits) {
  var p = Math.pow(10, digits);
  return Math.round(v * p) / p;
}

/** 单条清洗: 字段归一 + 合法性校验, 非法返回 null */
function normalize(raw) {
  if (!raw || typeof raw !== 'object') return null;

  var id = toNum(raw.id);
  if (!isFinite(id) || id <= 0) return null;

  var lng = toNum(raw.longitude);
  var lat = toNum(raw.latitude);
  if (!isFinite(lng) || !isFinite(lat)) return null;
  if (lng < -180 || lng > 180 || lat < -90 || lat > 90) return null;
  if (lng === 0 && lat === 0) return null; // (0,0) 视为坐标未采集

  var state = toNum(raw.state) === 1 ? 1 : 0;
  var type = toNum(raw.type);
  type = type === 2 || type === 3 ? type : 1;

  var name = typeof raw.cameraName === 'string' ? raw.cameraName.trim() : '';
  if (!name) name = '未命名摄像头-' + id;
  else if (name.length > 64) name = name.slice(0, 64) + '…';

  var address = typeof raw.address === 'string' ? raw.address.trim() : '';

  return {
    id: id,
    cameraName: name,
    address: address,
    longitude: round(lng, 6),
    latitude: round(lat, 6),
    state: state,
    type: type,
    siteKey: lng.toFixed(SITE_PRECISION) + ',' + lat.toFixed(SITE_PRECISION),
  };
}

/** 全量清洗: 重建摄像头列表 / 点位索引 / 统计 */
function cleanAll(rawList) {
  list = [];
  camIndex = new Map();
  siteMap = new Map();
  siteKeys = [];
  stats = emptyStats();

  var len = Array.isArray(rawList) ? rawList.length : 0;
  var online = 0;

  for (var i = 0; i < len; i++) {
    var cam = normalize(rawList[i]);
    if (!cam) { stats.dropped++; continue; }
    if (camIndex.has(cam.id)) { stats.dropped++; continue; } // 重复 id 去重(保留第一条)

    camIndex.set(cam.id, list.length);
    list.push(cam);
    if (cam.state === 1) online++;

    var site = siteMap.get(cam.siteKey);
    if (!site) {
      var parts = cam.siteKey.split(',');
      site = {
        key: cam.siteKey,
        lng: Number(parts[0]),
        lat: Number(parts[1]),
        count: 0,
        online: 0,
        multi: 0,
        type: cam.type,
        cameras: [],
      };
      siteMap.set(cam.siteKey, site);
      siteKeys.push(cam.siteKey);
    }
    site.count++;
    site.cameras.push(cam);
    if (cam.state === 1) site.online++;
  }

  var sites = new Array(siteKeys.length);
  var multiSites = 0;
  for (var k = 0; k < siteKeys.length; k++) {
    var s = siteMap.get(siteKeys[k]);
    s.multi = s.count > 1 ? 1 : 0;
    if (s.multi) multiSites++;
    sites[k] = s;
  }

  stats.total = list.length;
  stats.online = online;
  stats.offline = stats.total - online;
  stats.sites = sites.length;
  stats.multiSites = multiSites;

  return { list: list, sites: sites, stats: stats };
}

/**
 * 增量清洗: 只处理传入的变更项
 * 返回 cameras/sites 均为"真正发生变化"的部分, 未变化的不返回
 *
 * 支持三种变更(管理后台的修改会同时带上状态/名称/地址/类别/坐标):
 *   ① 状态 / 名称 / 地址 / 类别变化 -> 就地更新摄像头, 重算所属点位的聚合指标
 *   ② 坐标变化 -> 从旧点位迁移到新点位, 旧点位空了要移除(removedSites)
 *   ③ 未知 id(新增/已删除) -> needFull, 交给调用方全量重建
 */
function patchCameras(changes) {
  var touched = new Set();      // 受影响的点位
  var removedSites = [];        // 因摄像头迁走而清空的点位
  var outCameras = [];
  var unknown = 0;
  var len = Array.isArray(changes) ? changes.length : 0;

  for (var i = 0; i < len; i++) {
    var ch = changes[i];
    if (!ch) continue;
    var id = toNum(ch.id);
    var pos = camIndex.get(id);
    if (pos === undefined) {
      unknown++; // 本地没有的摄像头(新增/已删除) -> 需要全量重建
      continue;
    }
    var cam = list[pos];
    var dirty = false;

    // ① 状态
    if (ch.state !== undefined) {
      var nextState = toNum(ch.state) === 1 ? 1 : 0;
      if (cam.state !== nextState) { cam.state = nextState; dirty = true; }
    }
    // ② 名称(与全量清洗同一套规则: 去空格 / 兜底命名 / 超长截断)
    if (ch.cameraName !== undefined) {
      var name = typeof ch.cameraName === 'string' ? ch.cameraName.trim() : '';
      if (!name) name = '未命名摄像头-' + id;
      else if (name.length > 64) name = name.slice(0, 64) + '…';
      if (cam.cameraName !== name) { cam.cameraName = name; dirty = true; }
    }
    // ③ 地址
    if (ch.address !== undefined) {
      var addr = typeof ch.address === 'string' ? ch.address.trim() : '';
      if (cam.address !== addr) { cam.address = addr; dirty = true; }
    }
    // ④ 类别
    if (ch.type !== undefined) {
      var t = toNum(ch.type);
      t = t === 2 || t === 3 ? t : 1;
      if (cam.type !== t) { cam.type = t; dirty = true; }
    }

    // ⑤ 坐标: 只有合法坐标才允许移动点位(脏数据保持原位置, 避免监控端把点"弄丢")
    var nextLng = cam.longitude;
    var nextLat = cam.latitude;
    var nextKey = cam.siteKey;
    var moved = false;
    if (ch.longitude !== undefined || ch.latitude !== undefined) {
      var nlng = ch.longitude === undefined ? cam.longitude : toNum(ch.longitude);
      var nlat = ch.latitude === undefined ? cam.latitude : toNum(ch.latitude);
      var valid = isFinite(nlng) && isFinite(nlat) &&
        !(nlng === 0 && nlat === 0) &&
        nlng >= -180 && nlng <= 180 && nlat >= -90 && nlat <= 90;
      if (valid) {
        nextLng = round(nlng, 6);
        nextLat = round(nlat, 6);
        nextKey = nlng.toFixed(SITE_PRECISION) + ',' + nlat.toFixed(SITE_PRECISION);
        moved = nextKey !== cam.siteKey;
        if (!moved && (nextLng !== cam.longitude || nextLat !== cam.latitude)) dirty = true;
      }
    }

    if (!dirty && !moved) continue; // 所有字段都没变, 直接丢弃(增量对比核心)

    if (moved) {
      detachFromSite(cam, touched, removedSites); // 先从旧点位摘掉
      cam.longitude = nextLng;
      cam.latitude = nextLat;
      cam.siteKey = nextKey;
      attachToSite(cam);                          // 再挂到新点位(可能是新建的)
      touched.add(nextKey);
    } else {
      cam.longitude = nextLng;
      cam.latitude = nextLat;
      touched.add(cam.siteKey);
    }
    outCameras.push(cam);
  }

  // 受影响点位重算聚合指标
  var outSites = [];
  touched.forEach(function (key) {
    var site = siteMap.get(key);
    if (site) outSites.push(recomputeSite(site));
  });

  // 统计: 点位增删/类别变化会让"点位总数/多点位数"变化, 全量重算更可靠(1 万级, 亚毫秒)
  recountStats();

  return {
    needFull: unknown > 0,
    cameras: outCameras,
    sites: outSites,
    removedSites: removedSites,
    stats: stats,
    changed: outCameras.length,
    unknown: unknown,
  };
}

/** 从点位摘掉一台摄像头; 点位被摘空则删除并记入 removedSites */
function detachFromSite(cam, touched, removedSites) {
  var site = siteMap.get(cam.siteKey);
  if (!site) return;
  var idx = site.cameras.indexOf(cam);
  if (idx < 0) return;
  site.cameras.splice(idx, 1);
  if (site.cameras.length) {
    touched.add(cam.siteKey);
    return;
  }
  siteMap.delete(cam.siteKey);
  var ki = siteKeys.indexOf(cam.siteKey);
  if (ki >= 0) siteKeys.splice(ki, 1);
  removedSites.push(cam.siteKey);
}

/** 把摄像头挂到点位(点位不存在则新建) */
function attachToSite(cam) {
  var site = siteMap.get(cam.siteKey);
  if (!site) {
    var parts = cam.siteKey.split(',');
    site = {
      key: cam.siteKey,
      lng: Number(parts[0]),
      lat: Number(parts[1]),
      count: 0,
      online: 0,
      multi: 0,
      type: cam.type,
      cameras: [],
    };
    siteMap.set(cam.siteKey, site);
    siteKeys.push(cam.siteKey);
  }
  site.cameras.push(cam);
}

/** 重算单个点位的聚合指标 */
function recomputeSite(site) {
  site.count = site.cameras.length;
  var online = 0;
  for (var j = 0; j < site.cameras.length; j++) {
    if (site.cameras[j].state === 1) online++;
  }
  site.online = online;
  site.multi = site.count > 1 ? 1 : 0;
  if (site.cameras.length) site.type = site.cameras[0].type;
  return site;
}

/** 全量重算统计(点数会随增删变化, 增量累加容易漂移) */
function recountStats() {
  var online = 0;
  for (var i = 0; i < list.length; i++) {
    if (list[i].state === 1) online++;
  }
  var multiSites = 0;
  for (var k = 0; k < siteKeys.length; k++) {
    var s = siteMap.get(siteKeys[k]);
    if (s && s.cameras.length > 1) multiSites++;
  }
  stats.total = list.length;
  stats.online = online;
  stats.offline = list.length - online;
  stats.sites = siteKeys.length;
  stats.multiSites = multiSites;
}

/** 清空内部状态 */
function resetAll() {
  list = [];
  camIndex = new Map();
  siteMap = new Map();
  siteKeys = [];
  stats = emptyStats();
  return { ok: true };
}

// ---------------- 消息分发 ----------------

function reply(msg) {
  self.postMessage(msg);
}

function handle(msg) {
  var reqId = msg && msg.reqId;
  try {
    if (!msg || typeof msg !== 'object') throw new Error('非法指令');
    if (msg.type === 'clean') {
      var r = cleanAll(msg.raw || []);
      reply({ type: 'cleaned', reqId: reqId, list: r.list, sites: r.sites, stats: r.stats });
    } else if (msg.type === 'patch') {
      reply(Object.assign({ type: 'patched', reqId: reqId }, patchCameras(msg.changes || [])));
    } else if (msg.type === 'reset') {
      resetAll();
      reply({ type: 'reset', reqId: reqId });
    } else {
      throw new Error('未知指令: ' + msg.type);
    }
  } catch (e) {
    reply({ type: 'error', reqId: reqId, message: (e && e.message) || String(e) });
  }
}

var CAMERA_CORE = { clean: cleanAll, patch: patchCameras, reset: resetAll };

if (typeof WorkerGlobalScope !== 'undefined' && self instanceof WorkerGlobalScope) {
  self.onmessage = function (e) { handle(e.data); };
} else {
  // 主线程兜底: Worker 不可用(严格 CSP / 老浏览器)时, 用同一份源码在主线程执行,
  // 保证清洗逻辑只有一处实现, 不会出现两套规则
  self.__CAMERA_CORE__ = CAMERA_CORE;
}
