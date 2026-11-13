import { useEffect } from 'react';
import { NavLink, Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom';
import Blog from './pages/Blog';
import Projects from './pages/Projects';
import Tools from './pages/Tools';
import Login from './pages/Login';
import { useAuthStore } from './store/authStore';
import { logoutApi } from './api/auth';

// 顶部导航菜单: 我的博客 / 我的项目 / 我的工具
const MENUS = [
  { to: '/blog', label: '我的博客' },
  { to: '/projects', label: '我的项目' },
  { to: '/tools', label: '我的工具' },
];

export default function App() {
  const location = useLocation();
  const navigate = useNavigate();
  const token = useAuthStore((s) => s.token);
  const user = useAuthStore((s) => s.user);
  const ready = useAuthStore((s) => s.ready);
  const restore = useAuthStore((s) => s.restore);
  const clear = useAuthStore((s) => s.clear);

  // 刷新页面时向服务端校验本地 token, 校验完成前不渲染主界面(避免闪屏)
  useEffect(() => { void restore(); }, [restore]);

  if (!ready) return <div className="app-boot">正在加载…</div>;

  // 登录页独立全屏渲染, 不套用顶部导航布局
  if (location.pathname === '/login') {
    return token ? <Navigate to="/blog" replace /> : <Login />;
  }

  // 未登录一律回登录页
  if (!token) return <Navigate to="/login" replace />;

  const handleLogout = () => {
    void logoutApi().catch(() => undefined);
    clear();
    navigate('/login', { replace: true });
  };

  return (
    <div className="app">
      <header className="app-header">
        <div className="app-logo">
          <img src="/zizaizhi.png" alt="树屋 logo" className="logo-img" />
          <span className="logo-text">树屋</span>
        </div>
        <nav className="app-nav">
          {MENUS.map((m) => (
            <NavLink
              key={m.to}
              to={m.to}
              className={({ isActive }) => (isActive ? 'nav-item active' : 'nav-item')}
            >
              {m.label}
            </NavLink>
          ))}
        </nav>
        <div className="header-user">
          <span className={`role-tag ${user?.role === 1 ? 'is-admin' : ''}`}>
            {user?.roleName ?? '用户'}
          </span>
          <span className="user-name">{user?.name ?? ''}</span>
          <button type="button" className="logout-btn" onClick={handleLogout}>退出</button>
        </div>
      </header>

      <main className="app-main">
        <Routes>
          <Route path="/" element={<Navigate to="/blog" replace />} />
          <Route path="/blog/*" element={<Blog />} />
          <Route path="/projects/*" element={<Projects />} />
          <Route path="/tools/*" element={<Tools />} />
        </Routes>
      </main>
    </div>
  );
}
