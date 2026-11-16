import request from './request';

// 申请数据模型
export interface Application {
  id: number;
  app: string;
  buttonKey: string;
  buttonLabel: string;
  applicant: string; // 申请人(服务端从 token 解出)
  role: number; // 申请者角色 0 普通用户 / 1 管理员(服务端从 token 解出)
  requestAction: number;
  reason: string;
  status: number;
  createdAt: string;
}

// 获取申请列表
export function getApplications() {
  return request.get<any, Application[]>('/application');
}

// 审核申请(status: 1 通过 / 2 拒绝)
export function reviewApplication(id: number, status: number) {
  return request.put<any, any>(`/application/${id}`, { status });
}
