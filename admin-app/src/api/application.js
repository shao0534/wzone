import request from './request';

// 提交按钮状态修改申请
export function submitApplication(data) {
  return request.post('/application', data);
}
