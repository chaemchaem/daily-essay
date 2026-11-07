import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const CONFIG_DIR = path.join(PKG_ROOT, 'config');

export function dataDir() {
  return process.env.NJ_DATA_DIR ? path.resolve(process.env.NJ_DATA_DIR) : path.join(PKG_ROOT, 'data');
}
export const publicDir = () => path.join(dataDir(), 'public');
/** 내부 운영 기록. 암호화 키가 있으면 data/internal/*.enc 로 저장(커밋 가능), 없으면 data/internal-local(커밋 제외). */
export const internalDir = () => path.join(dataDir(), process.env.NJ_INTERNAL_KEY ? 'internal' : 'internal-local');
export const stateDir = () => path.join(dataDir(), 'state');
export const scratchDir = () => path.join(dataDir(), 'tmp');
