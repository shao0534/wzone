// 认证业务: 种子用户、登录校验、登录态解析
const pool = require('../config/db');
const { hashPassword, verifyPassword } = require('../utils/password');
const { decryptPayload, signToken, verifyToken } = require('../utils/rsaKeys');

// 初始用户: 密码统一 shuwu, 仅在用户不存在时创建, 不覆盖已有密码
const SEED_USERS = [
  { name: 'test01', password: 'shuwu', role: 0 },
  { name: 'root01', password: 'shuwu', role: 1 },
];

const DUMMY_HASH = hashPassword('invalid-user-dummy');

// 简单暴力破解防护: 同一 IP 连续失败 5 次后锁定 60s
const MAX_FAILURES = 5;
const LOCK_MS = 60 * 1000;
const failures = new Map();

class AuthError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

function roleName(role) {
  return Number(role) === 1 ? '管理员' : '普通用户';
}

/** 幂等初始化两个种子用户; targetPool 可传独立连接(init-db 用) */
async function ensureSeedUsers(targetPool = pool) {
  for (const u of SEED_USERS) {
    const [rows] = await targetPool.query('SELECT id, role FROM sys_user WHERE name = ? LIMIT 1', [u.name]);
    if (rows.length === 0) {
      await targetPool.query(
        'INSERT INTO sys_user (name, pwd, role) VALUES (?, ?, ?)',
        [u.name, hashPassword(u.password), u.role]
      );
    } else if (Number(rows[0].role) !== u.role) {
      await targetPool.query('UPDATE sys_user SET role = ? WHERE id = ?', [u.role, rows[0].id]);
    }
  }
}

function assertNotLocked(ip) {
  const rec = failures.get(ip);
  if (rec && rec.lockedUntil > Date.now()) {
    const seconds = Math.ceil((rec.lockedUntil - Date.now()) / 1000);
    throw new AuthError(`尝试次数过多，请 ${seconds} 秒后重试`, 429);
  }
}

function recordFailure(ip) {
  const rec = failures.get(ip);
  const count = rec && rec.lockedUntil <= Date.now() ? 0 : rec ? rec.count : 0;
  const next = count + 1;
  failures.set(ip, {
    count: next,
    lockedUntil: next >= MAX_FAILURES ? Date.now() + LOCK_MS : 0,
  });
}

function clearFailures(ip) {
  failures.delete(ip);
}

/**
 * 登录: cipher 为前端 RSA-OAEP 加密后的 base64 密文
 * 明文格式: { "username": "...", "password": "...", "ts": 时间戳 }
 */
async function login(cipher, ip = 'unknown') {
  assertNotLocked(ip);

  let payload;
  try {
    payload = JSON.parse(decryptPayload(cipher));
  } catch {
    recordFailure(ip);
    throw new AuthError('密文无效或公钥已更新，请刷新页面重试');
  }

  const username = String(payload.username || '').trim();
  const password = String(payload.password || '');
  if (!username || !password || username.length > 64 || password.length > 128) {
    recordFailure(ip);
    throw new AuthError('用户名或密码格式不正确');
  }

  const [rows] = await pool.query('SELECT id, name, pwd, role FROM sys_user WHERE name = ? LIMIT 1', [username]);
  const user = rows[0];
  // 即使用户不存在也做一次等价开销的哈希校验, 避免通过响应时间枚举用户名
  const matched = verifyPassword(password, user ? user.pwd : DUMMY_HASH);
  if (!user || !matched) {
    recordFailure(ip);
    throw new AuthError('用户名或密码错误', 401);
  }

  clearFailures(ip);
  const token = signToken({ uid: user.id, name: user.name, role: Number(user.role) });
  return {
    token,
    user: { id: user.id, name: user.name, role: Number(user.role), roleName: roleName(user.role) },
  };
}

/** 解析 Authorization: Bearer <token>, 并回查用户是否仍存在/角色是否变化 */
async function currentUser(token) {
  const payload = verifyToken(token);
  if (!payload || !payload.name) return null;
  const [rows] = await pool.query('SELECT id, name, role FROM sys_user WHERE name = ? LIMIT 1', [payload.name]);
  if (!rows.length) return null;
  const u = rows[0];
  return { id: u.id, name: u.name, role: Number(u.role), roleName: roleName(u.role) };
}

module.exports = { ensureSeedUsers, login, currentUser, AuthError, roleName };
