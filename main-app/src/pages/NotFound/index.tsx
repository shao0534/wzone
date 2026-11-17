import { useNavigate } from 'react-router-dom';

// 404 兜底页: 主应用路由未命中(/blog /projects /tools 之外)时渲染
export default function NotFound() {
  const navigate = useNavigate();

  return (
    <div className="not-found">
      <div className="nf-code">404</div>
      <div className="nf-msg">抱歉, 你访问的页面不存在或已被移除</div>
      <div className="nf-actions">
        <button type="button" className="nf-btn ghost" onClick={() => navigate(-1)}>
          返回上一页
        </button>
        <button type="button" className="nf-btn primary" onClick={() => navigate('/blog', { replace: true })}>
          回到首页
        </button>
      </div>
    </div>
  );
}
