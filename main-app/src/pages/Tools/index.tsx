import { useQuery } from '@tanstack/react-query';
import { marked } from 'marked';
import { getToolList } from '../../api/tool';
import './index.less';

export default function Tools() {
  const { data: list = [], isLoading } = useQuery({ queryKey: ['tools'], queryFn: getToolList });

  // 将 mdcode(安装使用说明) 渲染为 HTML
  const renderMarkdown = (md: string) => ({ __html: marked.parse(md || '') as string });

  return (
    <div className="tools-page">
      <h2>我的工具</h2>
      {isLoading && <p className="tip">加载中...</p>}
      <div className="tool-grid">
        {list.map((t) => (
          <div key={t.id} className="tool-card">
            <div className="tool-head">
              <span className="name">{t.name}</span>
              {t.link && (
                <a className="link" href={t.link} target="_blank" rel="noreferrer">
                  打开 / 下载
                </a>
              )}
            </div>
            <p className="desc">{t.description}</p>
            {t.mdcode && (
              <div className="md" dangerouslySetInnerHTML={renderMarkdown(t.mdcode)} />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
