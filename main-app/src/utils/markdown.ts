// Markdown 渲染: marked 生成 HTML, 再用浏览器 DOM 做白名单清洗
// 背景: 文章可由管理员导入任意 .md 文件, 必须防止 <script> / on* / javascript: 注入。
// 项目未安装 DOMPurify, 这里用原生 DOMParser 实现一个够用的清洗器, 不新增依赖。
import { marked } from 'marked';

marked.setOptions({ gfm: true, breaks: true });

const DANGEROUS_TAGS = [
  'script', 'style', 'iframe', 'object', 'embed', 'form', 'input',
  'button', 'textarea', 'select', 'option', 'link', 'meta', 'base',
  'svg', 'math', 'template',
];

function sanitize(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');

  // 1) 整段移除可执行/可外链的标签
  doc.querySelectorAll(DANGEROUS_TAGS.join(',')).forEach((el) => el.remove());

  // 2) 清理剩余元素上的危险属性
  doc.querySelectorAll('*').forEach((el) => {
    Array.from(el.attributes).forEach((attr) => {
      const name = attr.name.toLowerCase();
      const value = attr.value.trim().toLowerCase();
      if (name.startsWith('on')) {
        el.removeAttribute(attr.name);
      } else if (
        (name === 'href' || name === 'src' || name === 'xlink:href') &&
        (value.startsWith('javascript:') || value.startsWith('data:') || value.startsWith('vbscript:'))
      ) {
        el.removeAttribute(attr.name);
      } else if (name === 'style' && /url\s*\(|expression\s*\(/i.test(attr.value)) {
        el.removeAttribute(attr.name);
      }
    });
  });

  // 外链统一在新标签打开且隔离 opener
  doc.querySelectorAll('a[href]').forEach((a) => {
    a.setAttribute('target', '_blank');
    a.setAttribute('rel', 'noopener noreferrer');
  });

  // 3) 去掉明显无效的图片地址(如 src="x"), 避免渲染出破图占位
  doc.querySelectorAll('img').forEach((img) => {
    const src = (img.getAttribute('src') || '').trim();
    const looksValid = /^(https?:\/\/|data:image\/|\/|\.{1,2}\/)/i.test(src)
      || src.includes('/')
      || /\.[a-z0-9]{2,5}$/i.test(src);
    if (!src || !looksValid) img.remove();
  });

  return doc.body.innerHTML;
}

/** 把 Markdown 源文本转成可安全插入的 HTML */
export function renderMarkdown(source: string): string {
  if (!source) return '';
  const html = marked.parse(source, { async: false }) as string;
  return sanitize(html);
}

/** 从 md 内容里提取首个一级标题, 作为导入文件的默认标题 */
export function extractTitle(source: string, fallback: string): string {
  const matched = source.match(/^\s*#\s+(.+?)\s*$/m);
  return (matched ? matched[1] : fallback).trim().slice(0, 255);
}

/** 时间展示: 直接取数据库时间字符串, 避免 UTC/本地时区换算导致偏移 */
export function formatDateTime(value: string): string {
  const matched = String(value || '').match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/);
  return matched ? `${matched[1]} ${matched[2]}` : String(value || '');
}
