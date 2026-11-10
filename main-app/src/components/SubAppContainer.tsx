import { useEffect, useRef } from 'react';
import { loadMicroApp } from 'qiankun';
import type { MicroApp } from 'qiankun';
import { createChannel } from '../micro/qiankun';

interface Props {
  appName: string;
  entry: string;
  // 挂载完成(成功或失败)后的回调, 用于父组件控制多个子应用的加载时序
  onMounted?: () => void;
}

// 微应用容器: 负责按需加载/卸载子应用, 并传递全局通信 actions
export default function SubAppContainer({ appName, entry, onMounted }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const appRef = useRef<MicroApp | null>(null);
  // 用 ref 保存最新回调, 避免因回调变化导致 useEffect 重复执行
  const onMountedRef = useRef(onMounted);
  onMountedRef.current = onMounted;

  useEffect(() => {
    if (!containerRef.current) return;

    // 加载微应用: 每个子应用拿一个独立的 actions 通道(共享同一份 globalState),
    // 避免 qiankun「同一 actions 实例只保留最后一个监听者」导致后挂载的子应用顶掉前一个
    const channel = createChannel();
    appRef.current = loadMicroApp(
      {
        name: appName,
        entry,
        container: containerRef.current,
        props: { actions: channel, base: entry },
      },
      {
        // 样式隔离: 使用 experimentalStyleIsolation(Scoped CSS 前缀隔离)而非 strictStyleIsolation
        // 原因: strictStyleIsolation(Shadow DOM)会导致子应用 container.querySelector('#app') 穿透不到
        // shadow root 返回 null, 且 Element Plus/UI 的弹层(teleport 到 body)会被 Shadow DOM 吞掉
        sandbox: { experimentalStyleIsolation: true },
      }
    );

    // 挂载完成(成功或失败)后通知父组件
    // 用于保证多个子应用串行加载, 避免 import-html-entry 的全局 window.proxy 被并发覆盖
    appRef.current.mountPromise
      .then(() => onMountedRef.current?.())
      .catch(() => onMountedRef.current?.());

    return () => {
      appRef.current?.unmount();
      appRef.current = null;
    };
  }, [appName, entry]);

  return <div className="subapp-container" ref={containerRef} />;
}
