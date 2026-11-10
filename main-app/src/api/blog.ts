import request from './request';

// 博客数据模型
export interface Blog {
  id: number;
  title: string;
  context: string;
  dateTime: string;
}

// 获取博客列表
export function getBlogList() {
  return request.get<any, Blog[]>('/blog');
}

// 获取博客详情
export function getBlogDetail(id: number) {
  return request.get<any, Blog>(`/blog/${id}`);
}
