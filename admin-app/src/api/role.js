import request from './request';

// 当前登录用户视角的按钮可用 map(服务端按角色过滤, fail closed)
// 键: `${app}.${buttonKey}` -> 是否可用; 是按钮显隐的统一数据源
export function getButtonMap() {
  return request.get('/role/buttons');
}
