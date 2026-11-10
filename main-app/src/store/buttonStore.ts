import { create } from 'zustand';
import { getButtons, updateButton } from '../api/role';
import type { RoleButton } from '../api/role';
import { broadcastButtons } from '../micro/qiankun';

interface ButtonState {
  buttons: RoleButton[];
  loading: boolean;
  load: () => Promise<void>;
  toggle: (id: number, enabled: boolean) => Promise<void>;
}

// 角色按钮状态 Store: 数据源为后端, 变更后同步到 qiankun 全局状态
export const useButtonStore = create<ButtonState>((set, get) => ({
  buttons: [],
  loading: false,

  load: async () => {
    set({ loading: true });
    const list = await getButtons();
    set({ buttons: list, loading: false });

    // 组装为 `${app}.${buttonKey}` 映射并广播给子应用
    const map: Record<string, boolean> = {};
    list.forEach((b) => { map[`${b.app}.${b.buttonKey}`] = b.enabled === 1; });
    broadcastButtons(map);
  },

  toggle: async (id, enabled) => {
    await updateButton(id, enabled);
    await get().load();
  },
}));
