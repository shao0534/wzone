import Vue from 'vue';
import Vuex from 'vuex';
import { getButtons } from '../api/role';
import { getCameras } from '../api/camera';
import { onButtonsChange, onActiveTabChange, getGlobalButtons } from '../micro';

Vue.use(Vuex);

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
    // 判断管理后端某按钮是否可用(默认可用)
    can: (state) => (key) => state.buttons[`admin.${key}`] !== false,
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
    async initButtons({ dispatch }) {
      // 防重复初始化(常驻挂载 + HMR 场景下 created 可能执行多次, 避免重复注册监听)
      if (initButtons._done) return;
      initButtons._done = true;

      await dispatch('loadButtons');
      onButtonsChange((g) => { this.commit('setButtons', g); });
      const g = getGlobalButtons();
      if (Object.keys(g).length) this.commit('setButtons', g);
      // 监听主应用切换标签: 当管理后端变为激活时重新分页拉取(每页 10 条)
      onActiveTabChange((tab) => {
        if (tab === 'admin') dispatch('fetchCameras');
      });
    },

    async loadButtons({ commit }) {
      const list = await getButtons();
      const map = {};
      list.forEach((b) => { map[`${b.app}.${b.buttonKey}`] = b.enabled === 1; });
      commit('setButtons', map);
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
