import test from 'node:test';
import assert from 'node:assert/strict';
import { kstDateOf, issueWindow, inPrimaryWindow, parseFeedDate, toKstIso, kstTimeMs, addDays } from '../src/lib/time.js';

test('UTC 시각을 한국 날짜로 변환하는 경계', () => {
  assert.equal(kstDateOf('2026-11-06T14:59:59Z'), '2026-11-06'); // KST 23:59:59
  assert.equal(kstDateOf('2026-11-06T15:00:00Z'), '2026-11-07'); // KST 00:00:00
  assert.equal(kstDateOf('2026-12-31T15:00:00Z'), '2027-01-01');
});

test('발행호 수집 대상 기간은 전날 00:00 이상 당일 00:00 미만(KST)', () => {
  const w = issueWindow('2026-11-07');
  assert.equal(w.primaryStart, '2026-11-06T00:00:00+09:00');
  assert.equal(w.primaryEnd, '2026-11-07T00:00:00+09:00');
  assert.equal(w.overlapStart, '2026-11-04T00:00:00+09:00');
  assert.equal(inPrimaryWindow(Date.parse('2026-11-05T15:00:00Z'), w), true); // 11-06 00:00 KST 포함
  assert.equal(inPrimaryWindow(Date.parse('2026-11-06T15:00:00Z'), w), false); // 11-07 00:00 KST 제외
  assert.equal(inPrimaryWindow(Date.parse('2026-11-05T14:59:59Z'), w), false);
});

test('해외 기사 시각(GMT, -05:00)을 한국 날짜로 판단', () => {
  // 뉴욕 11월 6일 오후 11시(EST) = 한국 11월 7일 오후 1시 → 11-08 발행호 대상
  const ms = parseFeedDate('Fri, 06 Nov 2026 23:00:00 -0500');
  assert.equal(toKstIso(ms), '2026-11-07T13:00:00+09:00');
  assert.equal(inPrimaryWindow(ms, issueWindow('2026-11-08')), true);
  assert.equal(inPrimaryWindow(ms, issueWindow('2026-11-07')), false);
  assert.equal(toKstIso(parseFeedDate('Fri, 06 Nov 2026 15:30:00 GMT')), '2026-11-07T00:30:00+09:00');
});

test('피드 시각 형식: KST 표기, 시간대 없는 ISO(기본 시간대 적용), 점 구분', () => {
  assert.equal(toKstIso(parseFeedDate('Fri, 06 Nov 2026 10:00:00 KST')), '2026-11-06T10:00:00+09:00');
  assert.equal(toKstIso(parseFeedDate('2026-11-06 10:00:00', '+09:00')), '2026-11-06T10:00:00+09:00');
  assert.equal(toKstIso(parseFeedDate('2026-11-06T10:00:00', '+00:00')), '2026-11-06T19:00:00+09:00');
  assert.equal(toKstIso(parseFeedDate('2026.11.06 10:00', '+09:00')), '2026-11-06T10:00:00+09:00');
  assert.equal(toKstIso(parseFeedDate('2026-11-06T10:00:00+09:00')), '2026-11-06T10:00:00+09:00');
  assert.equal(parseFeedDate('not a date'), null);
});

test('발행 시각 계산과 날짜 더하기(월말·윤년)', () => {
  assert.equal(toKstIso(kstTimeMs('2026-11-07', '09:00')), '2026-11-07T09:00:00+09:00');
  assert.equal(addDays('2028-02-28', 1), '2028-02-29');
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
});
