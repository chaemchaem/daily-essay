// 작업 잠금. 만료 시각을 두어 비정상 종료된 실행이 영구히 잠금을 쥐지 않게 한다.
// GitHub Actions에서는 workflow concurrency 그룹이 1차 방어선이고, 이 잠금은 로컬·다른 호스트 실행까지 포함한 2차 방어선이다.
import { readState, writeState, removeState } from './store.js';
import { nowMs, toKstIso } from './time.js';

const FILE = 'lock.json';

export class LockHeldError extends Error {}

export function acquireLock({ runId, ttlMinutes, purpose }) {
  const now = nowMs();
  const cur = readState(FILE);
  if (cur && cur.expiresAtMs > now && cur.runId !== runId) {
    throw new LockHeldError(`다른 실행(${cur.runId}, ${cur.purpose})이 ${toKstIso(cur.expiresAtMs)}까지 잠금을 보유 중입니다.`);
  }
  const lock = {
    runId, purpose, host: process.env.GITHUB_RUN_ID ? `github-actions:${process.env.GITHUB_RUN_ID}` : `local:${process.pid}`,
    acquiredAt: toKstIso(now), expiresAtMs: now + ttlMinutes * 60000, expiresAt: toKstIso(now + ttlMinutes * 60000),
    recoveredFrom: cur && cur.expiresAtMs <= now ? { runId: cur.runId, expiredAt: cur.expiresAt } : null,
  };
  writeState(FILE, lock);
  return lock;
}

export function refreshLock({ runId, ttlMinutes }) {
  const cur = readState(FILE);
  if (!cur || cur.runId !== runId) return;
  const now = nowMs();
  cur.expiresAtMs = now + ttlMinutes * 60000;
  cur.expiresAt = toKstIso(cur.expiresAtMs);
  writeState(FILE, cur);
}

export function releaseLock(runId) {
  const cur = readState(FILE);
  if (cur && cur.runId === runId) removeState(FILE);
}

export function currentLock() {
  return readState(FILE);
}
