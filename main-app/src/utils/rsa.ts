// 登录凭据加密: WebCrypto RSA-OAEP(SHA-256), 与服务端 rsaKeys.js 对应
// 不引入第三方加密库, 依赖浏览器原生 SubtleCrypto(需要 localhost 或 HTTPS 安全上下文)
let cachedPem = '';
let cachedKey: CryptoKey | null = null;

/** PEM(SPKI) -> DER(ArrayBuffer) */
function pemToArrayBuffer(pem: string): ArrayBuffer {
  const base64 = pem
    .replace(/-----BEGIN PUBLIC KEY-----/g, '')
    .replace(/-----END PUBLIC KEY-----/g, '')
    .replace(/\s+/g, '');
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

/** 用服务端下发的公钥加密凭据对象, 返回 base64 密文 */
export async function encryptCredentials(
  publicKeyPem: string,
  payload: Record<string, unknown>
): Promise<string> {
  if (!globalThis.crypto?.subtle) {
    throw new Error('当前环境不支持 WebCrypto，请通过 localhost 或 HTTPS 访问');
  }
  if (!publicKeyPem) throw new Error('未获取到加密公钥');

  if (cachedKey === null || cachedPem !== publicKeyPem) {
    cachedKey = await crypto.subtle.importKey(
      'spki',
      pemToArrayBuffer(publicKeyPem),
      { name: 'RSA-OAEP', hash: 'SHA-256' },
      false,
      ['encrypt']
    );
    cachedPem = publicKeyPem;
  }

  const plain = new TextEncoder().encode(JSON.stringify(payload));
  // RSA-2048 + OAEP-SHA256 单次明文上限 190 字节
  if (plain.byteLength > 190) throw new Error('凭据内容过长');
  const cipher = await crypto.subtle.encrypt({ name: 'RSA-OAEP' }, cachedKey, plain);
  return toBase64(cipher);
}
