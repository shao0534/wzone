<template>
  <div class="monitor-view">
    <!-- 顶部栏 -->
    <header class="monitor-header">
      <span class="title">摄像头监控系统</span>
      <div class="header-right">
        <!-- 同步状态: 每 30s 增量同步一次后台随机变更 -->
        <span class="sync-state" :class="{ busy: cameraStore.syncing, paused: !autoRefresh }" :title="syncTip">
          <i class="dot"></i>{{ syncLabel }}
        </span>
        <span class="auto-refresh" title="每 30 秒拉取一次增量变更(后端同时随机切换 100 台状态)" @click="autoRefresh = !autoRefresh">
          <el-switch v-model="autoRefresh" size="small" @click.stop />
          <span>自动刷新</span>
        </span>
        <span class="count">在线点位: {{ cameraStore.onlineCount }}</span>
        <el-button size="small" type="primary" @click="applyVisible = true">申请权限</el-button>
      </div>
    </header>

    <!-- 主体: 左侧列表 + 右侧地图 -->
    <div class="monitor-body">
      <!-- 左侧摄像头列表(vue-virtual-scroller 虚拟滚动, 万级数据流畅渲染) -->
      <aside class="camera-list">
        <!-- 搜索框缩小, 右侧留出「播放选中」入口 -->
        <div class="list-toolbar">
          <el-input
            v-model="cameraStore.keyword"
            class="search"
            placeholder="搜索名称"
            clearable
            size="small"
          />
          <button
            class="batch-play"
            :class="{ empty: !selectedCount }"
            :title="selectedCount ? `平铺播放选中的 ${selectedCount} 路(Max ${MAX_BATCH})` : '请先在列表/地图中选择摄像头'"
            @click="openBatch"
          >
            <svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true">
              <path d="M3 5h18v14H3V5zm2 2v10h14V7H5zm5 1 5 4-5 4V8z" fill="currentColor" />
            </svg>
            <span>播放选中</span>
            <em v-if="selectedCount">{{ selectedCount }}</em>
          </button>
        </div>
        <div class="list-body" v-loading="cameraStore.loading">
          <RecycleScroller
            v-if="cameraStore.filteredPositions.length"
            ref="scrollerRef"
            class="camera-scroller"
            :items="cameraStore.filteredPositions"
            :item-size="68"
            :buffer="340"
            key-field="id"
            v-slot="{ item }"
          >
            <!-- 整行点击 = 选中(列表 + 地图同步高亮), 打开视频只由「播放」icon 触发 -->
            <div class="camera-item" :class="itemClasses(item)" @click="onRowClick(item)">
              <div class="item-head">
                <!-- 摄像头类别图标: 普通 / 人工上传 / 车辆 -->
                <span class="name-wrap">
                  <svg class="type-ico" viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
                    <title>{{ typeDef(item).label }}</title>
                    <path :d="typeDef(item).path" :fill="typeDef(item).color" />
                  </svg>
                  <span class="name">{{ item.cameraName }}</span>
                </span>
                <el-tag :type="item.state === 1 ? 'success' : 'info'" size="small">
                  {{ item.state === 1 ? '在线' : '离线' }}
                </el-tag>
              </div>
              <div class="item-foot">
                <span class="addr">{{ item.address || '未知地址' }}</span>
                <!-- 描点 / 播放 图标按钮: 位于状态按钮下方、地址右侧 -->
                <div class="item-actions">
                  <button
                    class="icon-btn plot"
                    :class="{ on: plottedIds.includes(item.id) }"
                    :title="plottedIds.includes(item.id) ? '取消描点' : '在地图描点'"
                    @click.stop="togglePlot(item)"
                  >
                    <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
                      <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5z" fill="currentColor"/>
                    </svg>
                  </button>
                  <button class="icon-btn play" title="播放视频" @click.stop="openCamera(item.id)">
                    <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
                      <path d="M8 5v14l11-7z" fill="currentColor"/>
                    </svg>
                  </button>
                </div>
              </div>
            </div>
          </RecycleScroller>
          <el-empty v-else-if="!cameraStore.loading" description="暂无数据" />
        </div>
      </aside>

      <!-- 右侧地图 -->
      <section class="map-area">
        <CameraMap
          ref="mapComp"
          :positions="cameraStore.positions"
          :site-feed="siteFeed"
          :plotted="plotted"
          :selected="highlightIds"
          @select="onMapSelect"
          @open-video="openCamera"
          @menu-action="onMenuAction"
          @box-select="onBoxSelect"
        />

        <!-- 视频面板(内联展示, 不依赖弹窗) -->
        <div v-if="selected" class="video-panel">
          <div class="panel-head">
            <span class="name">{{ selected.cameraName }}</span>
            <el-tag :type="selected.state === 1 ? 'success' : 'info'" size="small">
              {{ selected.state === 1 ? '在线' : '离线' }}
            </el-tag>
            <span class="addr">{{ selected.address }} ({{ selected.addressNum }})</span>
            <el-button size="mini" type="danger" plain @click="selected = null">关闭</el-button>
          </div>
          <VideoPlayer :camera="selected" />
        </div>
      </section>
    </div>

    <!-- 申请权限弹窗(内联渲染, 不逃逸到 body) -->
    <el-dialog v-model="applyVisible" title="申请修改按钮状态" width="420px" :teleported="false">
      <ApplyDialog v-if="applyVisible" @submitted="applyVisible = false" />
    </el-dialog>

    <!-- 批量平铺播放(全屏, 最多 64 路) -->
    <BatchPlayer
      v-if="batchOpen"
      :items="batchItems"
      :max="MAX_BATCH"
      @close="batchOpen = false"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { RecycleScroller } from 'vue-virtual-scroller';
import 'vue-virtual-scroller/dist/vue-virtual-scroller.css';
import { useCameraStore } from '../store/camera';
import { useButtonStore } from '../store/button';
import { getCameraDetail, updateCameraState, uploadCameraVideo, toAbsoluteUrl } from '../api/camera';
import type { Camera } from '../api/camera';
import type { CleanCamera, SiteFeed } from '../types/camera';
import { cameraTypeOf } from '../utils/cameraType';
import { toast } from '../utils/toast';
import CameraMap from '../components/CameraMap.vue';
import VideoPlayer from '../components/VideoPlayer.vue';
import ApplyDialog from '../components/ApplyDialog.vue';
import BatchPlayer from '../components/BatchPlayer.vue';

const cameraStore = useCameraStore();
const buttonStore = useButtonStore();

// 地图组件实例(用于列表选中/描点后自动飞入定位)
const mapComp = ref<any>(null);
// 虚拟滚动实例(用于地图选点后把列表滚动到对应行)
const scrollerRef = ref<any>(null);

const selected = ref<Camera | null>(null);   // 当前视频面板播放的摄像头
const applyVisible = ref(false);
// 自动刷新开关(每 30s 拉一次增量变更)
const autoRefresh = ref(true);

// 传给地图的站点数据包: list 全量, changed 为本次增量变化的点位, removed 为被清空的点位
// 用 computed 保证三个字段在同一 tick 内变化时只触发一次地图刷新
const siteFeed = computed<SiteFeed>(() => ({
  list: cameraStore.sites,
  changed: cameraStore.changedSites,
  removed: cameraStore.removedSiteKeys,
}));

// 同步状态文案(依赖 lastSyncAt/lastDeltaCount/syncing, 无需额外定时器)
const syncLabel = computed(() => {
  if (!autoRefresh.value) return '自动刷新已暂停';
  if (cameraStore.syncing) return '同步中…';
  if (!cameraStore.lastSyncAt) return '等待同步';
  const t = new Date(cameraStore.lastSyncAt);
  const hh = String(t.getHours()).padStart(2, '0');
  const mm = String(t.getMinutes()).padStart(2, '0');
  const ss = String(t.getSeconds()).padStart(2, '0');
  const time = `${hh}:${mm}:${ss}`;
  return cameraStore.lastDeltaCount ? `${time} 更新 ${cameraStore.lastDeltaCount} 台` : `${time} 已同步`;
});

const syncTip = computed(() =>
  `每 30 秒增量同步一次; 共 ${cameraStore.stats.total} 台摄像头 / ${cameraStore.stats.sites} 个点位, ` +
  `本次剔除脏数据 ${cameraStore.stats.dropped} 条`
);

// 开关切换: 关闭时停止轮询, 打开时立即补一次同步再恢复定时
watch(autoRefresh, (on) => {
  if (on) {
    cameraStore.startPolling();
    cameraStore.pollChanges();
  } else {
    cameraStore.stopPolling();
  }
});
// 点击选中(多选): 点击列表行 / 点击地图点位 / 点击聚合点内的摄像头名称, 每次追加而不是替换
const clickedIds = ref<number[]>([]);

// 已描点的摄像头 id(有序, 用于在地图上画点 + 连线)
const plottedIds = ref<number[]>([]);
// 地图框选的摄像头 id(列表中高亮显示, 同时回传地图高亮)
const boxSelectedIds = ref<number[]>([]);

// 已描点的摄像头对象(按描点顺序)
const plotted = computed(() =>
  cameraStore.positions.filter((c) => plottedIds.value.includes(c.id))
);

// 统一的"选中"集合: 点击选中 + 描点 + 框选, 任一命中即高亮(列表蓝底 + 地图蓝点)
// 多个来源叠加时不会互相覆盖, 命中任意一种就算选中
const selectedIdSet = computed<Set<number>>(() => {
  const s = new Set<number>();
  clickedIds.value.forEach((id) => s.add(id));
  plottedIds.value.forEach((id) => s.add(id));
  boxSelectedIds.value.forEach((id) => s.add(id));
  return s;
});
// 传给地图的选中 id 列表(地图据此把这些点画成蓝色)
const highlightIds = computed(() => Array.from(selectedIdSet.value));
const selectedCount = computed(() => selectedIdSet.value.size);

// ---------------- 批量平铺播放 ----------------
const MAX_BATCH = 64; // 同时播放上限(64 路 = 8×8 平铺)
const batchOpen = ref(false);
const batchItems = ref<{ id: number; name: string }[]>([]);

function openBatch() {
  const list = cameraStore.positions.filter((c) => selectedIdSet.value.has(c.id));
  if (!list.length) {
    toast.warning('请先选择摄像头: 点击列表行、地图描点或框选');
    return;
  }
  if (list.length > MAX_BATCH) {
    toast.warning(`最多同时播放 ${MAX_BATCH} 路, 已取前 ${MAX_BATCH} 路`);
  }
  batchItems.value = list.slice(0, MAX_BATCH).map((c) => ({ id: c.id, name: c.cameraName }));
  batchOpen.value = true;
}

// 多选切换: 已选中(不论来源是点击/描点/框选)则从所有选中集合中移除, 否则追加到点击选中集合
// 返回 true 表示本次操作变为"选中", false 表示"取消选中"
function toggleSelect(id: number): boolean {
  if (selectedIdSet.value.has(id)) {
    clickedIds.value = clickedIds.value.filter((v) => v !== id);
    plottedIds.value = plottedIds.value.filter((v) => v !== id);
    boxSelectedIds.value = boxSelectedIds.value.filter((v) => v !== id);
    return false;
  }
  clickedIds.value = [...clickedIds.value, id];
  return true;
}

// 摄像头类别定义(列表名称前的图标)
function typeDef(item: CleanCamera) {
  return cameraTypeOf(item.type);
}

// 列表项高亮状态: 正在播放 / 选中(多选集合命中即选中)
function itemClasses(item: CleanCamera) {
  return {
    active: selected.value?.id === item.id,
    selected: selectedIdSet.value.has(item.id),
  };
}

// 地图飞入某摄像头
function flyToCamera(item: CleanCamera) {
  const lng = Number(item.longitude);
  const lat = Number(item.latitude);
  if (Number.isFinite(lng) && Number.isFinite(lat)) {
    mapComp.value?.flyTo?.([lng, lat]);
  }
}

// 点击列表行: 多选切换(选中则追加, 再点同一行才取消), 选中时地图飞入定位
function onRowClick(item: CleanCamera) {
  const willSelect = toggleSelect(item.id);
  if (willSelect) flyToCamera(item);
}

// 点击地图点位 / 聚合点列表内某一台: 与左侧对应行同步多选切换
function onMapSelect(id: number) {
  const willSelect = toggleSelect(id);
  if (!willSelect) return;
  const list = cameraStore.filteredPositions;
  const idx = list.findIndex((c) => c.id === id);
  if (idx >= 0) scrollerRef.value?.scrollToItem?.(idx);
  // 若视频面板已打开, 跟随切换到该摄像头(不主动打开视频, 播放由双击/播放按钮触发)
  if (selected.value) openCamera(id);
}

// 地图右键菜单动作
async function onMenuAction(payload: { action: string; camera: Camera }) {
  const { action, camera } = payload;
  if (action === 'test') return testConnection(camera);
  if (action === 'upload') return pickVideoForCamera(camera);
  if (action === 'state') return switchState(camera);
}

// 连接测试: 拉一次详情(计延迟) + 探测视频流可达性
async function testConnection(camera: Camera) {
  const started = performance.now();
  try {
    const detail = await getCameraDetail(camera.id);
    const ms = Math.round(performance.now() - started);
    const streamOk = detail.videoUrl ? await probeUrl(toAbsoluteUrl(detail.videoUrl)) : false;
    const online = Number(detail.state) === 1;
    if (online && streamOk) {
      toast.success(`${camera.cameraName} 连接正常, 延迟 ${ms}ms`);
    } else {
      toast.warning(
        `${camera.cameraName} 连接异常: 状态${online ? '在线' : '离线'}、视频流${streamOk ? '可用' : '不可用'} (${ms}ms)`
      );
    }
  } catch (e: any) {
    toast.error(`${camera.cameraName} 连接失败: ${e?.message || e}`);
  }
}

// 探测视频地址是否可达(no-cors 只判断能否请求成功, 不读内容)
async function probeUrl(url: string): Promise<boolean> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 4000);
  try {
    await fetch(url, { method: 'HEAD', mode: 'no-cors', cache: 'no-store', signal: ctrl.signal });
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

// 修改状态: 在线 <-> 离线
async function switchState(camera: Camera) {
  const next = Number(camera.state) === 1 ? 0 : 1;
  try {
    await updateCameraState(camera.id, next);
    // 交给 Worker 走增量清洗, 点位聚合/统计与轮询完全同一条链路
    await cameraStore.setCameraState(camera.id, next);
    if (selected.value?.id === camera.id) selected.value = { ...selected.value, state: next };
    toast.success(`${camera.cameraName} 已切换为${next === 1 ? '在线' : '离线'}`);
  } catch (e: any) {
    toast.error(`状态修改失败: ${e?.message || e}`);
  }
}

// 上传视频到该摄像头(替换视频源, 服务端会置为在线)
function pickVideoForCamera(camera: Camera) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'video/*';
  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file) return;
    const loading = toast.loading(`正在上传 ${file.name} ...`);
    try {
      const res = await uploadCameraVideo(camera.id, file);
      await cameraStore.setCameraState(camera.id, 1);
      if (selected.value?.id === camera.id) {
        selected.value = { ...selected.value, videoUrl: res.videoUrl, state: 1 };
      }
      toast.success('上传成功, 摄像头已置为在线');
    } catch (e: any) {
      toast.error(`上传失败: ${e?.message || e}`);
    } finally {
      loading.close();
    }
  };
  input.click();
}

// 描点: 在地图打点并高亮, 可多次描点画线; 描点后地图自动飞入该摄像头
function togglePlot(item: CleanCamera) {
  const i = plottedIds.value.indexOf(item.id);
  if (i >= 0) {
    plottedIds.value.splice(i, 1);
    return;
  }
  plottedIds.value.push(item.id);
  flyToCamera(item);
}

// 地图框选回调: 更新列表/地图中高亮的摄像头(框选即为选中态)
function onBoxSelect(ids: number[]) {
  boxSelectedIds.value = ids;
}

// 打开摄像头(点击列表/描点或播放按钮): 拉取详情并展示视频
async function openCamera(id: number) {
  if (!buttonStore.can('viewVideo')) {
    toast.warning('查看视频功能已被禁用, 请在角色菜单申请开启');
    return;
  }
  selected.value = await getCameraDetail(id);
}

// 数据每次落库后, 把正在播放的视频面板状态同步为最新(避免面板显示旧状态)
watch(() => cameraStore.revision, () => {
  const cur = selected.value;
  if (!cur) return;
  const fresh = cameraStore.getById(cur.id);
  if (fresh && fresh.state !== cur.state) selected.value = { ...cur, state: fresh.state };
});

onMounted(async () => {
  cameraStore.bindActiveTab(); // 监听主应用切换标签, 变为激活时重新全量拉取并恢复轮询
  await cameraStore.loadPositions(); // 全量加载 -> Worker 清洗/聚合(同时播种, 后续可增量)
  cameraStore.startPolling(); // 首次全量完成后启动 30s 增量轮询
  buttonStore.init(); // 初始化按钮权限(不阻塞渲染)
});

// 组件销毁: 停轮询 + 中止在途请求 + 终止 Worker, 避免定时器/请求/Worker 残留引用
onBeforeUnmount(() => {
  cameraStore.dispose();
});
</script>

<style scoped lang="less">
.monitor-view {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  overflow: hidden;
}

.monitor-header {
  height: 48px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 16px;
  background: #fff;
  border-bottom: 1px solid #e8e8e8;

  .title { font-weight: 600; }
  .header-right { display: flex; align-items: center; gap: 12px; }
  .count { color: #666; font-size: 13px; }

  // 同步状态徽标: 绿=已同步 / 蓝=同步中 / 灰=已暂停
  .sync-state {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 2px 8px;
    border-radius: 10px;
    background: #f6ffed;
    border: 1px solid #b7eb8f;
    color: #389e0d;
    font-size: 12px;
    font-variant-numeric: tabular-nums;
    transition: all 0.2s;

    .dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: currentColor;
    }

    &.busy {
      background: #e6f4ff;
      border-color: #91caff;
      color: #1677ff;
      .dot { animation: sync-pulse 1s ease-in-out infinite; }
    }

    &.paused {
      background: #f5f5f5;
      border-color: #e0e0e0;
      color: #909399;
    }
  }

  .auto-refresh {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    color: #666;
    font-size: 12px;
    cursor: pointer;
    user-select: none;
  }
}

@keyframes sync-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.2; }
}

.monitor-body {
  flex: 1;
  min-height: 0;
  display: flex;
  gap: 12px;
  padding: 12px;
  overflow: hidden;
}

.camera-list {
  width: 340px;
  flex-shrink: 0;
  background: #fff;
  border-radius: 6px;
  padding: 12px;
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;

  .list-body {
    flex: 1;
    min-height: 0;
    margin-top: 12px;
    position: relative;
    overflow: hidden;
  }

  // 搜索行: 输入框收窄, 右侧是「播放选中」
  .list-toolbar {
    display: flex;
    align-items: center;
    gap: 8px;

    .search {
      width: 168px;
      flex: 0 0 168px;
    }

    .batch-play {
      flex: 1;
      min-width: 0;
      height: 32px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 5px;
      padding: 0 8px;
      font-size: 12px;
      color: #fff;
      background: #409eff;
      border: 1px solid #409eff;
      border-radius: 4px;
      cursor: pointer;
      transition: all 0.15s;
      white-space: nowrap;

      &:hover { background: #66b1ff; border-color: #66b1ff; }

      em {
        font-style: normal;
        font-size: 11px;
        line-height: 16px;
        min-width: 16px;
        padding: 0 3px;
        border-radius: 8px;
        background: rgba(255, 255, 255, 0.25);
        font-variant-numeric: tabular-nums;
      }

      // 没有选中时弱化, 但仍可点击(点击后给出提示)
      &.empty {
        color: #a8abb2;
        background: #f5f7fa;
        border-color: #dcdfe6;
        &:hover { color: #409eff; border-color: #409eff; background: #ecf5ff; }
      }
    }
  }

  .camera-scroller {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
  }

  .camera-item {
    // 与 item-size(68) 严格一致, 保证虚拟滚动定位准确
    height: 68px;
    box-sizing: border-box;
    padding: 8px 12px;
    cursor: pointer; // 整行点击 = 选中(不弹视频, 视频只由播放 icon 触发)
    border-bottom: 1px solid #f0f0f0;

    &:hover { background: #f5f7fa; }
    // 正在播放视频
    &.active { background: #dbe9ff; }
    // 选中态(描点 / 框选): 统一蓝色高亮, 与地图选中点位一致
    &.selected { background: #ecf5ff; box-shadow: inset 3px 0 0 #409eff; }

    .item-head { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
    // 类别图标 + 名称
    .name-wrap {
      display: flex;
      align-items: center;
      gap: 5px;
      min-width: 0;
      .type-ico { flex-shrink: 0; display: block; }
    }
    .name { font-size: 14px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

    .item-foot {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-top: 4px;
    }
    .addr { color: #999; font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; margin-right: 8px; }

    .item-actions { display: flex; align-items: center; gap: 6px; flex-shrink: 0; }

    .icon-btn {
      width: 24px;
      height: 24px;
      display: flex;
      align-items: center;
      justify-content: center;
      border: 1px solid #dcdfe6;
      border-radius: 4px;
      background: #fff;
      color: #909399;
      cursor: pointer;
      padding: 0;
      transition: all 0.15s;

      &:hover { color: #409eff; border-color: #409eff; }
      &.play:hover { color: #67c23a; border-color: #67c23a; }
      // 描点按钮选中态: 蓝色(与地图描点一致)
      &.plot.on { color: #fff; background: #409eff; border-color: #409eff; }
    }
  }
}

.map-area {
  flex: 1;
  min-height: 0;
  position: relative;
  border-radius: 6px;
  overflow: hidden;
}

.video-panel {
  position: absolute;
  left: 12px;
  right: 12px;
  bottom: 12px;
  /* 视频面板是"浮在地图之上的弹层", 必须高于地图内部的所有控件层
     (框选工具栏 / 悬停提示 / 右键菜单 / 高德 logo) */
  z-index: 5;
  background: #fff;
  border-radius: 6px;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.15);
  padding: 12px;

  .panel-head {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 8px;
    .name { font-weight: 600; }
    .addr { color: #999; font-size: 12px; flex: 1; }
  }
}
</style>
