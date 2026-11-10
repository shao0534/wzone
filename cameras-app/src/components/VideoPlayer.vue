<template>
  <div class="video-player">
    <!-- 实时流: 先做网络测试, 通过才取流; 点播: 直接取流 -->
    <div v-if="phase !== 'playing'" class="hint-state">
      <template v-if="phase === 'probing'">
        <span class="spinner"></span>
        <span>网络测试中{{ latencyMs != null ? ` · ${latencyMs}ms` : '…' }}</span>
      </template>
      <template v-else-if="phase === 'error'">
        <span class="err">{{ errorText }}</span>
        <el-button size="small" type="primary" plain @click="start">重试</el-button>
      </template>
      <template v-else>
        <span class="spinner"></span>
        <span>{{ loadingText }}</span>
      </template>
    </div>

    <StreamTile
      v-if="info && phase === 'playing'"
      :info="info"
      :name="camera.cameraName"
      :show-probe="true"
      @retry="start"
    />

    <!-- 流信息: 类型 / 编码 / 网络测试耗时 -->
    <div class="stream-meta">
      <span class="tag" :class="mode === 'live' ? 'live' : 'vod'">
        {{ mode === 'live' ? '实时流' : '点播回放' }}
      </span>
      <span v-if="probe" class="tag">{{ probe.codec === 'hevc' ? 'H265' : probe.codec === 'h264' ? 'H264' : '编码未知' }}</span>
      <span v-if="probe" class="tag muted">网络测试 {{ probe.latencyMs }}ms</span>
      <span v-if="info?.transcoded" class="tag warn">H265 已转码</span>
      <span v-if="info?.mode === 'live'" class="tag muted">循环同步播放</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue';
import type { Camera } from '../api/camera';
import type { PlayInfo, StreamProbe } from '../api/stream';
import { getPlayInfo, probeStream } from '../api/stream';
import { supportsHevc } from '../utils/mediaPlayer';
import StreamTile from './StreamTile.vue';

const props = defineProps<{ camera: Camera }>();

const phase = ref<'idle' | 'probing' | 'loading' | 'playing' | 'error'>('idle');
const info = ref<PlayInfo | null>(null);
const probe = ref<StreamProbe | null>(null);
const latencyMs = ref<number | null>(null);
const errorText = ref('');
const loadingText = ref('取流中…');

const mode = ref<'live' | 'vod'>('live');
const hevc = supportsHevc();

let ctrl: AbortController | null = null;
let retryTimer: number | null = null;
let retried = 0;
let disposed = false;

function clearTimers() {
  if (retryTimer !== null) {
    window.clearTimeout(retryTimer);
    retryTimer = null;
  }
}

/**
 * 播放流程(实时流强制先测网络):
 *   网络测试 -> 取流 -> 渲染
 * 转码中的 H265 会自动重试, 最多 3 次
 */
async function start() {
  if (disposed) return;
  ctrl?.abort();
  ctrl = new AbortController();
  clearTimers();
  retried = 0;
  info.value = null;
  probe.value = null;
  latencyMs.value = null;
  errorText.value = '';

  const type = Number(props.camera.type);
  // 先用摄像头类型兜底, 真正的播放方式以服务端返回的 mode 为准
  // (服务端可用 STREAM_PLAY_MODE 把全部摄像头切成"上传视频点播"方式)
  mode.value = type === 2 ? 'vod' : 'live';
  phase.value = 'probing';
  loadingText.value = '取流中…';

  try {
    const p = await probeStream(props.camera.id, ctrl.signal);
    if (disposed) return;
    probe.value = p;
    latencyMs.value = p.latencyMs;
    if (p.mode) mode.value = p.mode;
    if (!p.ok) {
      // 实时流离线 / 源不可达: 不取流, 直接提示
      phase.value = 'error';
      errorText.value = `网络测试未通过: ${p.reason || '视频源不可达'}`;
      return;
    }
    await fetchPlay();
  } catch (e: any) {
    if (disposed || e?.name === 'AbortError' || e?.code === 'ERR_CANCELED') return;
    phase.value = 'error';
    errorText.value = `网络测试失败: ${e?.message || e}`;
  }
}

async function fetchPlay() {
  phase.value = 'loading';
  loadingText.value = mode.value === 'live' ? '取流中…' : '加载视频…';
  const res = await getPlayInfo(props.camera.id, hevc, ctrl?.signal);
  if (disposed) return;

  if (res.status === 'preparing' && retried < 3) {
    retried += 1;
    loadingText.value = res.message || 'H265 转码中…';
    retryTimer = window.setTimeout(() => { if (!disposed) fetchPlay().catch(handleError); }, res.retryAfterMs || 900);
    return;
  }
  if (res.status !== 'ready') {
    phase.value = 'error';
    errorText.value = res.error || res.message || '取流失败';
    return;
  }
  info.value = res;
  phase.value = 'playing';
}

function handleError(e: any) {
  if (disposed) return;
  phase.value = 'error';
  errorText.value = `取流失败: ${e?.message || e}`;
}

onBeforeUnmount(() => {
  disposed = true;
  clearTimers();
  ctrl?.abort();
});

// 切换摄像头: 中止旧请求并重新走一遍测试+取流
watch(
  () => props.camera.id,
  () => start(),
  { immediate: true }
);
</script>

<style scoped lang="less">
.video-player {
  width: 100%;
  height: 100%;
  min-height: 220px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  position: relative;

  // 单路播放容器: 固定最小高度, 与平铺格观感一致
  > :deep(.stream-tile) {
    flex: 1;
    min-height: 200px;
    border-radius: 4px;
  }

  .hint-state {
    flex: 1;
    min-height: 200px;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
    background: #0b0f14;
    border-radius: 4px;
    color: #9aa7b5;
    font-size: 13px;
    .err { color: #f56c6c; }
    .spinner {
      width: 16px;
      height: 16px;
      border-radius: 50%;
      border: 2px solid rgba(255, 255, 255, 0.18);
      border-top-color: #409eff;
      animation: spin 0.8s linear infinite;
    }
  }

  .stream-meta {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
    .tag {
      font-size: 11px;
      line-height: 17px;
      padding: 0 6px;
      border-radius: 2px;
      background: #f4f4f5;
      color: #909399;
      &.live { background: #fef0f0; color: #f56c6c; }
      &.vod { background: #e6f4ff; color: #1677ff; }
      &.warn { background: #fdf6ec; color: #e6a23c; }
      &.muted { background: transparent; border: 1px solid #e4e7ed; }
    }
  }
}

@keyframes spin { to { transform: rotate(360deg); } }
</style>
