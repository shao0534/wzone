import Vue from 'vue';
import Vuex from 'vuex';
import { getButtonMap } from '../api/role';
import { getCameras } from '../api/camera';
import { onButtonsChange, onActiveTabChange, getGlobalButtons } from '../micro';

Vue.use(Vuex);

// 防重复初始化标记(模块级): 不能在 action 方法体内用方法名自身作标识符
// (对象简写方法不创建同名作用域绑定, 直接引用会抛 ReferenceError 且被调用方静默吞掉,
// 导致权限加载与广播监听永远不执行 —— 之前 initButtons._done 正是踩的这个坑)
let buttonsInited = false;

export default new Vuex.Store({
  state: {
    buttons: {},   // 键: `${app}.${buttonKey}`, 值: 是否可用
    cameras: [],
    total: 0,
    page: 1,
    pageSize: 10,
    keyword: '',
    loading: false,
  },

  getters: {
    // 判断管理后端某按钮是否可用(fail closed: 未加载/缺键/禁用一律不可用, 避免误开放)
    can: (state) => (key) => state.buttons[`admin.${key}`] === true,
  },

  mutations: {
    setButtons(state, map) { state.buttons = { ...state.buttons, ...map }; },
    setCameras(state, { list, total }) { state.cameras = list; state.total = total; },
    setPage(state, page) { state.page = page; },
    setKeyword(state, kw) { state.keyword = kw; },
    setLoading(state, v) { state.loading = v; },
  },

  actions: {
    // 初始化按钮权限: 后端拉取 + 监听主应用广播 + 合并全局状态
    async initButtons({ dispatch, commit }) {
      if (buttonsInited) return;
      buttonsInited = true;

      await dispatch('loadButtons');
      onButtonsChange((g) => commit('setButtons', g));
      const g = getGlobalButtons();
      if (Object.keys(g).length) commit('setButtons', g);
      // 监听主应用切换标签: 当管理后端变为激活时重新分页拉取(每页 10 条)
      onActiveTabChange((tab) => {
        if (tab === 'admin') dispatch('fetchCameras');
      });
    },

    async loadButtons({ commit }) {
      // 拉取当前登录角色视角的按钮可用 map(同键 role=0/1 两行,
      // 若拉全量配置相互覆盖会变成管理员视角, 必须用按角色过滤后的 /role/buttons)
      const info = await getButtonMap();
      commit('setButtons', (info && info.buttons) || {});
    },

    async fetchCameras({ commit, state }) {
      commit('setLoading', true);
      try {
        const data = await getCameras({ page: state.page, pageSize: state.pageSize, keyword: state.keyword });
        // 拦截器已解包: data = { list, total, page, pageSize }, 这里做兜底防御
        const list = (data && data.list) || [];
        const total = (data && data.total) || 0;
        console.log('[admin] 摄像头分页数据: rows=', list.length, 'total=', total);
        commit('setCameras', { list, total });
      } catch (e) {
        console.error('[admin] 加载摄像头列表失败:', e && e.message);
        commit('setCameras', { list: [], total: 0 });
      } finally {
        commit('setLoading', false);
      }
    },
  },
});
