<template>
  <div ref="rootEl" class="batch-player" @keydown.esc="onEsc">
    <!-- 顶部工具栏 -->
    <div class="bar-head">
      <span class="title">批量播放</span>
      <span class="stat">
        <i class="ok"></i>{{ readyCount }}/{{ tiles.length }} 路在线
        <template v-if="failCount"> · <i class="bad"></i>{{ failCount }} 路异常</template>
        <template v-if="preparingCount"> · {{ preparingCount }} 路转码中</template>
      </span>
      <span class="hint">{{ cols }}×{{ rows }} 平铺 · 上限 {{ max }} 路 · ESC 退出</span>
      <div class="ops">
        <span class="codec-tip" :title="hevc ? '浏览器支持 H265, H265 源直连' : '浏览器不支持 H265, 由服务端转码为 H264'">
          H265: {{ hevc ? '直连' : '转码' }}
        </span>
        <button class="op" @click="retryAll">全部重试</button>
        <button class="op danger" @click="close">退出</button>
      </div>
    </div>

    <!-- 平铺网格 -->
    <div
      class="grid"
      :style="{ gridTemplateColumns: `repeat(${cols}, 1fr)`, gridTemplateRows: `repeat(${rows}, 1fr)` }"
    >
      <StreamTile
        v-for="item in tiles"
        :key="`${item.id}-${keys[item.id] || 0}`"
        ref="tileRefs"
        :info="infos[item.id] || placeholder(item)"
        :name="item.name"
        :armed="armedIds.includes(item.id)"
        :show-probe="true"
        @retry="retryOne(item.id)"
        @close="removeTile(item.id)"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue';
import StreamTile from './StreamTile.vue';
import { currentStreamMode, getPlayInfo, getStreamBatch } from '../api/stream';
import type { PlayInfo } from '../api/stream';
import { supportsHevc } from '../utils/mediaPlayer';
import { toast } from '../utils/toast';

interface Item {
  id: number;
  name: string;
}

const props = withDefaults(defineProps<{ items: Item[]; max?: number }>(), { max: 64 });
const emit = defineEmits<{ (e: 'close'): void }>();

const rootEl = ref<HTMLElement | null>(null);
const tileRefs = ref<any[]>([]);

const max = computed(() => props.max);
const tiles = ref<Item[]>(props.items.slice(0, max.value));
const infos = reactive<Record<number, PlayInfo>>({});
const keys = reactive<Record<number, number>>({});     // 变化即强制重建该格
const armedIds = ref<number[]>([]);                    // 已放行拉流的 id(分波放行)
const hevc = supportsHevc();

let armTimer: number | null = null;
let clone: AbortController | null = null;              // 批量请求的中止句柄
let disposed = false;
const retryCount = reactive<Record<number, number>>({});

// ---------------- 网格 ----------------
const n = computed(() => Math.max(1, tiles.value.length));
const cols = computed(() => Math.max(1, Math.ceil(Math.sqrt(n.value))));
const rows = computed(() => Math.max(1, Math.ceil(n.value / cols.value)));

const readyCount = computed(() => tiles.value.filter((t) => infos[t.id]?.status === 'ready').length);
const failCount = computed(() => tiles.value.filter((t) => infos[t.id]?.status === 'error').length);
const preparingCount = computed(() => tiles.value.filter((t) => infos[t.id]?.status === 'preparing').length);

/** 占位描述: 还没拿到结果时先展示"排队中" */
function placeholder(item: Item): PlayInfo {
  // 播放方式跟随服务端开关(默认全部点播), 只影响排队时的类型标签
  return { id: item.id, cameraName: item.name, mode: currentStreamMode(), status: 'preparing', message: '排队中…' };
}

// ---------------- 取流 ----------------

async function loadAll() {
  clone?.abort();
  clone = new AbortController();
  const ids = tiles.value.map((t) => t.id);
  try {
    const res = await getStreamBatch(ids, hevc, clone.signal);
    if (disposed) return;
    for (const info of res.list) {
      infos[info.id] = info;
      // 转码未就绪: 稍后自动重试(服务端此时还在转码)
      if (info.status === 'preparing') schedulePreparingRetry(info.id);
    }
    armWaves();
  } catch (e: any) {
    if (disposed || e?.name === 'AbortError' || e?.code === 'ERR_CANCELED') return;
    toast.error(`取流失败: ${e?.message || e}`);
  }
}

function schedulePreparingRetry(id: number, delay = 900) {
  const times = retryCount[id] || 0;
  if (times >= 3) return;
  retryCount[id] = times + 1;
  window.setTimeout(() => {
    if (!disposed) retryOne(id, true);
  }, delay);
}

/** 单路重新取流(失败重试 / 转码等待) */
async function retryOne(id: number, silent = false) {
  try {
    const info = await getPlayInfo(id, hevc);
    if (disposed) return;
    infos[id] = info;
    keys[id] = (keys[id] || 0) + 1; // 强制重建该格, 重新走一遍拉流
    if (info.status === 'ready' && !armedIds.value.includes(id)) armedIds.value = [...armedIds.value, id];
    if (info.status === 'preparing') schedulePreparingRetry(id);
    if (!silent && info.status === 'error') toast.error(`${info.cameraName || id}: ${info.error}`);
  } catch (e: any) {
    if (!disposed && !silent) toast.error(`重试失败: ${e?.message || e}`);
  }
}

function retryAll() {
  for (const t of tiles.value) {
    if (infos[t.id]?.status !== 'ready') retryOne(t.id, true);
  }
}

/**
 * 分波放行: 64 路同时发媒体请求会把带宽和连接数打满,
 * 每波 8 路、间隔 250ms, 兼顾首屏速度与稳定性
 */
function armWaves() {
  if (armTimer !== null) window.clearTimeout(armTimer);
  // 全部分波放行(含失败格): 失败格也要放行, 否则它会一直停在"加载中"看不到失败原因
  const all = tiles.value.map((t) => t.id);
  let cursor = 0;
  const step = () => {
    if (disposed) return;
    const wave = all.slice(cursor, cursor + 8);
    if (wave.length) armedIds.value = [...armedIds.value, ...wave.filter((id) => !armedIds.value.includes(id))];
    cursor += 8;
    if (cursor < all.length) armTimer = window.setTimeout(step, 250);
  };
  step();
}

function removeTile(id: number) {
  tiles.value = tiles.value.filter((t) => t.id !== id);
  delete infos[id];
  armedIds.value = armedIds.value.filter((v) => v !== id);
}

// ---------------- 全屏与生命周期 ----------------

let closing = false;

async function enterFullscreen() {
  const el = rootEl.value as any;
  if (!el) return;
  try {
    if (el.requestFullscreen) await el.requestFullscreen({ navigationUI: 'hide' });
    else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();
  } catch {
    // 被浏览器拒绝时保持 fixed 全屏覆盖(样式已经铺满视口), 不影响使用
  }
}

function exitFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
}

function onFullscreenChange() {
  // 用户按 ESC 退出全屏: 直接关闭浮层
  if (!document.fullscreenElement && !closing) close();
}

function onEsc() {
  if (document.fullscreenElement) exitFullscreen();
  else close();
}

function close() {
  if (closing) return;
  closing = true;
  exitFullscreen();
  emit('close');
}

function onVisibility() {
  // 页面不可见时暂停所有解码, 回来后重新对齐实时位置, 显著降低后台 CPU/内存
  const refs = (tileRefs.value || []) as any[];
  if (document.hidden) refs.forEach((r) => r?.pause?.());
  else refs.forEach((r) => { r?.resume?.(); r?.resync?.(); });
}

onMounted(() => {
  enterFullscreen();
  document.addEventListener('fullscreenchange', onFullscreenChange);
  document.addEventListener('visibilitychange', onVisibility);
  loadAll();
});

onBeforeUnmount(() => {
  disposed = true;
  if (armTimer !== null) window.clearTimeout(armTimer);
  clone?.abort(); // 中止在途的批量请求
  document.removeEventListener('fullscreenchange', onFullscreenChange);
  document.removeEventListener('visibilitychange', onVisibility);
  // 各格的 MediaPlayer 在 StreamTile 卸载时 destroy(摘 src/停定时器/销毁 hls)
});
</script>

<style scoped lang="less">
.batch-player {
  position: fixed;
  inset: 0;
  z-index: 3000;
  background: #05080c;
  display: flex;
  flex-direction: column;
  outline: none;

  .bar-head {
    height: 42px;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 0 14px;
    background: #0d1319;
    border-bottom: 1px solid #1b232d;
    color: #dbe6f0;
    font-size: 13px;

    .title { font-weight: 600; letter-spacing: 0.5px; }
    .stat { display: inline-flex; align-items: center; gap: 5px; color: #9fb0c0; font-size: 12px; }
    .ok, .bad { width: 6px; height: 6px; border-radius: 50%; display: inline-block; }
    .ok { background: #52c41a; }
    .bad { background: #f56c6c; }
    .hint { color: #6b7a8a; font-size: 12px; }
    .ops { margin-left: auto; display: flex; align-items: center; gap: 8px; }
    .codec-tip {
      font-size: 11px;
      color: #9fd0ff;
      border: 1px solid rgba(64, 158, 255, 0.4);
      background: rgba(64, 158, 255, 0.12);
      border-radius: 2px;
      padding: 1px 6px;
      cursor: default;
    }
    .op {
      height: 26px;
      padding: 0 12px;
      font-size: 12px;
      color: #cfd8e3;
      background: #16202a;
      border: 1px solid #253243;
      border-radius: 3px;
      cursor: pointer;
      &:hover { border-color: #409eff; color: #fff; }
      &.danger:hover { border-color: #f56c6c; background: rgba(245, 108, 108, 0.18); }
    }
  }

  .grid {
    flex: 1;
    min-height: 0;
    display: grid;
    gap: 2px;
    padding: 2px;
    // 行高由 grid 均分, 子项撑满
    > * { min-width: 0; min-height: 0; }
  }
}
</style>
