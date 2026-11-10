import { useEffect, useState } from 'react';
import SubAppContainer from '../../components/SubAppContainer';
import RoleMenu from '../RoleMenu';
import { MICRO_APPS, broadcastActiveTab } from '../../micro/qiankun';
import './index.less';

// 我的项目: 包含两个独立子项目 + 角色菜单
const SUB_MENUS = [
  { key: 'cameras', label: '摄像头监控' },
  { key: 'admin', label: '管理后端' },
  { key: 'role', label: '角色菜单' },
] as const;

type TabKey = (typeof SUB_MENUS)[number]['key'];

export default function Projects() {
  const [active, setActive] = useState<TabKey>('cameras');
  // cameras 挂载完成标记: admin 需等 cameras 挂载完成后再加载
  const [camerasMounted, setCamerasMounted] = useState(false);

  // 切换标签时广播给子应用, 让其在自己变为激活时重新拉取数据
  // (子应用常驻挂载, created/onMounted 只执行一次, 若不广播, 切换菜单不会重新调用 api/camera)
  useEffect(() => {
    broadcastActiveTab(active);
  }, [active]);

  return (
    <div className="projects-page">
      <nav className="projects-nav">
        {SUB_MENUS.map((m) => (
          <button
            key={m.key}
            type="button"
            className={active === m.key ? 'sub-item active' : 'sub-item'}
            onClick={() => setActive(m.key)}
          >
            {m.label}
          </button>
        ))}
      </nav>

      <div className="projects-body">
        {/* cameras 子应用常驻挂载(visibility 显隐切换), 避免反复卸载/重载。
            用 visibility 而非 display, 保证 el-table/AMap 挂载时即有真实尺寸 */}
        <div
          className="subapp-panel"
          style={{
            visibility: active === 'cameras' ? 'visible' : 'hidden',
            zIndex: active === 'cameras' ? 1 : 0,
          }}
        >
          <SubAppContainer
            appName={MICRO_APPS.cameras.appName}
            entry={MICRO_APPS.cameras.entry}
            onMounted={() => setCamerasMounted(true)}
          />
        </div>
        {/* admin 子应用等 cameras 挂载完成后再加载(串行加载):
            import-html-entry 执行脚本时会把全局 window.proxy 设为当前子应用的沙箱代理,
            若两个子应用并发加载, admin 会覆盖 cameras 的 window.proxy, 导致 cameras
            的 vite-plugin-qiankun 生命周期桥接失效(报 single-spa code 31 生命周期超时)。 */}
        {camerasMounted && (
          <div
            className="subapp-panel"
            style={{
              visibility: active === 'admin' ? 'visible' : 'hidden',
              zIndex: active === 'admin' ? 1 : 0,
            }}
          >
            <SubAppContainer appName={MICRO_APPS.admin.appName} entry={MICRO_APPS.admin.entry} />
          </div>
        )}
        {/* 角色菜单为主应用组件, 按需渲染, 铺满同一 overlay 区域 */}
        {active === 'role' && (
          <div className="subapp-panel" style={{ zIndex: 1 }}>
            <RoleMenu />
          </div>
        )}
      </div>
    </div>
  );
}
