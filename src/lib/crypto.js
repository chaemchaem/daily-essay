// 내부 운영 기록(미발행 초안, 검토 원문, 수집 기사 메타) 암호화.
// 공개 저장소에 커밋해도 내용이 노출되지 않도록 AES-256-GCM으로 저장한다.
import crypto from 'node:crypto';

const SALT = 'nonjeom-internal-v1';
let cachedKey = null;
let cachedSecret = null;

function key() {
  const secret = process.env.NJ_INTERNAL_KEY;
  if (!secret) return null;
  if (secret.length < 24) throw new Error('NJ_INTERNAL_KEY는 24자 이상이어야 합니다.');
  if (secret !== cachedSecret) {
    cachedKey = crypto.scryptSync(secret, SALT, 32);
    cachedSecret = secret;
  }
  return cachedKey;
}

export function encryptionEnabled() {
  return Boolean(process.env.NJ_INTERNAL_KEY);
}

export function encrypt(plaintext) {
  const k = key();
  if (!k) throw new Error('암호화 키 없음');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', k, iv);
  const data = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return JSON.stringify({ v: 1, alg: 'aes-256-gcm', iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') });
}

export function decrypt(envelope) {
  const k = key();
  if (!k) throw new Error('암호화된 내부 기록을 읽으려면 NJ_INTERNAL_KEY가 필요합니다.');
  const e = JSON.parse(envelope);
  const decipher = crypto.createDecipheriv('aes-256-gcm', k, Buffer.from(e.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(e.tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(e.data, 'base64')), decipher.final()]).toString('utf8');
}

export function sha1(s) {
  return crypto.createHash('sha1').update(String(s)).digest('hex');
}
export function sha256(s) {
  return crypto.createHash('sha256').update(String(s)).digest('hex');
}
