import { defineStore } from 'pinia';
import { getButtonMap } from '../api/role';
import { onButtonsChange, getGlobalButtons } from '../micro';

// 按钮权限 Store: 控制摄像头监控端操作按钮可用状态
// 数据源: GET /role/buttons —— 服务端按「当前登录角色」过滤后的显式布尔 map。
// fail closed: 只有明确为 true 才可用, 未加载完成/缺键一律视为不可用, 避免误开放。
export const useButtonStore = defineStore('button', {
  state: () => ({
    // 键: `${app}.${buttonKey}`, 值: 是否可用
    buttons: {} as Record<string, boolean>,
    // 首次加载完成前按钮全部视为不可用(加载通常在毫秒级完成)
    loaded: false,
  }),

  getters: {
    // 判断摄像头监控端某按钮是否可用(未加载/缺键/禁用一律 false)
    can: (state) => (key: string) => state.loaded && state.buttons[`cameras.${key}`] === true,
  },

  actions: {
    // 初始化: 从后端拉取(带登录 token, 服务端按角色过滤) + 监听主应用广播 + 合并当前全局状态
    async init() {
      await this.load();
      onButtonsChange((g) => {
        this.buttons = { ...this.buttons, ...g };
        this.loaded = true;
      });
      const g = getGlobalButtons();
      if (g && Object.keys(g).length) {
        this.buttons = { ...this.buttons, ...g };
        this.loaded = true;
      }
    },

    // 从后端拉取当前角色的按钮可用 map(数据源)
    async load() {
      const info = await getButtonMap();
      this.buttons = info.buttons || {};
      this.loaded = true;
    },
  },
});
