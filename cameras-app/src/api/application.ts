import request from './request';

// 提交按钮状态修改申请
export interface ApplyParams {
  app: string;
  buttonKey: string;
  buttonLabel: string;
  requestAction: number; // 1 启用 / 0 禁用
  reason: string;
}

export function submitApplication(params: ApplyParams) {
  return request.post<any, any>('/application', params);
}
