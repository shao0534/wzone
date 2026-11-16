import request from './request';

// 角色按钮数据模型(同一按钮可为两种角色分别配置)
export interface RoleButton {
  id: number;
  app: string;
  buttonKey: string;
  role: number; // 0 普通用户 / 1 管理员
  label: string;
  enabled: number;
}

// 当前登录用户视角的按钮可用 map(服务端按角色过滤, fail closed)
export interface ButtonMapInfo {
  role: number | null;
  buttons: Record<string, boolean>;
}

// 获取全部配置行(角色菜单页用)
export function getButtons() {
  return request.get<any, RoleButton[]>('/role');
}

// 获取当前角色视角的按钮可用 map(子应用按钮显隐的统一数据源)
export function getButtonMap() {
  return request.get<any, ButtonMapInfo>('/role/buttons');
}

// 更新按钮状态
export function updateButton(id: number, enabled: boolean) {
  return request.put<any, any>(`/role/${id}`, { enabled: enabled ? 1 : 0 });
}
