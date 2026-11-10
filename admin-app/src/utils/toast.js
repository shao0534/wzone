/**
 * 轻提示(替代 element-ui 的 $message)。
 *
 * 为什么不用 $message: ElMessage 会被 element-ui 挂到 document.body 上,
 * 而 qiankun 的 experimentalStyleIsolation 给样式加了 [data-qiankun="admin"] 前缀,
 * body 上的节点不带该属性 → .el-message 的 position:fixed / 居中 / 配色全部失效,
 * 提示会散落在页面左下角且不消失。
 *
 * 这里用完全内联样式(inline style 不受 CSS 作用域改写影响) + 固定挂载的容器实现,
 * 位置、配色、动画都在 JS 里写死, 与样式隔离无关。
 */

const COLORS = {
  success: { bg: '#f0f9eb', border: '#e1f3d8', color: '#67c23a' },
  error: { bg: '#fef0f0', border: '#fde2e2', color: '#f56c6c' },
  warning: { bg: '#fdf6ec', border: '#faecd8', color: '#e6a23c' },
  info: { bg: '#f4f4f5', border: '#e9e9eb', color: '#909399' },
};

const DURATION = 2400;

let wrap = null;

function ensureWrap() {
  if (wrap && document.body.contains(wrap)) return wrap;
  wrap = document.createElement('div');
  wrap.setAttribute('data-admin-toast', '1');
  wrap.style.cssText = [
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
  document.body.appendChild(wrap);
  return wrap;
}

function show(type, text) {
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

  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transform = 'translateY(-8px)';
    setTimeout(() => {
      if (el.parentNode) el.parentNode.removeChild(el);
    }, 220);
  }, DURATION);
}

export const toast = {
  success: (text) => show('success', text),
  error: (text) => show('error', text),
  warning: (text) => show('warning', text),
  info: (text) => show('info', text),
};

export default toast;
