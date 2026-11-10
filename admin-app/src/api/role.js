import request from './request';

// 获取全部按钮状态
export function getButtons() {
  return request.get('/role');
}
