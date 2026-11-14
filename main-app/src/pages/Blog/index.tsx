import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getBlogList, createBlog, updateBlog, deleteBlog } from '../../api/blog';
import type { Blog, BlogPayload } from '../../api/blog';
import { useAuthStore } from '../../store/authStore';
import { renderMarkdown, extractTitle, formatDateTime } from '../../utils/markdown';
import './index.less';

type Mode = 'view' | 'create' | 'edit';
type Notice = { type: 'success' | 'error'; text: string } | null;
type SaveVars =
  | { op: 'create'; payload: BlogPayload }
  | { op: 'edit'; id: number; payload: BlogPayload };

const MAX_IMPORT_BYTES = 4 * 1024 * 1024;

export default function Blog() {
  const user = useAuthStore((s) => s.user);
  const isAdmin = Number(user?.role) === 1;
  const queryClient = useQueryClient();

  const [activeId, setActiveId] = useState<number | null>(null);
  const [mode, setMode] = useState<Mode>('view');
  const [draftTitle, setDraftTitle] = useState('');
  const [draftContent, setDraftContent] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<Blog | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const restoreIdRef = useRef<number | null>(null);

  // 列表接口返回完整 context, 无需再单独请求详情, 避免编辑后出现缓存不一致
  const { data: list = [], isLoading } = useQuery({ queryKey: ['blogs'], queryFn: getBlogList });
  // 未显式选中时默认展示列表第一篇; 选中的文章被删掉后也自动回落到第一篇。
  // 用渲染时派生而非 useEffect 回填 activeId, 避免「新建保存」时列表刷新与设置选中态的时序竞态。
  const active = mode === 'view' ? (list.find((b) => b.id === activeId) ?? list[0]) : undefined;

  const source = mode === 'view' ? (active?.context ?? '') : draftContent;
  const previewHtml = useMemo(() => renderMarkdown(source), [source]);

  function enterEdit(next: Mode, seed?: { title: string; content: string }) {
    if (!isAdmin) return;
    restoreIdRef.current = activeId;
    setDraftTitle(seed?.title ?? '');
    setDraftContent(seed?.content ?? '');
    if (next === 'create') setActiveId(null);
    setMode(next);
    setNotice(null);
  }

  function startEdit() {
    if (!active) return;
    enterEdit('edit', { title: active.title, content: active.context });
  }

  function cancelEdit() {
    setMode('view');
    setActiveId(restoreIdRef.current);
    setNotice(null);
  }

  function selectArticle(id: number) {
    if (mode !== 'view') {
      setNotice({ type: 'error', text: '请先保存或取消当前编辑，再切换文章' });
      return;
    }
    setActiveId(id);
    setNotice(null);
  }

  async function handleImport(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ''; // 允许重复选择同一个文件
    if (!file || !isAdmin) return;
    if (file.size > MAX_IMPORT_BYTES) {
      setNotice({ type: 'error', text: '文件超过 4MB，请精简后再导入' });
      return;
    }
    try {
      const text = await file.text();
      enterEdit('create', {
        title: extractTitle(text, file.name.replace(/\.(md|markdown|txt)$/i, '')),
        content: text,
      });
      setNotice({ type: 'success', text: `已导入 ${file.name}，确认内容后点击「保存」才会入库` });
    } catch {
      setNotice({ type: 'error', text: '文件读取失败，请确认使用 UTF-8 编码的文本文件' });
    }
  }

  const saveMutation = useMutation({
    mutationFn: (vars: SaveVars) =>
      vars.op === 'create' ? createBlog(vars.payload) : updateBlog(vars.id, vars.payload),
    onSuccess: async (saved: Blog, vars: SaveVars) => {
      await queryClient.invalidateQueries({ queryKey: ['blogs'] });
      setActiveId(saved.id);
      setMode('view');
      setNotice({ type: 'success', text: vars.op === 'create' ? '文章已创建' : '修改已保存' });
    },
    onError: (e: Error) => setNotice({ type: 'error', text: e.message }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => deleteBlog(id),
    onSuccess: async (_data, id) => {
      await queryClient.invalidateQueries({ queryKey: ['blogs'] });
      if (activeId === id) setActiveId(null);
      setMode('view');
      setDeleteTarget(null);
      setNotice({ type: 'success', text: '文章已删除' });
    },
    onError: (e: Error) => setNotice({ type: 'error', text: e.message }),
  });

  function handleSave() {
    const title = draftTitle.trim();
    const context = draftContent;
    if (!title) { setNotice({ type: 'error', text: '标题不能为空' }); return; }
    if (!context.trim()) { setNotice({ type: 'error', text: '内容不能为空' }); return; }
    if (mode === 'create') saveMutation.mutate({ op: 'create', payload: { title, context } });
    else if (mode === 'edit' && activeId !== null) {
      saveMutation.mutate({ op: 'edit', id: activeId, payload: { title, context } });
    }
  }

  // 角色降级/切换时强制退出编辑态; 提示自动消失; ESC 关闭确认框或取消编辑
  useEffect(() => {
    if (!isAdmin && mode !== 'view') {
      setMode('view');
      setDeleteTarget(null);
    }
  }, [isAdmin, mode]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 4000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (deleteTarget) setDeleteTarget(null);
      else if (mode !== 'view') cancelEdit();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [deleteTarget, mode]);

  return (
    <div className="blog-page">
      <aside className="blog-list">
        <div className="list-head">
          <h2>我的博客 <span className="count">{list.length}</span></h2>
          {isAdmin ? (
            <div className="list-actions">
              <button type="button" className="btn primary" onClick={() => enterEdit('create')}>+ 新建</button>
              <button type="button" className="btn" onClick={() => fileRef.current?.click()}>导入 md</button>
              <input
                ref={fileRef}
                type="file"
                accept=".md,.markdown,.txt,text/markdown,text/plain"
                hidden
                onChange={handleImport}
              />
            </div>
          ) : (
            <div className="readonly-hint">只读模式 · 仅可查看</div>
          )}
        </div>

        {isLoading && <p className="tip">加载中…</p>}
        {!isLoading && list.length === 0 && <p className="tip">暂无文章</p>}
        <ul>
          {list.map((b) => (
            <li
              key={b.id}
              className={b.id === active?.id && mode === 'view' ? 'item active' : 'item'}
              onClick={() => selectArticle(b.id)}
            >
              <span className="title">{b.title}</span>
              <span className="time">{formatDateTime(b.dateTime)}</span>
            </li>
          ))}
        </ul>
      </aside>

      {mode === 'view' ? (
        <section className="blog-main article-view">
          {active ? (
            <>
              <div className="article-head">
                <div className="article-head-text">
                  <h1>{active.title}</h1>
                  <div className="meta">发布于 {formatDateTime(active.dateTime)}</div>
                </div>
                {isAdmin && (
                  <div className="article-actions">
                    <button type="button" className="btn" onClick={startEdit}>编辑</button>
                    <button type="button" className="btn danger-ghost" onClick={() => setDeleteTarget(active)}>删除</button>
                  </div>
                )}
              </div>
              <article className="markdown-body" dangerouslySetInnerHTML={{ __html: previewHtml }} />
            </>
          ) : (
            <div className="empty-state">
              {list.length === 0 ? '暂无文章' : '请选择左侧文章查看详情'}
            </div>
          )}
        </section>
      ) : (
        <section className="blog-main editor-layout">
          <div className="editor-pane">
            <div className="pane-head">
              <strong>{mode === 'create' ? '新建文章' : '编辑文章'}</strong>
              <span className="pane-tip">支持 Markdown 语法</span>
            </div>
            <label className="field-label" htmlFor="blog-title">标题</label>
            <input
              id="blog-title"
              className="title-input"
              value={draftTitle}
              maxLength={255}
              placeholder="请输入文章标题"
              onChange={(e) => setDraftTitle(e.target.value)}
            />
            <label className="field-label" htmlFor="blog-content">正文 (Markdown)</label>
            <textarea
              id="blog-content"
              className="content-input"
              value={draftContent}
              placeholder={'# 标题\n\n在这里输入 Markdown 正文…'}
              spellCheck={false}
              onChange={(e) => setDraftContent(e.target.value)}
            />
            <div className="editor-actions">
              <button type="button" className="btn primary" disabled={saveMutation.isPending} onClick={handleSave}>
                {saveMutation.isPending ? '保存中…' : '保存'}
              </button>
              <button type="button" className="btn" disabled={saveMutation.isPending} onClick={cancelEdit}>取消</button>
            </div>
          </div>

          <div className="preview-pane">
            <div className="pane-head">
              <strong>预览</strong>
              <span className="pane-tip">实时渲染</span>
            </div>
            <div className="preview-title">{draftTitle || '未命名文章'}</div>
            <article className="markdown-body" dangerouslySetInnerHTML={{ __html: previewHtml }} />
          </div>
        </section>
      )}

      {notice && (
        <div className={`notice ${notice.type}`} role="status">
          <span>{notice.text}</span>
          <button type="button" className="notice-close" aria-label="关闭提示" onClick={() => setNotice(null)}>×</button>
        </div>
      )}

      {deleteTarget && (
        <div className="confirm-mask" onClick={() => setDeleteTarget(null)}>
          <div
            className="confirm-box"
            role="dialog"
            aria-modal="true"
            aria-label="确认删除"
            onClick={(e) => e.stopPropagation()}
          >
            <h3>确认删除</h3>
            <p>即将删除《{deleteTarget.title}》，删除后不可恢复。</p>
            <div className="confirm-actions">
              <button type="button" className="btn" onClick={() => setDeleteTarget(null)}>取消</button>
              <button
                type="button"
                className="btn danger"
                disabled={deleteMutation.isPending}
                onClick={() => deleteMutation.mutate(deleteTarget.id)}
              >
                {deleteMutation.isPending ? '删除中…' : '确认删除'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
