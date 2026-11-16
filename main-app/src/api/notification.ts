import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '../store/authStore';
import { useButtonStore } from '../store/buttonStore';

// SSE 推送地址: 与 request.ts 同一 API base(以 /api 结尾), 事件流挂在其下
const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:9000/api';

// 实时通知 hook: 登录后建立 SSE 连接(EventSource 断线自动重连, 登出随组件清理断开)。
// 收到 application:changed 事件(申请提交/审核结果/权限配置变更)后:
// 1) invalidate applications 查询缓存 -> 铃铛角标/浮层/角色菜单审核表秒级刷新
// 2) buttonStore.load() -> 重新拉取按钮 map 并通过 qiankun initGlobalState
//    广播, 摄像头监控/管理后端子应用的按钮显隐实时同步
export function useNotification() {
  const token = useAuthStore((s) => s.token);
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!token) return undefined;

    const es = new EventSource(`${API_BASE}/notification/stream?token=${encodeURIComponent(token)}`);

    es.onmessage = (e) => {
      try {
        const evt = JSON.parse(e.data);
        if (evt.type !== 'application:changed') return;
        void queryClient.invalidateQueries({ queryKey: ['applications'] });
        void useButtonStore.getState().load().catch(() => undefined);
      } catch { /* 忽略无法解析的心跳外消息 */ }
    };

    // 组件卸载/登出(token 清空)时断开连接
    return () => es.close();
  }, [token, queryClient]);
}
