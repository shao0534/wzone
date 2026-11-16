import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '../store/authStore';
import { useButtonStore } from '../store/buttonStore';
import { getApplications, reviewApplication } from '../api/application';
import type { Application } from '../api/application';

const APP_LABELS: Record<string, string> = { cameras: '摄像头监控', admin: '管理后端' };
const ACTION_LABELS: Record<number, string> = { 1: '申请启用', 0: '申请禁用' };
const STATUS_LABELS: Record<number, string> = { 1: '已通过', 2: '已拒绝' };

// 顶部消息提醒铃铛(退出按钮左侧): 点击弹出浮层, 直接在浮层内处理消息, 不跳转。
// - 管理员: 列出待审核申请, 浮层内可直接「通过/拒绝」; 角标 = 待审核数量
// - 普通用户: 列出自己申请的审核结果, 打开浮层即视为已读; 角标 = 未读结果数量
export default function MessageBell() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const isAdmin = Number(user?.role) === 1;
  const name = user?.name ?? '';
  const reloadButtons = useButtonStore((s) => s.load);

  // 数据源以 SSE 实时推送为主(notification.ts 收到事件即 invalidate 本查询),
  // 此处保留 60s 低频轮询兜底, 防 SSE 被代理/网络环境拦截时通知彻底失效
  const { data: apps = [] } = useQuery({
    queryKey: ['applications'],
    queryFn: getApplications,
    refetchInterval: 60_000,
  });

  // 已读记录按用户名隔离, 避免切换账号后残留; 放入 state 使角标即点即清
  const seenKey = `shuwu.msg.seen.${name}`;
  const [seen, setSeen] = useState<number[]>(() => {
    try { return JSON.parse(localStorage.getItem(seenKey) || '[]'); } catch { return []; }
  });
  const [open, setOpen] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null); // 正在审核的申请
  const [tip, setTip] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);

  // 管理员: 待审核列表(最新在前); 普通用户: 自己已出结果的申请
  const pending = useMemo(
    () => apps.filter((a) => a.status === 0).sort((x, y) => y.id - x.id),
    [apps],
  );
  const mine = useMemo(
    () => apps.filter((a) => a.applicant === name && a.status !== 0).sort((x, y) => y.id - x.id),
    [apps, name],
  );
  const unread = isAdmin ? pending.length : mine.filter((a) => !seen.includes(a.id)).length;

  // 浮层打开时: 点击外部 / Esc 关闭
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const flash = (text: string) => {
    setTip(text);
    setTimeout(() => setTip(''), 2000);
  };

  // 普通用户: 打开浮层即把自己的申请结果全部标记为已读(同步 state + localStorage)
  const toggleOpen = () => {
    const next = !open;
    setOpen(next);
    if (next && !isAdmin) {
      const ids = mine.map((a) => a.id);
      setSeen(ids);
      try { localStorage.setItem(seenKey, JSON.stringify(ids)); } catch { /* 存储失败不影响展示 */ }
    }
  };

  // 管理员: 浮层内直接审核; 通过时后端已改按钮状态, 需重新加载并广播到子应用
  const handleReview = async (app: Application, status: number) => {
    setBusyId(app.id);
    try {
      await reviewApplication(app.id, status);
      queryClient.invalidateQueries({ queryKey: ['applications'] });
      await reloadButtons().catch(() => undefined); // 同步按钮状态到子应用
      flash(status === 1 ? '已通过并同步' : '已拒绝');
    } catch {
      flash('审核失败, 请重试');
    } finally {
      setBusyId(null);
    }
  };

  // 浮层列表内容: 管理员看待审核, 普通用户看自己的申请结果
  const items = isAdmin ? pending : mine;

  return (
    <div className="bell-wrap" ref={rootRef}>
      <button
        type="button"
        className="msg-bell"
        title={unread > 0 ? `${unread} 条新消息` : '消息提醒'}
        onClick={toggleOpen}
      >
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          <path
            fill="currentColor"
            d="M12 2a1 1 0 0 1 1 1v.34A7 7 0 0 1 18 10v4.59l1.71 1.7A1 1 0 0 1 19 18H5a1 1 0 0 1-.71-1.71L6 14.59V10a7 7 0 0 1 5-6.66V3a1 1 0 0 1 1-1z"
          />
          <path fill="currentColor" d="M9.5 19a2.5 2.5 0 0 0 5 0h-5z" />
        </svg>
        {unread > 0 && <span className="bell-badge">{unread > 99 ? '99+' : unread}</span>}
      </button>

      {open && (
        <div className="bell-pop">
          <div className="bell-pop-title">
            {isAdmin ? '待审核申请' : '我的申请结果'}
            {tip && <span className="bell-pop-tip">{tip}</span>}
          </div>
          {items.length === 0 && <div className="bell-empty">暂无新消息</div>}
          {items.length > 0 && (
            <ul className="bell-list">
              {items.map((a) => (
                <li key={a.id} className="bell-item">
                  <div className="bell-item-main">
                    {isAdmin ? (
                      <>
                        <span className="bell-item-head">
                          {a.applicant || '未知用户'} · {ACTION_LABELS[a.requestAction] ?? '申请'}
                        </span>
                        <span className="bell-item-sub">
                          {APP_LABELS[a.app] ?? a.app} - {a.buttonLabel || a.buttonKey} · {a.createdAt}
                        </span>
                      </>
                    ) : (
                      <>
                        <span className={`bell-item-head ${a.status === 1 ? 'ok' : 'no'}`}>
                          「{a.buttonLabel || a.buttonKey}」{STATUS_LABELS[a.status] ?? '已处理'}
                        </span>
                        <span className="bell-item-sub">
                          {APP_LABELS[a.app] ?? a.app} · {a.createdAt}
                        </span>
                      </>
                    )}
                  </div>
                  {isAdmin && (
                    <span className="bell-item-actions">
                      <button
                        type="button"
                        className="bell-btn ok"
                        disabled={busyId === a.id}
                        onClick={() => handleReview(a, 1)}
                      >
                        通过
                      </button>
                      <button
                        type="button"
                        className="bell-btn no"
                        disabled={busyId === a.id}
                        onClick={() => handleReview(a, 2)}
                      >
                        拒绝
                      </button>
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
          <button
            type="button"
            className="bell-pop-more"
            onClick={() => { setOpen(false); navigate('/projects?tab=role'); }}
          >
            查看全部 →
          </button>
        </div>
      )}
    </div>
  );
}
