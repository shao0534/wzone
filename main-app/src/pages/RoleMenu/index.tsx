import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useButtonStore } from '../../store/buttonStore';
import { getApplications, reviewApplication } from '../../api/application';
import type { Application } from '../../api/application';
import './index.less';

// 角色菜单: 控制两个子项目操作按钮的可用状态, 并审核子项目提交的申请
export default function RoleMenu() {
  const { buttons, loading, load, toggle } = useButtonStore();
  const [msg, setMsg] = useState('');
  const queryClient = useQueryClient();

  // 按应用分组展示按钮
  const groups = useMemo(() => {
    const map: Record<string, typeof buttons> = {};
    buttons.forEach((b) => {
      (map[b.app] = map[b.app] || []).push(b);
    });
    return map;
  }, [buttons]);

  // 申请列表
  const { data: apps = [] } = useQuery({ queryKey: ['applications'], queryFn: getApplications });

  useEffect(() => {
    load().catch(() => setMsg('按钮状态加载失败, 请检查后端服务'));
  }, [load]);

  const flash = (text: string) => {
    setMsg(text);
    setTimeout(() => setMsg(''), 2000);
  };

  // 切换按钮状态
  const handleToggle = async (id: number, enabled: boolean) => {
    await toggle(id, enabled);
    flash('已更新并同步到子应用');
  };

  // 审核申请
  const handleReview = async (app: Application, status: number) => {
    await reviewApplication(app.id, status);
    await load(); // 通过时后端已改按钮状态, 重新加载并广播
    queryClient.invalidateQueries({ queryKey: ['applications'] });
    flash(status === 1 ? '已通过并同步' : '已拒绝');
  };

  const statusText = (s: number) => ['待审核', '已通过', '已拒绝'][s] ?? '未知';
  const actionText = (a: number) => (a === 1 ? '申请启用' : '申请禁用');

  return (
    <div className="role-page">
      {msg && <div className="role-msg">{msg}</div>}

      <section className="role-section">
        <h3>按钮状态管理</h3>
        {loading && <p className="tip">加载中...</p>}
        {Object.entries(groups).map(([appName, list]) => (
          <div key={appName} className="group">
            <div className="group-title">{appName === 'cameras' ? '摄像头监控' : '管理后端'}</div>
            <div className="group-body">
              {list.map((b) => (
                <div key={b.id} className="btn-row">
                  <span className="btn-label">{b.label}</span>
                  <span className="btn-key">({b.buttonKey})</span>
                  <button
                    className={b.enabled === 1 ? 'switch on' : 'switch off'}
                    onClick={() => handleToggle(b.id, b.enabled !== 1)}
                  >
                    {b.enabled === 1 ? '可用' : '禁用'}
                  </button>
                </div>
              ))}
            </div>
          </div>
        ))}
      </section>

      <section className="role-section">
        <h3>子项目申请审核</h3>
        {apps.length === 0 && <p className="tip">暂无申请</p>}
        <table className="app-table">
          <thead>
            <tr>
              <th>应用</th>
              <th>按钮</th>
              <th>动作</th>
              <th>理由</th>
              <th>时间</th>
              <th>状态</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {apps.map((a) => (
              <tr key={a.id}>
                <td>{a.app === 'cameras' ? '摄像头监控' : '管理后端'}</td>
                <td>{a.buttonLabel || a.buttonKey}</td>
                <td>{actionText(a.requestAction)}</td>
                <td className="reason">{a.reason || '-'}</td>
                <td>{a.createdAt}</td>
                <td>{statusText(a.status)}</td>
                <td>
                  {a.status === 0 ? (
                    <>
                      <button className="btn ok" onClick={() => handleReview(a, 1)}>通过</button>
                      <button className="btn no" onClick={() => handleReview(a, 2)}>拒绝</button>
                    </>
                  ) : (
                    '-'
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
