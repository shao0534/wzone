<template>
  <div class="stream-tile" :class="[`is-${state}`, { 'is-live': info.mode === 'live' }]">
    <!-- 视频元素常驻, 由 MediaPlayer 控制拉流; destroy 时会摘掉 src 释放解码器 -->
    <video ref="videoEl" class="video" muted playsinline preload="none" />

    <!-- 状态遮罩: 加载中 / 等待 / 暂停 / 失败 -->
    <div v-if="state !== 'playing'" class="mask">
      <div class="mask-inner">
        <template v-if="state === 'loading'">
          <span class="spinner"></span>
          <span class="txt">{{ loadingText }}</span>
        </template>
        <template v-else-if="state === 'error'">
          <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
            <path d="M12 2 1 21h22L12 2zm1 14h-2v2h2v-2zm0-7h-2v5h2V9z" fill="currentColor" />
          </svg>
          <span class="txt">{{ errorText }}</span>
          <button class="retry" @click.stop="$emit('retry')">重试</button>
        </template>
        <template v-else-if="state === 'paused'">
          <button class="big-play" title="播放" @click.stop="play">
            <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true">
              <path d="M8 5v14l11-7z" fill="currentColor" />
            </svg>
          </button>
          <span class="txt">已暂停</span>
        </template>
        <template v-else>
          <span class="txt">{{ loadingText }}</span>
        </template>
      </div>
    </div>

    <!-- 顶部信息条: 名称 / 类型 / 编码 -->
    <div class="bar top">
      <span v-if="info.mode === 'live'" class="live-dot" :class="{ on: state === 'playing' }"></span>
      <span class="name" :title="displayName">{{ displayName }}</span>
      <span class="tag">{{ info.mode === 'live' ? '实时' : '回放' }}</span>
      <span class="tag codec" :class="{ h265: isH265 }">{{ codecLabel }}</span>
      <button class="icon close" title="关闭" @click.stop="$emit('close')">
        <svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true">
          <path d="M19 6.4 17.6 5 12 10.6 6.4 5 5 6.4 10.6 12 5 17.6 6.4 19 12 13.4 17.6 19 19 17.6 13.4 12z" fill="currentColor" />
        </svg>
      </button>
    </div>

    <!-- 底部状态: 实时流显示同步位置/漂移 -->
    <div v-if="info.mode === 'live' && state === 'playing'" class="bar bottom">
      <span class="sync" :class="{ warn: !inSync }">
        <i class="dot"></i>{{ inSync ? '同步播放' : '校准中' }} · {{ positionLabel }}
      </span>
      <span v-if="showProbe && probeMs != null" class="probe">测速 {{ probeMs }}ms</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { PlayInfo } from '../api/stream';
import { MediaPlayer } from '../utils/mediaPlayer';

// 注意: armed 是布尔 prop, 不传时 Vue 会按 boolean casting 置为 false,
// 这里必须显式给默认值 true, 否则单路播放会一直停在"加载中"
const props = withDefaults(
  defineProps<{
    info: PlayInfo;
    name?: string;
    /** 是否允许开始拉流(批量播放时按波次放行, 避免 64 路同时抢占带宽) */
    armed?: boolean;
    showProbe?: boolean;
  }>(),
  { armed: true, showProbe: false, name: '' }
);

defineEmits<{
  (e: 'retry'): void;
  (e: 'close'): void;
}>();

const videoEl = ref<HTMLVideoElement | null>(null);
const state = ref<'loading' | 'playing' | 'paused' | 'error'>('loading');
const errorText = ref('');
const loadingText = ref('拉流中…');
const positionMs = ref(0);
const inSync = ref(true);

let player: MediaPlayer | null = null;

const displayName = computed(() => props.name || props.info.cameraName || `#${props.info.id}`);
const isH265 = computed(() => (props.info.codec || '').toLowerCase() === 'hevc');
const codecLabel = computed(() => {
  const c = props.info.playCodec || props.info.codec;
  if (c === 'hevc') return 'H265';
  if (c === 'h264') return props.info.transcoded ? 'H264(转码)' : 'H264';
  if (c === 'av1') return 'AV1';
  return '未知编码';
});
const probeMs = computed(() => props.info.probeMs);

function fmt(ms: number) {
  const s = Math.max(0, ms) / 1000;
  const mm = String(Math.floor(s / 60)).padStart(2, '0');
  const ss = String(Math.floor(s % 60)).padStart(2, '0');
  const mmm = String(Math.floor(ms % 1000)).padStart(3, '0');
  return `${mm}:${ss}.${mmm}`;
}
const positionLabel = computed(() => fmt(positionMs.value));

function startPlayer() {
  if (player || !videoEl.value) return;
  if (props.info.status !== 'ready' || !props.info.url) {
    state.value = 'error';
    errorText.value = props.info.error || props.info.message || '无法取流';
    return;
  }
  loadingText.value = props.info.transcoded ? 'H265 转码中…' : '拉流中…';
  player = new MediaPlayer(videoEl.value, props.info, (s) => {
    if (s.state === 'loading') {
      state.value = 'loading';
      if (s.fallback) loadingText.value = '编码不兼容, 切换转码流…';
    } else if (s.state === 'playing') {
      state.value = 'playing';
      positionMs.value = s.positionMs || 0;
      inSync.value = s.inSync !== false;
    } else if (s.state === 'paused') {
      state.value = 'paused';
    } else {
      state.value = 'error';
      errorText.value = s.error || '播放失败';
    }
  });
  player.start();
  inSync.value = true;
}

function play() {
  if (!player) {
    startPlayer();
    return;
  }
  player.resume();
}

// 供批量播放器统一控制(页面切后台时暂停所有解码, 回来重新对齐)
function pause() {
  player?.pause();
}
function resume() {
  player?.resume();
}
function resync() {
  player?.resync();
}
defineExpose({ pause, resume, resync });

// 放行后(批量波次/单路)才开始拉流
// 注意: immediate 的 watcher 在 setup 阶段触发, 此时 videoEl 还没挂载,
// 必须等 onMounted 再兜一次, 否则"重挂载时 armed 已为 true"的格子会永远停在加载中
watch(
  () => props.armed,
  (ok) => {
    if (ok !== false) startPlayer();
  },
  { immediate: true }
);
onMounted(() => {
  if (props.armed !== false) startPlayer();
});

onBeforeUnmount(() => {
  player?.destroy();
  player = null;
});
</script>

<style scoped lang="less">
.stream-tile {
  position: relative;
  width: 100%;
  height: 100%;
  background: #0b0f14;
  border: 1px solid #1f2733;
  border-radius: 2px;
  overflow: hidden;

  .video {
    width: 100%;
    height: 100%;
    object-fit: contain;
    display: block;
    background: #000;
  }

  .mask {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(8, 12, 18, 0.82);
    z-index: 2;
  }
  .mask-inner {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    color: #9aa7b5;
    font-size: 12px;
    padding: 0 10px;
    text-align: center;
  }
  .txt { line-height: 1.5; word-break: break-all; }
  .spinner {
    width: 20px;
    height: 20px;
    border-radius: 50%;
    border: 2px solid rgba(255, 255, 255, 0.18);
    border-top-color: #409eff;
    animation: spin 0.8s linear infinite;
  }
  .retry {
    margin-top: 2px;
    padding: 2px 10px;
    font-size: 12px;
    color: #409eff;
    background: transparent;
    border: 1px solid #409eff;
    border-radius: 3px;
    cursor: pointer;
    &:hover { background: rgba(64, 158, 255, 0.12); }
  }
  .big-play {
    width: 44px;
    height: 44px;
    border-radius: 50%;
    border: 1px solid rgba(255, 255, 255, 0.35);
    background: rgba(255, 255, 255, 0.08);
    color: #fff;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    &:hover { background: rgba(64, 158, 255, 0.28); }
  }

  .bar {
    position: absolute;
    left: 0;
    right: 0;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 3px 6px;
    color: #dbe6f0;
    font-size: 11px;
    background: linear-gradient(180deg, rgba(0, 0, 0, 0.72), rgba(0, 0, 0, 0));
    pointer-events: none;
    z-index: 3;
  }
  .bar.top { top: 0; }
  .bar.bottom {
    bottom: 0;
    background: linear-gradient(0deg, rgba(0, 0, 0, 0.75), rgba(0, 0, 0, 0));
    justify-content: space-between;
  }

  .name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-weight: 500;
  }
  .tag {
    flex-shrink: 0;
    padding: 0 4px;
    border-radius: 2px;
    background: rgba(64, 158, 255, 0.22);
    border: 1px solid rgba(64, 158, 255, 0.5);
    color: #9fd0ff;
    font-size: 10px;
    line-height: 15px;
    &.codec { background: rgba(255, 255, 255, 0.1); border-color: rgba(255, 255, 255, 0.25); color: #cfd8e3; }
    &.codec.h265 { background: rgba(230, 162, 60, 0.2); border-color: rgba(230, 162, 60, 0.55); color: #ffcf85; }
  }

  .live-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: #6b7684;
    flex-shrink: 0;
    &.on { background: #f56c6c; box-shadow: 0 0 0 2px rgba(245, 108, 108, 0.25); }
  }

  .icon.close {
    pointer-events: auto;
    width: 16px;
    height: 16px;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    border: none;
    background: rgba(0, 0, 0, 0.35);
    color: #cfd8e3;
    border-radius: 2px;
    cursor: pointer;
    flex-shrink: 0;
    &:hover { background: #f56c6c; color: #fff; }
  }

  .sync {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    color: #8fd48f;
    font-variant-numeric: tabular-nums;
    .dot { width: 5px; height: 5px; border-radius: 50%; background: currentColor; }
    &.warn { color: #ffcf85; }
  }
  .probe { color: #8b98a6; font-variant-numeric: tabular-nums; }

  &.is-error { border-color: rgba(245, 108, 108, 0.45); }
}

@keyframes spin { to { transform: rotate(360deg); } }
</style>
