import { NavLink, Routes, Route, Navigate } from 'react-router-dom';
import Blog from './pages/Blog';
import Projects from './pages/Projects';
import Tools from './pages/Tools';

// 顶部导航菜单: 我的博客 / 我的项目 / 我的工具
const MENUS = [
  { to: '/blog', label: '我的博客' },
  { to: '/projects', label: '我的项目' },
  { to: '/tools', label: '我的工具' },
];

export default function App() {
  return (
    <div className="app">
      <header className="app-header">
        <div className="app-logo">
          <img src="/zizaizhi.png" alt="树洞 logo" className="logo-img" />
          <span className="logo-text">树洞</span>
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
        {/* 三个主菜单右侧占位区(预留用户信息/设置入口, 高度与 header 一致 100%) */}
        <div className="header-placeholder" title="用户信息占位">
          <span className="ph-avatar" />
          <span className="ph-text">未登录</span>
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
