// 登录态 Store: token 存 localStorage, 刷新后向服务端校验有效性与角色
import { create } from 'zustand';
import { fetchMe } from '../api/auth';
import type { LoginUser } from '../api/auth';

const TOKEN_KEY = 'shuwu.auth.token';

interface AuthState {
  token: string;
  user: LoginUser | null;
  ready: boolean;
  setSession: (token: string, user: LoginUser) => void;
  clear: () => void;
  restore: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  token: localStorage.getItem(TOKEN_KEY) || '',
  user: null,
  ready: false,

  setSession: (token, user) => {
    localStorage.setItem(TOKEN_KEY, token);
    set({ token, user, ready: true });
  },

  clear: () => {
    localStorage.removeItem(TOKEN_KEY);
    set({ token: '', user: null, ready: true });
  },

  restore: async () => {
    const token = get().token;
    if (!token) {
      set({ ready: true, user: null });
      return;
    }
    try {
      const user = await fetchMe(token);
      set({ user, ready: true });
    } catch {
      // token 过期/被篡改 -> 清理并回到登录页
      localStorage.removeItem(TOKEN_KEY);
      set({ token: '', user: null, ready: true });
    }
  },
}));
