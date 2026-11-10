import { defineStore } from 'pinia';
import { getButtons } from '../api/role';
import { onButtonsChange, getGlobalButtons } from '../micro';

// 按钮权限 Store: 控制摄像头监控端操作按钮可用状态
export const useButtonStore = defineStore('button', {
  state: () => ({
    // 键: `${app}.${buttonKey}`, 值: 是否可用
    buttons: {} as Record<string, boolean>,
  }),

  getters: {
    // 判断摄像头监控端某按钮是否可用(默认可用)
    can: (state) => (key: string) => state.buttons[`cameras.${key}`] !== false,
  },

  actions: {
    // 初始化: 从后端拉取 + 监听主应用广播 + 合并当前全局状态
    async init() {
      await this.load();
      onButtonsChange((g) => { this.buttons = { ...this.buttons, ...g }; });
      const g = getGlobalButtons();
      if (g && Object.keys(g).length) this.buttons = { ...this.buttons, ...g };
    },

    // 从后端拉取按钮状态(数据源)
    async load() {
      const list = await getButtons();
      const map: Record<string, boolean> = {};
      list.forEach((b: any) => { map[`${b.app}.${b.buttonKey}`] = b.enabled === 1; });
      this.buttons = map;
    },
  },
});
