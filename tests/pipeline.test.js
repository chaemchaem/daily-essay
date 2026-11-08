// 전체 흐름 통합 테스트: 실제 파이프라인 코드를 가상 피드 + LLM 대역으로 실행한다.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tempDataDir } from './helpers.js';
import { setMockHandler } from '../src/llm/index.js';
import { mockHandler } from '../src/eval/mock-llm.js';
import { makeFeedFetcher, fixtureArticleFetcher } from '../src/eval/fixture-feeds.js';
import { runDaily, runPublish, findMissingDates } from '../src/pipeline/daily.js';
import { applyCorrection, writeStatus } from '../src/publish/publish.js';
import { readPublic, listPublic, readInternal, writeInternal, listInternal } from '../src/lib/store.js';
import { writeState } from '../src/lib/store.js';
import * as F from '../src/eval/fixture-data.js';

const D1 = '2026-11-08';
const D2 = '2026-11-09';
const at = (iso) => { process.env.NJ_FAKE_NOW = iso; };
let stageCalls = [];
function useMock(override) {
  stageCalls = [];
  setMockHandler(async (req) => {
    stageCalls.push(req.stage);
    if (override) { const r = await override(req); if (r !== undefined) return r; }
    return mockHandler(req);
  });
}
const day = (n, extra = {}) => ({ fetcher: makeFeedFetcher(n), articleFetcher: fixtureArticleFetcher, trigger: 'test', ...extra });
const publicTopics = () => listPublic('topics');

test('정상 흐름: 06시 생성 → 09시 이전엔 비공개 → 09시 발행, 재실행해도 중복 없음', async () => {
  tempDataDir();
  useMock();
  at('2026-11-08T06:10:00+09:00');
  const r1 = await runDaily({ date: D1, kind: 'scheduled', ...day(1) });
  assert.equal(r1.outcome, 'ready');
  assert.equal(publicTopics().length, 0, '발행 시각 전에는 공개하지 않음');
  assert.equal(readPublic(`issues/${D1}.json`), null);
  for (const s of ['facts', 'question', 'design', 'draft', 'factcheck_r0', 'critique_r0', 'revise_r1', 'factcheck_r1', 'critique_r1', 'companion', 'final']) assert.ok(stageCalls.includes(s), `단계 ${s} 실행`);

  at('2026-11-08T08:59:00+09:00');
  assert.equal((await runPublish({ date: D1 })).reason, 'not_due');
  at('2026-11-08T09:00:30+09:00');
  assert.equal((await runPublish({ date: D1 })).published, 1);
  const files = publicTopics();
  assert.equal(files.length, 1);
  const pub = readPublic(`topics/${files[0]}`);
  assert.equal(pub.test, true);
  assert.equal(pub.answer.text, F.LIB_ANSWER, '수정된 최종 답안이 발행됨');
  assert.ok(!pub.answer.text.includes('모두의 관심과 노력이 필요하다'), '초안 문장은 공개되지 않음');
  for (const k of ['rounds', 'calls', 'stages', 'sourcePack', 'cluster']) assert.equal(pub[k], undefined, `내부 필드 ${k} 비공개`);
  assert.equal(pub.review.revisions.length, 1, '실제 수정 내용 공개');
  assert.ok(pub.sources.every((s) => s.url && s.publishedAt && s.access), '출처 메타데이터');
  assert.ok(pub.claims.length > 0, '주장–출처 연결');
  assert.equal(pub.dates.publishedAt, '2026-11-08T09:00:30+09:00');
  assert.equal(pub.dates.window.start, '2026-11-07T00:00:00+09:00');

  const again = await runDaily({ date: D1, kind: 'scheduled', ...day(1) });
  assert.equal(again.outcome, 'already_published');
  stageCalls = [];
  const retry = await runDaily({ date: D1, kind: 'retry', ...day(1) });
  assert.equal(retry.outcome, 'published');
  assert.equal(stageCalls.length, 0, '이미 끝난 주제는 다시 생성하지 않음');
  assert.equal(publicTopics().length, 1);
  assert.equal(readInternal(`issues/${D1}.json`).topicIds.length, 1);

  // 수집 실패 → 직전 정상 발행호 유지, 실패 상태는 '주제 없음'과 구분
  at('2026-11-09T06:10:00+09:00');
  const fail = await runDaily({ date: D2, kind: 'scheduled', fetcher: async () => ({ status: 500, text: '' }), articleFetcher: fixtureArticleFetcher, trigger: 'test' });
  assert.equal(fail.outcome, 'failed_collect');
  assert.equal(publicTopics().length, 1);
  at('2026-11-09T09:20:00+09:00');
  const st = writeStatus();
  assert.equal(st.today.state, 'failed_collect');
  assert.equal(st.lastSuccessfulPublish.date, D1);
  assert.ok(findMissingDates().some((m) => m.date === D2 && m.reason === 'failed_collect'));

  // 재시도: 실패 지점(수집)부터 다시 — 이번에는 수정 상한 내 해결되지 않는 주제가 보류되고 후속 소식이 연결됨
  const re = await runDaily({ date: D2, kind: 'retry', ...day(2) });
  assert.equal(re.outcome, 'all_held');
  const iss2 = readPublic(`issues/${D2}.json`);
  assert.equal(iss2.state, 'all_held');
  assert.equal(iss2.counts.held, 1);
  assert.equal(iss2.followUpNews.length, 1, '새 문제가 필요 없는 변화는 후속 소식으로');
  const held = readInternal(`topics/${readInternal(`issues/${D2}.json`).topicIds[0]}.json`);
  assert.equal(held.status, 'held');
  assert.equal(held.tracks.main.rounds.length, 3, '수정 상한(2회) 후 보류');
  assert.ok(!publicTopics().some((f) => f.includes('나래시')), '보류 원고는 공개되지 않음');
  const th = readPublic(`threads/${pub.threadId}.json`);
  assert.equal(th.updates.length, 1);

  // 정정: 이전 버전 보관 + 이력
  const corr = applyCorrection({ topicId: pub.id, reason: '테스트 정정', replaceAnswerText: `${F.LIB_ANSWER}\n\n(정정 테스트 문장)`, by: 'test' });
  assert.equal(corr.version, 2);
  const v2 = readPublic(`topics/${pub.id}.json`);
  assert.equal(v2.version, 2);
  assert.equal(v2.corrections.length, 1);
  assert.equal(readPublic(`topics/${pub.id}/v1.json`).answer.text, F.LIB_ANSWER);
});

test('LLM 오류 → 실패 지점부터 재개(앞 단계 재호출 없음)', async () => {
  tempDataDir();
  let failOnce = true;
  useMock(async (req) => { if (req.stage === 'design' && failOnce) { failOnce = false; throw new Error('일시 오류(테스트)'); } return undefined; });
  at('2026-11-08T06:10:00+09:00');
  const r = await runDaily({ date: D1, kind: 'scheduled', ...day(1) });
  assert.equal(r.outcome, 'failed_generation');
  const id = readInternal(`issues/${D1}.json`).topicIds[0];
  assert.equal(readInternal(`topics/${id}.json`).error.stage, 'design');
  stageCalls = [];
  const r2 = await runDaily({ date: D1, kind: 'retry', ...day(1) });
  assert.equal(r2.outcome, 'ready');
  assert.ok(!stageCalls.includes('facts') && !stageCalls.includes('question') && !stageCalls.some((s) => s.startsWith('triage')), '완료된 단계는 다시 호출하지 않음');
  assert.ok(stageCalls.includes('design'));
});

test('잠금: 다른 실행이 보유 중이면 중단, 만료된 잠금은 회수', async () => {
  tempDataDir();
  useMock();
  at('2026-11-08T06:10:00+09:00');
  const now = Date.parse('2026-11-08T06:10:00+09:00');
  writeState('lock.json', { runId: 'other', purpose: 'x', expiresAtMs: now + 3600000, expiresAt: 'x' });
  assert.equal((await runDaily({ date: D1, kind: 'scheduled', ...day(1) })).outcome, 'lock_held');
  writeState('lock.json', { runId: 'other', purpose: 'x', expiresAtMs: now - 1000, expiresAt: 'x' });
  assert.equal((await runDaily({ date: D1, kind: 'scheduled', ...day(1) })).outcome, 'ready');
});

test('비용 상한: 검토를 생략하지 않고 주제 작성을 보류', async () => {
  tempDataDir();
  useMock();
  process.env.NJ_DAILY_USD_CAP = '2';
  at('2026-11-08T06:10:00+09:00');
  try {
    const r = await runDaily({ date: D1, kind: 'scheduled', ...day(1) });
    assert.equal(r.outcome, 'budget_deferred');
    assert.ok(!stageCalls.some((s) => s.startsWith('facts') || s.startsWith('draft') || s.startsWith('factcheck')));
  } finally {
    delete process.env.NJ_DAILY_USD_CAP;
  }
});

test('일시 중지: 예약 실행은 건너뛰고 수동 실행은 가능', async () => {
  tempDataDir();
  useMock();
  process.env.NJ_PAUSED = 'true';
  at('2026-11-08T06:10:00+09:00');
  try {
    assert.equal((await runDaily({ date: D1, kind: 'scheduled', ...day(1) })).outcome, 'paused');
    assert.equal(writeStatus().paused, true);
    assert.equal((await runDaily({ date: D1, kind: 'manual', ...day(1) })).outcome, 'ready');
  } finally {
    delete process.env.NJ_PAUSED;
  }
});

test('누락 날짜 복구: 정보 기준 시점을 원래 발행 시각으로 고정하고 복구 표시', async () => {
  tempDataDir();
  useMock();
  at('2026-11-10T13:00:00+09:00');
  assert.ok(findMissingDates().some((m) => m.date === D1 && m.reason === 'no_record'));
  const r = await runDaily({ date: D1, kind: 'recover', ...day(1) });
  assert.equal(r.outcome, 'published');
  const iss = readInternal(`issues/${D1}.json`);
  assert.equal(iss.recovered, true);
  assert.equal(iss.infoCutoff, '2026-11-08T09:00:00+09:00');
  const pub = readPublic(`topics/${publicTopics()[0]}`);
  assert.ok(pub.dates.recovered);
  assert.equal(pub.dates.infoCutoff, '2026-11-08T09:00:00+09:00');
  assert.notEqual(pub.dates.publishedAt.slice(0, 10), D1, '실제 생성·발행 시점은 원래 날짜와 구분');
});

test('내부 기록 암호화: 키가 있으면 평문이 디스크에 남지 않음', () => {
  const d = tempDataDir();
  process.env.NJ_INTERNAL_KEY = 'test-key-0123456789-abcdefghij';
  try {
    writeInternal('topics/x.json', { secret: '미발행 초안 문장' });
    const f = path.join(d, 'internal', 'topics', 'x.json.enc');
    assert.ok(fs.existsSync(f));
    assert.ok(!fs.readFileSync(f, 'utf8').includes('미발행'));
    assert.deepEqual(readInternal('topics/x.json'), { secret: '미발행 초안 문장' });
    assert.deepEqual(listInternal('topics'), ['x.json']);
  } finally {
    delete process.env.NJ_INTERNAL_KEY;
  }
});
