// 播放内核
// - 统一处理 MP4(原生) / HLS(hls.js) / H265(支持则直连, 否则走服务端转码后的 H264)
// - 实时流按服务端时间轴定位, 并周期性校正漂移, 实现多路/多端"同步播放"
// - destroy() 会把 video 从解码链路彻底摘除, 避免退出批量播放后仍有解码器/网络请求残留
import Hls from 'hls.js';
import type { PlayInfo } from '../api/stream';

export type PlayerState = 'loading' | 'playing' | 'paused' | 'error';

export interface PlayerStatus {
  state: PlayerState;
  /** 实际生效的编码 */
  codec?: string;
  /** 是否走了转码回退 */
  fallback?: boolean;
  error?: string;
  /** 当前流位置(ms), 仅实时流 */
  positionMs?: number;
  /** 是否处于同步容差内(实时流) */
  inSync?: boolean;
}

/** 浏览器是否支持 HEVC(H265): MSE 或 WebCodecs 任一支持即可 */
let hevcSupported: boolean | null = null;
export function supportsHevc(): boolean {
  if (hevcSupported !== null) return hevcSupported;
  hevcSupported = false;
  try {
    const MSE = 'MediaSource' in window ? (window as any).MediaSource : null;
    const candidates = [
      'video/mp4; codecs="hvc1.1.6.L93.B0"',
      'video/mp4; codecs="hev1.1.6.L93.B0"',
    ];
    if (MSE && typeof MSE.isTypeSupported === 'function') {
      hevcSupported = candidates.some((t) => MSE.isTypeSupported(t));
    }
    // Chrome 桌面版: <video> 自身可能支持 HEVC(依赖系统解码器)
    if (!hevcSupported) {
      const v = document.createElement('video');
      hevcSupported = candidates.some((t) => !!v.canPlayType(t));
    }
  } catch {
    hevcSupported = false;
  }
  return hevcSupported;
}

const isHlsUrl = (url: string) => /\.m3u8($|\?)/i.test(url);

export class MediaPlayer {
  private video: HTMLVideoElement;
  private info: PlayInfo;
  private onStatus?: (s: PlayerStatus) => void;

  private hls: Hls | null = null;
  private syncTimer: number | null = null;
  private destroyed = false;
  private attached = false;

  // 同步基准: 在 baseAt(本地时钟) 时, 流应该处于 basePosition
  private basePosition = 0;
  private baseAt = 0;
  private lastLabelAt = 0;
  private durationMs = 0;
  private toleranceMs = 600;
  private fallbackTried = false;

  constructor(video: HTMLVideoElement, info: PlayInfo, onStatus?: (s: PlayerStatus) => void) {
    this.video = video;
    this.info = info;
    this.onStatus = onStatus;

    const live = info.live;
    this.durationMs = (live?.durationMs || info.durationMs || 30_000) | 0;
    this.toleranceMs = live?.toleranceMs || 600;
    // 同步基准: 用"本地时钟增量"推算, 不依赖两端时钟一致
    // positionMs 是服务端算出的实时位置; 再叠加"响应到真正开始播放"的间隔
    // (批量播放分波放行时可能滞后 1~2s, 不补偿的话各格会错开)
    const lag = info.receivedAt ? Math.min(5000, Math.max(0, Date.now() - info.receivedAt)) : 0;
    this.basePosition = ((live?.positionMs || 0) + lag) % (this.durationMs || 30_000);
    this.baseAt = Date.now();
  }

  emit(state: PlayerState, extra: Omit<PlayerStatus, 'state'> = {}) {
    this.onStatus?.({ state, ...extra });
  }

  /** 开始拉流并播放 */
  start() {
    if (this.destroyed) return;
    const url = this.info.url;
    if (!url) {
      this.emit('error', { error: this.info.error || '缺少播放地址' });
      return;
    }
    this.emit('loading');
    this.bindVideoEvents();

    const v = this.video;
    v.muted = true;               // 静音才能自动播放(浏览器策略)
    v.playsInline = true;
    v.preload = 'auto';
    // 实时流靠"时间轴取模"循环; 点播则由服务端下发的 vod.loop 决定是否本地循环
    // (本地循环不发任何请求, 也不会 seek, 是开销最小的"一直有画面"做法)
    v.loop = this.info.mode === 'live' || this.info.vod?.loop === true;
    v.setAttribute('disablepictureinpicture', 'true');

    this.attached = true;
    if (isHlsUrl(url)) this.attachHls(url);
    else {
      v.src = url;
      v.load();
    }
  }

  private bindVideoEvents() {
    const v = this.video;
    v.addEventListener('loadedmetadata', this.onMeta);
    v.addEventListener('canplay', this.onCanPlay);
    v.addEventListener('error', this.onError);
    v.addEventListener('stalled', this.onStalled);
    v.addEventListener('waiting', this.onWaiting);
    v.addEventListener('playing', this.onPlaying);
    v.addEventListener('timeupdate', this.onTimeUpdate);
  }

  private unbindVideoEvents() {
    const v = this.video;
    v.removeEventListener('loadedmetadata', this.onMeta);
    v.removeEventListener('canplay', this.onCanPlay);
    v.removeEventListener('error', this.onError);
    v.removeEventListener('stalled', this.onStalled);
    v.removeEventListener('waiting', this.onWaiting);
    v.removeEventListener('playing', this.onPlaying);
    v.removeEventListener('timeupdate', this.onTimeUpdate);
  }

  private onMeta = () => {
    // 元数据就绪后才能 seek 到实时位置
    if (this.info.mode === 'live') this.seekToLive(true);
    this.tryPlay();
  };

  private onCanPlay = () => {
    if (this.info.mode === 'live' && !this.isInSync()) this.seekToLive(true);
    this.tryPlay();
  };

  private onPlaying = () => {
    if (this.info.mode === 'live') this.seekToLive(false);
    this.emit('playing', {
      codec: this.info.playCodec,
      fallback: this.fallbackTried,
      // 用真实播放位置做展示, 而不是推算值(两者会差一个 seek 的耗时)
      positionMs: this.video.currentTime * 1000,
      inSync: this.isInSync(),
    });
    this.startSyncLoop();
  };

  /** 每 500ms 刷新一次位置标签(漂移校正仍是 5s, 两者独立) */
  private onTimeUpdate = () => {
    if (this.info.mode !== 'live') return;
    const now = Date.now();
    if (now - this.lastLabelAt < 500) return;
    this.lastLabelAt = now;
    this.emit('playing', {
      codec: this.info.playCodec,
      fallback: this.fallbackTried,
      positionMs: this.video.currentTime * 1000,
      inSync: this.isInSync(),
    });
  };

  private onWaiting = () => {
    // 缓冲中: 不报错, 保持状态(避免 64 路里频繁闪错误)
  };

  private onStalled = () => {
    // 网络停顿: 重新对齐一次, 让它按实时位置继续
    if (this.info.mode === 'live' && this.isInSync() === false) this.seekToLive(true);
  };

  private onError = () => {
    if (this.destroyed) return;
    // HEVC 直连失败(部分环境声称支持但实际解不了) -> 退回服务端转码版本, 只回退一次
    const url = this.info.url || '';
    if (!this.fallbackTried && this.info.codec === 'hevc' && /hevc=1/.test(url)) {
      this.fallbackTried = true;
      const next = url.replace('hevc=1', 'hevc=0');
      this.emit('loading', { fallback: true, codec: 'h264' });
      this.attachNative(next);
      this.info = { ...this.info, url: next, playCodec: 'h264', transcoded: true };
      return;
    }
    this.emit('error', { error: '视频解码失败', codec: this.info.playCodec });
  };

  private attachNative(url: string) {
    this.destroyHls();
    this.video.src = url;
    this.video.load();
  }

  private attachHls(url: string) {
    const v = this.video;
    if (!Hls.isSupported()) {
      // Safari 原生支持 HLS
      v.src = url;
      v.load();
      return;
    }
    this.hls = new Hls({
      enableWorker: true,
      lowLatencyMode: true,
      backBufferLength: 10,  // 限制回看缓存, 64 路并发时显著省内存
      maxBufferLength: 20,
    });
    this.hls.loadSource(url);
    this.hls.attachMedia(v);
    this.hls.on(Hls.Events.ERROR, (_e, data) => {
      if (!data.fatal) return;
      this.emit('error', { error: `HLS: ${data.details}` });
    });
  }

  private destroyHls() {
    if (this.hls) {
      try { this.hls.destroy(); } catch { /* 忽略重复销毁 */ }
      this.hls = null;
    }
  }

  private tryPlay() {
    const p = this.video.play();
    if (p && typeof p.catch === 'function') {
      p.catch(() => {
        // 自动播放被拦截: 交给组件显示"点击播放"
        this.emit('paused', { codec: this.info.playCodec });
      });
    }
  }

  /** 实时位置(考虑循环) */
  private currentPosition(): number {
    const elapsed = Date.now() - this.baseAt;
    const d = this.durationMs;
    return (((this.basePosition + elapsed) % d) + d) % d;
  }

  private isInSync(): boolean {
    const d = this.durationMs / 1000;
    const target = this.currentPosition() / 1000;
    const raw = Math.abs(this.video.currentTime - target);
    // 循环播放: 29.9s 与 0.05s 实际只差 0.15s, 要按"环形最短距离"算,
    // 否则每次跨过循环点都会被误判成漂移, 反复 seek 造成抖动
    const diff = d > 0 ? Math.min(raw, Math.abs(raw - d)) : raw;
    return diff * 1000 <= this.toleranceMs;
  }

  /** 定位到实时位置 */
  private seekToLive(force: boolean) {
    if (!this.attached) return;
    const target = this.currentPosition() / 1000;
    if (!Number.isFinite(target)) return;
    const d = this.durationMs / 1000;
    const raw = Math.abs(this.video.currentTime - target);
    const diff = d > 0 ? Math.min(raw, Math.abs(raw - d)) : raw;
    if (!force && diff * 1000 <= this.toleranceMs) return;
    try {
      this.video.currentTime = target;
    } catch {
      /* seek 过早(元数据未就绪)时忽略, 等 canplay 再对齐 */
    }
  }

  private startSyncLoop() {
    if (this.syncTimer !== null || this.info.mode !== 'live') return;
    const every = this.info.live?.syncEveryMs || 5000;
    this.syncTimer = window.setInterval(() => {
      if (this.destroyed || this.video.paused) return;
      if (!this.isInSync()) this.seekToLive(true);
      this.emit('playing', {
        codec: this.info.playCodec,
        fallback: this.fallbackTried,
        positionMs: this.video.currentTime * 1000,
        inSync: this.isInSync(),
      });
    }, every);
  }

  private stopSyncLoop() {
    if (this.syncTimer !== null) {
      window.clearInterval(this.syncTimer);
      this.syncTimer = null;
    }
  }

  pause() {
    this.video.pause();
    this.stopSyncLoop();
    this.emit('paused', { codec: this.info.playCodec });
  }

  /** 恢复: 先把基准时间前移, 避免"暂停期间的流位置"导致一次性跳走 */
  resume() {
    if (this.video.paused) {
      this.tryPlay();
      this.startSyncLoop();
    }
  }

  /** 重新对齐到实时位置 */
  resync() {
    if (this.info.mode === 'live') this.seekToLive(true);
  }

  /**
   * 彻底销毁: 解绑事件 -> 停止定时器 -> 销毁 hls -> 摘掉 src 并 load()
   * 只 pause 不断开, video 元素仍持有解码器与连接, 64 路退出时会明显内存上涨
   */
  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.stopSyncLoop();
    this.unbindVideoEvents();
    this.destroyHls();
    const v = this.video;
    try {
      v.pause();
      v.removeAttribute('src');
      v.srcObject = null;
      v.load(); // 触发浏览器释放解码器与网络连接
    } catch {
      /* 元素已卸载时忽略 */
    }
  }

  get destroyedFlag() {
    return this.destroyed;
  }
}
