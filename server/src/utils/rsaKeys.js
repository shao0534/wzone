// RSA 密钥与登录态签名工具
// 1. 密钥对持久化在 server/.keys/(已被 .gitignore 忽略), 服务重启后已下发的公钥仍然有效
// 2. 前端用公钥 RSA-OAEP(SHA-256) 加密 { username, password }, 后端用私钥解密
// 3. 登录态是 HMAC-SHA256 签名的无状态 token, 服务端不保存会话
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const KEY_DIR = path.join(__dirname, '../../.keys');
const PRIVATE_FILE = path.join(KEY_DIR, 'rsa_private.pem');
const PUBLIC_FILE = path.join(KEY_DIR, 'rsa_public.pem');
const SECRET_FILE = path.join(KEY_DIR, 'token.secret');

const TOKEN_TTL_MS = 8 * 60 * 60 * 1000; // 8 小时

let cache = null;

function ensureKeys() {
  fs.mkdirSync(KEY_DIR, { recursive: true });

  if (!fs.existsSync(PRIVATE_FILE) || !fs.existsSync(PUBLIC_FILE)) {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    fs.writeFileSync(PRIVATE_FILE, privateKey, { mode: 0o600 });
    fs.writeFileSync(PUBLIC_FILE, publicKey, { mode: 0o644 });
    console.log('[auth] 已生成新的 RSA-2048 密钥对');
  }
  if (!fs.existsSync(SECRET_FILE)) {
    fs.writeFileSync(SECRET_FILE, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
  }

  return {
    privatePem: fs.readFileSync(PRIVATE_FILE, 'utf8'),
    publicPem: fs.readFileSync(PUBLIC_FILE, 'utf8'),
    tokenSecret: fs.readFileSync(SECRET_FILE, 'utf8').trim(),
  };
}

function keys() {
  if (!cache) cache = ensureKeys();
  return cache;
}

function getPublicKey() {
  return keys().publicPem;
}

/** 解密前端提交的 base64 密文, 返回明文 JSON 字符串 */
function decryptPayload(cipherBase64) {
  if (typeof cipherBase64 !== 'string' || cipherBase64.length > 4096) {
    throw new Error('密文格式无效');
  }
  const buf = Buffer.from(cipherBase64, 'base64');
  const plain = crypto.privateDecrypt(
    {
      key: keys().privatePem,
      padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: 'sha256',
    },
    buf
  );
  return plain.toString('utf8');
}

/** 签发 token: base64url(payload).base64url(HMAC) */
function signToken(payload) {
  const body = Buffer.from(
    JSON.stringify({ ...payload, exp: Date.now() + TOKEN_TTL_MS })
  ).toString('base64url');
  const sig = crypto.createHmac('sha256', keys().tokenSecret).update(body).digest('base64url');
  return `${body}.${sig}`;
}

/** 校验 token, 失败或过期返回 null */
function verifyToken(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  const [body, sig] = parts;
  const expected = crypto.createHmac('sha256', keys().tokenSecret).update(body).digest('base64url');
  if (sig.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!payload.exp || Date.now() > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

module.exports = { getPublicKey, decryptPayload, signToken, verifyToken };
