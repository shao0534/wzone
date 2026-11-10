import request from './request';

// 工具数据模型
export interface Tool {
  id: number;
  name: string;
  description: string;
  link: string;
  mdcode: string;
}

// 获取工具列表
export function getToolList() {
  return request.get<any, Tool[]>('/tool');
}
