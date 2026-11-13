// 认证接口
import request from './request';

export interface LoginUser {
  id: number;
  name: string;
  role: number;
  roleName: string;
}

export interface PublicKeyInfo {
  publicKey: string;
  algorithm: string;
  hash: string;
}

export interface LoginResult {
  token: string;
  user: LoginUser;
}

/** 获取 RSA 公钥(PEM/SPKI) */
export function getPublicKey() {
  return request.get<any, PublicKeyInfo>('/auth/public-key');
}

/** 登录: 仅提交密文, 用户名与密码不出现在请求体中 */
export function login(cipher: string) {
  return request.post<any, LoginResult>('/auth/login', { cipher });
}

/** 校验当前 token 并取回用户信息 */
export function fetchMe(token: string) {
  return request.get<any, LoginUser>('/auth/me', {
    headers: { Authorization: `Bearer ${token}` },
  });
}

/** 退出(服务端无状态, 主要用于通知) */
export function logoutApi() {
  return request.post<any, null>('/auth/logout');
}
