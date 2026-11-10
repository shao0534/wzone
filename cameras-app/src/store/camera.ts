import { defineStore } from 'pinia';
import { getPositions, getCameraChanges } from '../api/camera';
import { cameraWorker, WorkerColdError, WorkerGoneError } from '../utils/cameraWorkerClient';
import { onActiveTabChange, onCameraMutated } from '../micro';
import type { CleanCamera, CleanSite, CameraStats, CleanResult, PatchResult } from '../types/camera';

/** 轮询间隔(与后端「每 30s 随机切换 100 台」的后台任务保持同频) */
export const POLL_INTERVAL = 30_000;

// ---------------- 非响应式运行时状态 ----------------
// 索引只用于增量更新时 O(1) 定位, 不参与渲染, 放在响应式 state 里反而增加开销
let camIndex = new Map<number, number>();
let siteIdx = new Map<string, number>();
let pollTimer: any = null;
let inflight: AbortController | null = null;
let epoch = 0;        // 全量重建代数: 用于丢弃"重建之前发起"的增量结果
let tabBound = false; // 主应用标签监听只绑定一次
let mutationBound = false;
let focusHandler: (() => void) | null = null;
let pendingSync = false; // 同步进行中又收到"数据已改"信号时, 结束后补一次

function emptyStats(): CameraStats {
  return { total: 0, online: 0, offline: 0, dropped: 0, sites: 0, multiSites: 0 };
}

/** 是否为主动取消(组件销毁/重复请求中止), 这类错误应静默忽略 */
function isAbort(e: any): boolean {
  return e?.code === 'ERR_CANCELED' || e?.name === 'CanceledError' || e instanceof WorkerGoneError;
}

// 摄像头数据 Store
export const useCameraStore = defineStore('camera', {
  state: () => ({
    positions: [] as CleanCamera[],   // Worker 清洗后的全部摄像头(虚拟列表 + 地图共用同一份)
    sites: [] as CleanSite[],         // Worker 聚合后的点位(同经纬度多台合并)
    changedSites: [] as CleanSite[],  // 本次增量变化的点位(地图只刷新这些, 不全量重绘)
    removedSiteKeys: [] as string[],  // 本次增量中被清空的点位(摄像头迁走/删除)
    stats: emptyStats(),              // 总数/在线/离线/点位统计
    keyword: '',                      // 列表搜索关键字(前端过滤)
    version: 0,                       // 数据版本号(增量拉取的游标)
    structure: 0,                     // 结构版本号(增删摄像头时变化 -> 全量重建)
    revision: 0,                      // 每次数据落库 +1(视图侧用作"数据已更新"信号)
    loading: false,                   // 全量加载中
    syncing: false,                   // 增量同步中
    polling: false,                   // 轮询开关
    active: true,                     // 当前是否处于摄像头监控标签(非激活暂停轮询)
    lastSyncAt: 0,                    // 最近一次同步完成时间
    lastDeltaCount: 0,                // 最近一次增量变更的摄像头数
    error: '',
  }),

  getters: {
    // 根据关键字前端过滤(虚拟滚动列表数据源), 数据量大时避免反复请求后端
    filteredPositions: (state): CleanCamera[] => {
      const kw = state.keyword.trim();
      if (!kw) return state.positions;
      return state.positions.filter((c) => c.cameraName.includes(kw));
    },
    onlineCount: (state): number => state.stats.online,
    offlineCount: (state): number => state.stats.offline,
    siteCount: (state): number => state.stats.sites,
  },

  actions: {
    /** 按 id 读取摄像头(走 O(1) 索引, 定时刷新后同步视频面板状态用) */
    getById(id: number): CleanCamera | undefined {
      const i = camIndex.get(id);
      return i === undefined ? undefined : this.positions[i];
    },

    /**
     * 全量加载: 拉全量坐标 -> 交给 Worker 清洗/聚合 -> 整体落库
     * 同时会把数据"播种"进 Worker, 后续才能做增量
     */
    async loadPositions() {
      if (this.loading) return;
      this.loading = true;
      this.error = '';
      // 同一时刻只保留一个在途请求: 新的全量会中止未完成的旧请求
      const ctrl = new AbortController();
      if (inflight) inflight.abort();
      inflight = ctrl;

      try {
        const payload = await getPositions(ctrl.signal);
        if (ctrl.signal.aborted) return;
        const cleaned = (await cameraWorker.clean(payload.list || [])) as CleanResult;
        if (ctrl.signal.aborted) return;
        this.applyFull(cleaned, payload.version, payload.structure);
      } catch (e: any) {
        if (isAbort(e)) return;
        console.error('[cameras] 加载摄像头数据失败:', e?.message || e);
        this.error = e?.message || '加载失败';
      } finally {
        this.loading = false;
        if (inflight === ctrl) inflight = null;
        // 加载期间又收到"数据已改"信号: 本次结果可能已过期, 补一次增量
        if (pendingSync) {
          pendingSync = false;
          setTimeout(() => { this.syncNow(); }, 0);
        }
      }
    },

    /** 全量结果落库 + 重建索引 */
    applyFull(result: CleanResult, version: number, structure: number) {
      epoch += 1; // 使"重建之前发起"的增量结果失效
      this.positions = result.list;
      this.sites = result.sites;
      this.changedSites = [];
      this.removedSiteKeys = [];
      this.stats = result.stats;
      this.version = version;
      this.structure = structure;
      this.lastSyncAt = Date.now();
      this.lastDeltaCount = 0;
      this.revision += 1;

      camIndex = new Map();
      result.list.forEach((c, i) => camIndex.set(c.id, i));
      siteIdx = new Map();
      result.sites.forEach((s, i) => siteIdx.set(s.key, i));
    },

    /**
     * 增量同步: 只拉"上次版本之后变化的摄像头", 交给 Worker 做增量对比清洗,
     * 再按 id 精确替换受影响的摄像头对象与点位对象 —— 未变化的数据一律不动
     */
    async pollChanges() {
      if (this.syncing || this.loading || !this.version) return;
      // 页面不可见时不发请求(后台标签页继续跑只是浪费流量)
      if (typeof document !== 'undefined' && document.hidden) return;

      this.syncing = true;
      const ep = epoch;
      const ctrl = new AbortController();
      if (inflight) inflight.abort();
      inflight = ctrl;

      try {
        const payload = await getCameraChanges(this.version, ctrl.signal);
        if (ep !== epoch || ctrl.signal.aborted) return; // 期间发生过全量重建, 丢弃本次增量

        // 版本失效(服务重启)或结构变化(增删摄像头) -> 全量重建
        if (payload.full || payload.structure !== this.structure) {
          this.syncing = false;
          if (inflight === ctrl) inflight = null;
          await this.loadPositions();
          return;
        }

        if (!payload.list.length) {
          this.version = payload.version;
          this.lastSyncAt = Date.now();
          this.lastDeltaCount = 0;
          return;
        }

        const patches = (await cameraWorker.patch(payload.list)) as PatchResult;
        if (ep !== epoch || ctrl.signal.aborted) return;
        if (patches.needFull) {
          this.syncing = false;
          if (inflight === ctrl) inflight = null;
          await this.loadPositions();
          return;
        }
        this.applyDelta(patches);
        // 增量真正落库后才前移游标: 中途失败时版本不变, 下一轮会重新拉到同一批变更(幂等重放)
        this.version = payload.version;
      } catch (e: any) {
        if (e instanceof WorkerColdError) {
          // Worker 空闲已自动销毁, 内存中没有全量数据 -> 重新全量播种
          this.syncing = false;
          if (inflight === ctrl) inflight = null;
          await this.loadPositions();
          return;
        }
        if (isAbort(e)) return;
        console.warn('[cameras] 增量同步失败:', e?.message || e);
      } finally {
        this.syncing = false;
        if (inflight === ctrl) inflight = null;
        // 同步期间又收到"数据已改"信号 -> 结束后立即补一次(不丢变更)
        if (pendingSync) {
          pendingSync = false;
          setTimeout(() => { this.syncNow(); }, 0);
        }
      }
    },

    /** 增量结果落库: 只替换变化的行, 其余对象保持引用不变(避免整屏重建) */
    applyDelta(res: PatchResult) {
      const removed = res.removedSites || [];
      if (!res.cameras.length && !res.sites.length && !removed.length) {
        this.lastSyncAt = Date.now();
        this.lastDeltaCount = 0;
        return;
      }

      if (res.cameras.length) {
        const next = this.positions.slice(); // 换数组引用让列表/地图感知, 行对象只换变更的
        for (const cam of res.cameras) {
          const i = camIndex.get(cam.id);
          if (i !== undefined) next[i] = cam;
        }
        this.positions = next;
      }

      if (res.sites.length || removed.length) {
        this.applySiteDelta(res.sites, removed);
      }

      this.stats = res.stats;
      this.lastDeltaCount = res.cameras.length;
      this.lastSyncAt = Date.now();
      this.revision += 1;
    },

    /**
     * 点位增量: 常态只按索引替换变化的点位;
     * 一旦出现"新点位"(摄像头迁入)或"被清空的点位"(摄像头迁走), 才重建数组与索引
     */
    applySiteDelta(sites: CleanSite[], removedKeys: string[]) {
      // 快路径: 没有点位增删, 只替换内容变化的点位(改名/状态/类别)
      if (!removedKeys.length) {
        const next = this.sites.slice();
        let missing = false;
        for (const site of sites) {
          const i = siteIdx.get(site.key);
          if (i === undefined) { missing = true; break; } // 出现了新点位
          next[i] = site;
        }
        if (!missing) {
          this.sites = next;
          this.changedSites = sites;
          this.removedSiteKeys = [];
          return;
        }
      }

      // 慢路径: 有点位新增/移除, 重建数组与 key 索引
      const rm = new Set(removedKeys);
      const next = rm.size ? this.sites.filter((s) => !rm.has(s.key)) : this.sites.slice();
      siteIdx = new Map();
      next.forEach((s, i) => siteIdx.set(s.key, i));
      for (const site of sites) {
        const i = siteIdx.get(site.key);
        if (i === undefined) {
          siteIdx.set(site.key, next.length);
          next.push(site);
        } else {
          next[i] = site;
        }
      }
      this.sites = next;
      this.changedSites = sites;
      this.removedSiteKeys = removedKeys;
    },

    /**
     * 立即同步一次(管理后台增删改后由跨应用广播触发)
     * 不等待 30s 定时器; 如果正在同步, 打一个标记, 本轮结束后自动补一次
     */
    async syncNow() {
      if (this.loading) { pendingSync = true; return; }
      if (!this.version) { await this.loadPositions(); return; }
      if (this.syncing) { pendingSync = true; return; }
      await this.pollChanges();
    },

    /**
     * 本地修改单台摄像头状态(右键菜单/上传视频后调用)
     * 复用 Worker 的增量清洗链路, 保证点位聚合与轮询走的完全是同一套逻辑
     */
    async setCameraState(id: number, state: number) {
      try {
        const res = (await cameraWorker.patch([{ id, state }])) as PatchResult;
        if (res.needFull) await this.loadPositions();
        else this.applyDelta(res);
      } catch (e) {
        if (e instanceof WorkerColdError || e instanceof WorkerGoneError) {
          await this.loadPositions();
          return;
        }
        throw e;
      }
    },

    /** 启动 30s 轮询 */
    startPolling() {
      if (pollTimer) return;
      this.polling = true;
      // 轮询期间 Worker 随时有下一个任务, 暂缓空闲回收(否则 30s 空闲阈值与 30s 轮询会互相打架)
      cameraWorker.holdIdle(true);
      pollTimer = setInterval(() => { this.pollChanges(); }, POLL_INTERVAL);
    },

    /** 停止轮询(此后 Worker 空闲 30s 自动销毁) */
    stopPolling() {
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
      this.polling = false;
      cameraWorker.holdIdle(false);
    },

    /**
     * 监听主应用切换标签:
     * - 切到摄像头监控: 立即对齐数据(版本不符/结构变化会自动降级为全量) + 恢复轮询
     * - 切到其它菜单: 暂停轮询(面板只是 visibility:hidden, 不销毁, 但没必要继续请求)
     */
    bindActiveTab() {
      if (tabBound) return;
      tabBound = true;
      onActiveTabChange((tab) => {
        const active = tab === 'cameras';
        this.active = active;
        if (active) {
          // 用增量对齐代替无条件全量: 后台只改了名称/状态时不用重拉 1 万条
          this.syncNow();
          this.startPolling();
        } else {
          this.stopPolling();
        }
      });
      this.bindMutations();
      this.bindWindowFocus();
    },

    /**
     * 监听管理后台的增删改(主应用全局状态广播):
     * 管理与监控是两个常驻挂载的子应用, 后台一改就立即增量同步, 不必等 30s 轮询。
     * 即使监控面板当前不可见也同步 —— 这样切过去时数据已经是新的, 不会先看到旧值再跳变。
     */
    bindMutations() {
      if (mutationBound) return;
      mutationBound = true;
      onCameraMutated(() => {
        this.syncNow();
      });
    },

    /**
     * 窗口重新获得焦点 / 从后台切回前台时立即对齐
     * 场景: 管理后台开在另一个浏览器窗口里改数据, 监控窗口这一侧没有任何广播,
     * 只等 30s 轮询会明显"不及时"; 回到监控窗口的瞬间补一次增量, 基本无感。
     */
    bindWindowFocus() {
      if (focusHandler) return;
      focusHandler = () => {
        if (document.visibilityState === 'hidden') return;
        this.syncNow();
      };
      window.addEventListener('focus', focusHandler);
      document.addEventListener('visibilitychange', focusHandler);
    },

    /** 解绑窗口焦点监听(避免组件销毁后仍持有回调引用) */
    unbindWindowFocus() {
      if (!focusHandler) return;
      window.removeEventListener('focus', focusHandler);
      document.removeEventListener('visibilitychange', focusHandler);
      focusHandler = null;
    },

    /**
     * 销毁清理(组件卸载时调用):
     * 停轮询 -> 中止在途请求 -> 终止 Worker -> 清索引, 避免定时器/请求/Worker 残留引用
     */
    dispose() {
      this.stopPolling();
      this.unbindWindowFocus();
      if (inflight) {
        inflight.abort();
        inflight = null;
      }
      cameraWorker.dispose();
      camIndex.clear();
      siteIdx.clear();
      pendingSync = false;
      this.syncing = false;
      this.loading = false;
    },
  },
});
