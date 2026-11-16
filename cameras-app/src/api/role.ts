import request from './request';

// 角色按钮模型(role_button 全量配置行, 角色菜单页用不到, 这里仅类型描述)
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

// 获取当前角色视角的按钮可用 map(键: `${app}.${buttonKey}` -> 是否可用)
export function getButtonMap() {
  return request.get<any, ButtonMapInfo>('/role/buttons');
}
