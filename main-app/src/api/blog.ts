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

// 获取博客详情(列表接口同样返回完整 context, 页面主要用列表数据)
export function getBlogDetail(id: number) {
  return request.get<any, Blog>(`/blog/${id}`);
}

export interface BlogPayload {
  title: string;
  context: string;
}

// 以下三个写操作由后端 requireAdmin 中间件校验, 普通用户会得到 403
export function createBlog(payload: BlogPayload) {
  return request.post<any, Blog>('/blog', payload);
}

export function updateBlog(id: number, payload: BlogPayload) {
  return request.put<any, Blog>(`/blog/${id}`, payload);
}

export function deleteBlog(id: number) {
  return request.delete<any, null>(`/blog/${id}`);
}
