/**
 * 轻提示(替代 element-plus 的 ElMessage)。
 *
 * 为什么不用 ElMessage: element-plus 的 message 会 append 到 document.body,
 * 而 qiankun 的 experimentalStyleIsolation 给样式加了 [data-qiankun="cameras"] 前缀,
 * body 上的节点不带该属性 → 定位/配色样式全部失效, 提示会散落在页面左下角。
 *
 * 本实现全部使用内联样式(inline style 不受 CSS 作用域改写影响), 与样式隔离无关。
 */

type ToastType = 'success' | 'error' | 'warning' | 'info';

interface ToastHandle {
  close: () => void;
}

const COLORS: Record<ToastType, { bg: string; border: string; color: string }> = {
  success: { bg: '#f0f9eb', border: '#e1f3d8', color: '#67c23a' },
  error: { bg: '#fef0f0', border: '#fde2e2', color: '#f56c6c' },
  warning: { bg: '#fdf6ec', border: '#faecd8', color: '#e6a23c' },
  info: { bg: '#f4f4f5', border: '#e9e9eb', color: '#909399' },
};

const DURATION = 2400;

let wrap: HTMLDivElement | null = null;

function ensureWrap(): HTMLDivElement {
  if (wrap && document.body.contains(wrap)) return wrap;
  const el = document.createElement('div');
  el.setAttribute('data-cameras-toast', '1');
  el.style.cssText = [
    'position:fixed',
    'left:50%',
    'top:20px',
    'transform:translateX(-50%)',
    'z-index:2147483000',
    'display:flex',
    'flex-direction:column',
    'align-items:center',
    'gap:8px',
    'pointer-events:none',
  ].join(';');
  document.body.appendChild(el);
  wrap = el;
  return el;
}

function createNode(type: ToastType, text: string) {
  const c = COLORS[type] || COLORS.info;
  const el = document.createElement('div');
  el.style.cssText = [
    'pointer-events:auto',
    'min-width:200px',
    'max-width:70vw',
    'padding:10px 16px',
    'border-radius:4px',
    `background:${c.bg}`,
    `border:1px solid ${c.border}`,
    `color:${c.color}`,
    'font-size:13px',
    'line-height:1.5',
    'box-shadow:0 2px 12px rgba(0,0,0,.1)',
    'opacity:0',
    'transform:translateY(-8px)',
    'transition:opacity .2s ease,transform .2s ease',
  ].join(';');
  el.textContent = text == null ? '' : String(text);
  ensureWrap().appendChild(el);
  requestAnimationFrame(() => {
    el.style.opacity = '1';
    el.style.transform = 'translateY(0)';
  });
  return el;
}

function removeNode(el: HTMLElement) {
  el.style.opacity = '0';
  el.style.transform = 'translateY(-8px)';
  setTimeout(() => {
    if (el.parentNode) el.parentNode.removeChild(el);
  }, 220);
}

function show(type: ToastType, text: string, duration = DURATION): ToastHandle {
  const el = createNode(type, text);
  let timer: number | null = null;
  if (duration > 0) {
    timer = window.setTimeout(() => removeNode(el), duration);
  }
  return {
    close: () => {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      removeNode(el);
    },
  };
}

export const toast = {
  success: (text: string) => show('success', text),
  error: (text: string) => show('error', text),
  warning: (text: string) => show('warning', text),
  info: (text: string) => show('info', text),
  /** 常驻提示(需手动 close), 用于上传等耗时操作 */
  loading: (text: string) => show('info', text, 0),
};

export default toast;
