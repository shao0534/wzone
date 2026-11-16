import { create } from 'zustand';
import { getButtons, getButtonMap, updateButton } from '../api/role';
import type { RoleButton, ButtonMapInfo } from '../api/role';
import { broadcastButtons } from '../micro/qiankun';

interface ButtonState {
  /** 全量配置行(含 role), 角色菜单页渲染用 */
  buttons: RoleButton[];
  /** 当前角色视角的按钮可用 map, 变更后广播给子应用 */
  buttonMap: Record<string, boolean>;
  loading: boolean;
  load: () => Promise<void>;
  toggle: (id: number, enabled: boolean) => Promise<void>;
}

// 角色按钮权限 Store: 数据源为后端, 变更后同步到 qiankun 全局状态
export const useButtonStore = create<ButtonState>((set, get) => ({
  buttons: [],
  buttonMap: {},
  loading: false,

  load: async () => {
    set({ loading: true });
    try {
      // 配置行(渲染开关)与角色视角 map(下发子应用)并行拉取, 两者数据源一致
      const [list, info]: [RoleButton[], ButtonMapInfo] = await Promise.all([
        getButtons(),
        getButtonMap(),
      ]);
      set({ buttons: list, buttonMap: info.buttons, loading: false });
      broadcastButtons(info.buttons);
    } finally {
      set({ loading: false });
    }
  },

  toggle: async (id, enabled) => {
    await updateButton(id, enabled);
    await get().load();
  },
}));
