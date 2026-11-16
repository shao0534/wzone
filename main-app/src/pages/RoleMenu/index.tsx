import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '../../store/authStore';
import { useButtonStore } from '../../store/buttonStore';
import { getApplications, reviewApplication } from '../../api/application';
import type { Application } from '../../api/application';
import type { RoleButton } from '../../api/role';
import './index.less';

const ROLE_LABELS: Record<number, string> = { 1: '管理员', 0: '普通用户' };

// 单个按钮在两种角色下的配置行(缺行时对应角色为 undefined)
type ButtonItem = { key: string; label: string; rows: Record<number, RoleButton> };

// 角色菜单: 按角色(管理员/普通用户)配置两个子项目各按钮的可用状态, 并审核子项目提交的申请。
// 配置操作仅管理员可执行, 普通用户只读。
export default function RoleMenu() {
  const { buttons, loading, load, toggle } = useButtonStore();
  const user = useAuthStore((s) => s.user);
  const isAdmin = Number(user?.role) === 1;
  const [msg, setMsg] = useState('');
  const queryClient = useQueryClient();

  // 按应用分组, 组内再按按钮聚合出两种角色的开关行
  const groups = useMemo(() => {
    const map: Record<string, ButtonItem[]> = {};
    buttons.forEach((b) => {
      const g = (map[b.app] = map[b.app] || []);
      let item = g.find((x) => x.key === b.buttonKey);
      if (!item) {
        item = { key: b.buttonKey, label: b.label, rows: {} };
        g.push(item);
      }
      item.rows[b.role] = b;
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

  // 切换某角色下某按钮的可用状态
  const handleToggle = async (id: number, enabled: boolean) => {
    await toggle(id, enabled);
    flash('已更新并同步到子应用');
  };

  // 审核申请(仅管理员)
  const handleReview = async (app: Application, status: number) => {
    await reviewApplication(app.id, status);
    await load(); // 通过时后端已改按钮状态, 重新加载并广播
    queryClient.invalidateQueries({ queryKey: ['applications'] });
    flash(status === 1 ? '已通过并同步' : '已拒绝');
  };

  const statusText = (s: number) => ['待审核', '已通过', '已拒绝'][s] ?? '未知';
  const actionText = (a: number) => (a === 1 ? '申请启用' : '申请禁用');

  const renderSwitch = (row?: RoleButton) => {
    if (!row) return <span className="missing">未配置</span>;
    if (!isAdmin) {
      return <span className={row.enabled === 1 ? 'state on' : 'state off'}>{row.enabled === 1 ? '可用' : '禁用'}</span>;
    }
    return (
      <button
        className={row.enabled === 1 ? 'switch on' : 'switch off'}
        onClick={() => handleToggle(row.id, row.enabled !== 1)}
      >
        {row.enabled === 1 ? '可用' : '禁用'}
      </button>
    );
  };

  return (
    <div className="role-page">
      {msg && <div className="role-msg">{msg}</div>}

      <section className="role-section">
        <h3>
          按钮权限配置
          <span className="role-hint">{isAdmin ? '' : '(仅管理员可修改, 当前为只读)'}</span>
        </h3>
        {loading && <p className="tip">加载中...</p>}
        {Object.entries(groups).map(([appName, items]) => (
          <div key={appName} className="group">
            <div className="group-title">{appName === 'cameras' ? '摄像头监控' : '管理后端'}</div>
            <div className="group-body">
              <div className="btn-row head">
                <span className="btn-label">按钮</span>
                <span className="switch-cell">管理员</span>
                <span className="switch-cell">普通用户</span>
              </div>
              {items.map((item) => (
                <div key={item.key} className="btn-row">
                  <span className="btn-label">
                    {item.label} <span className="btn-key">({item.key})</span>
                  </span>
                  <span className="switch-cell">{renderSwitch(item.rows[1])}</span>
                  <span className="switch-cell">{renderSwitch(item.rows[0])}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </section>

      <section className="role-section">
        <h3>子项目申请审核</h3>
        {apps.length === 0 && <p className="tip">暂无申请</p>}
        {apps.length > 0 && (
          <table className="app-table">
            <thead>
              <tr>
                <th>应用</th>
                <th>申请人</th>
                <th>按钮</th>
                <th>申请角色</th>
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
                  <td>{a.applicant || '-'}</td>
                  <td>{a.buttonLabel || a.buttonKey}</td>
                  <td>{ROLE_LABELS[a.role] ?? '普通用户'}</td>
                  <td>{actionText(a.requestAction)}</td>
                  <td className="reason">{a.reason || '-'}</td>
                  <td>{a.createdAt}</td>
                  <td>{statusText(a.status)}</td>
                  <td>
                    {isAdmin && a.status === 0 ? (
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
        )}
      </section>
    </div>
  );
}
