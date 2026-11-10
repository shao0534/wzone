import request from './request';

// 角色按钮数据模型
export interface RoleButton {
  id: number;
  app: string;
  buttonKey: string;
  label: string;
  enabled: number;
}

// 获取全部按钮状态
export function getButtons() {
  return request.get<any, RoleButton[]>('/role');
}

// 更新按钮状态
export function updateButton(id: number, enabled: boolean) {
  return request.put<any, any>(`/role/${id}`, { enabled: enabled ? 1 : 0 });
}
