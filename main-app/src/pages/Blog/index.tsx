import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getBlogList, getBlogDetail } from '../../api/blog';
import type { Blog } from '../../api/blog';
import './index.less';

export default function Blog() {
  const [activeId, setActiveId] = useState<number | null>(null);

  // 博客列表
  const { data: list = [], isLoading } = useQuery({ queryKey: ['blogs'], queryFn: getBlogList });

  // 博客详情(选中后按需加载)
  const { data: detail } = useQuery({
    queryKey: ['blog', activeId],
    queryFn: () => getBlogDetail(activeId!),
    enabled: activeId !== null,
  });

  const active: Blog | undefined = detail ?? list.find((b) => b.id === activeId);

  return (
    <div className="blog-page">
      <aside className="blog-list">
        <h2>我的博客</h2>
        {isLoading && <p className="tip">加载中...</p>}
        <ul>
          {list.map((b) => (
            <li
              key={b.id}
              className={b.id === activeId ? 'item active' : 'item'}
              onClick={() => setActiveId(b.id)}
            >
              <span className="title">{b.title}</span>
              <span className="time">{b.dateTime}</span>
            </li>
          ))}
        </ul>
      </aside>

      <section className="blog-detail">
        {active ? (
          <>
            <h1>{active.title}</h1>
            <div className="meta">{active.dateTime}</div>
            <div className="content">{active.context}</div>
          </>
        ) : (
          <p className="tip">请选择左侧文章查看详情</p>
        )}
      </section>
    </div>
  );
}
