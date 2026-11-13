// 密码哈希工具(Node 内置 scrypt, 无第三方依赖)
// 存储格式: scrypt$<saltHex>$<hashHex>; 每个用户独立随机盐
const crypto = require('crypto');

const N = 16384;
const R = 8;
const P = 1;
const KEY_LEN = 64;
const OPTS = { N, r: R, p: P, maxmem: 64 * 1024 * 1024 };

/** 生成加盐哈希 */
function hashPassword(plain, salt = crypto.randomBytes(16).toString('hex')) {
  const derived = crypto
    .scryptSync(String(plain), Buffer.from(salt, 'hex'), KEY_LEN, OPTS)
    .toString('hex');
  return `scrypt$${salt}$${derived}`;
}

/** 恒定时间比较, 防止时序侧信道 */
function verifyPassword(plain, stored) {
  try {
    const [alg, salt, expectedHex] = String(stored || '').split('$');
    if (alg !== 'scrypt' || !salt || !expectedHex) return false;
    const expected = Buffer.from(expectedHex, 'hex');
    const derived = crypto.scryptSync(String(plain), Buffer.from(salt, 'hex'), expected.length, OPTS);
    return expected.length === derived.length && crypto.timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}

module.exports = { hashPassword, verifyPassword };
