// 파일 기반 영구 저장소. 저장소(git)에 커밋되어 버전 관리·감사 기록 역할을 함께 한다.
// - public: 사용자 화면이 읽는 발행물만(정적 호스팅으로 그대로 공개)
// - internal: 미발행 초안·검토 원문·수집 기록(암호화)
// - state: 잠금 등 비민감 운영 상태
// 다른 DB로 교체하려면 이 모듈의 함수 시그니처만 유지하면 된다.
import fs from 'node:fs';
import path from 'node:path';
import { publicDir, internalDir, stateDir } from './paths.js';
import { encrypt, decrypt, encryptionEnabled } from './crypto.js';

function ensureDir(p) { fs.mkdirSync(p, { recursive: true }); }

function atomicWrite(file, content) {
  ensureDir(path.dirname(file));
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, content);
  fs.renameSync(tmp, file);
}

function safeRel(rel) {
  const norm = path.posix.normalize(String(rel).replace(/\\/g, '/'));
  if (norm.startsWith('..') || path.isAbsolute(norm)) throw new Error(`잘못된 저장 경로: ${rel}`);
  return norm;
}

// ── public ──
export function readPublic(rel, fallback = null) {
  const f = path.join(publicDir(), safeRel(rel));
  if (!fs.existsSync(f)) return fallback;
  return JSON.parse(fs.readFileSync(f, 'utf8'));
}
export function writePublic(rel, obj) {
  atomicWrite(path.join(publicDir(), safeRel(rel)), `${JSON.stringify(obj, null, 2)}\n`);
}
export function listPublic(dir) {
  const d = path.join(publicDir(), safeRel(dir));
  return fs.existsSync(d) ? fs.readdirSync(d).filter((f) => f.endsWith('.json')).sort() : [];
}
export function existsPublic(rel) {
  return fs.existsSync(path.join(publicDir(), safeRel(rel)));
}

// ── internal ──
function internalFile(rel) {
  const r = safeRel(rel);
  return path.join(internalDir(), encryptionEnabled() ? `${r}.enc` : r);
}
export function readInternal(rel, fallback = null) {
  const f = internalFile(rel);
  if (!fs.existsSync(f)) return fallback;
  const raw = fs.readFileSync(f, 'utf8');
  return JSON.parse(encryptionEnabled() ? decrypt(raw) : raw);
}
export function writeInternal(rel, obj) {
  const json = JSON.stringify(obj, null, 2);
  atomicWrite(internalFile(rel), encryptionEnabled() ? encrypt(json) : `${json}\n`);
}
export function listInternal(dir) {
  const d = path.join(internalDir(), safeRel(dir));
  if (!fs.existsSync(d)) return [];
  const suffix = encryptionEnabled() ? '.json.enc' : '.json';
  return fs.readdirSync(d).filter((f) => f.endsWith(suffix)).map((f) => f.replace(/\.enc$/, '')).sort();
}

// ── state ──
export function readState(rel, fallback = null) {
  const f = path.join(stateDir(), safeRel(rel));
  if (!fs.existsSync(f)) return fallback;
  return JSON.parse(fs.readFileSync(f, 'utf8'));
}
export function writeState(rel, obj) {
  atomicWrite(path.join(stateDir(), safeRel(rel)), `${JSON.stringify(obj, null, 2)}\n`);
}
export function removeState(rel) {
  const f = path.join(stateDir(), safeRel(rel));
  if (fs.existsSync(f)) fs.unlinkSync(f);
}
