// 찬반형 주제: 찬성·반대 답안을 각각 만들고, 통과한 쪽만 발행하며 빠진 쪽의 이유를 남긴다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { tempDataDir } from './helpers.js';
import { setMockHandler } from '../src/llm/index.js';
import { mockHandler } from '../src/eval/mock-llm.js';
import { makeFeedFetcher, fixtureArticleFetcher } from '../src/eval/fixture-feeds.js';
import { runDaily, runPublish } from '../src/pipeline/daily.js';
import { readPublic, listPublic, readInternal } from '../src/lib/store.js';
import { evaluateGate } from '../src/pipeline/gate.js';
import { loadPolicy } from '../src/lib/config.js';

const day = { fetcher: makeFeedFetcher(1), articleFetcher: fixtureArticleFetcher, trigger: 'test' };

test('찬반형: 입장별로 따로 설계·검토하고 통과한 답안만 싣는다', async () => {
  tempDataDir();
  process.env.NJ_MOCK_DEBATE = '1';
  const stages = [];
  setMockHandler(async (req) => { stages.push(req.stage); return mockHandler(req); });
  try {
    process.env.NJ_FAKE_NOW = '2026-11-08T06:10:00+09:00';
    assert.equal((await runDaily({ date: '2026-11-08', kind: 'scheduled', ...day })).outcome, 'ready');
    for (const s of ['design_pro', 'draft_pro', 'factcheck_pro_r0', 'design_con', 'draft_con', 'factcheck_con_r0', 'critique_con_r0', 'companion_con', 'final_con']) assert.ok(stages.includes(s), s);
    const prompts = [];
    setMockHandler(async (req) => { prompts.push(req.prompt); return mockHandler(req); });
    process.env.NJ_FAKE_NOW = '2026-11-08T09:00:30+09:00';
    await runPublish({ date: '2026-11-08' });
    const t = readPublic(`topics/${listPublic('topics')[0]}`);
    assert.equal(t.debate.proposition.includes('야간 운영 중단'), true);
    assert.deepEqual(t.answers.map((a) => a.key), ['con'], '검토를 통과한 반대 답안만');
    assert.equal(t.debate.omitted[0].key, 'pro');
    assert.match(t.debate.omitted[0].reason, /검토를 통과하지 못해/);
    assert.equal(t.answer.text, t.answers[0].answer.text, '대표 답안 = 통과한 답안');
    const iss = readPublic('issues/2026-11-08.json');
    assert.deepEqual(iss.topics[0].stances, ['반대 — 일괄 중단 대신 거점 유지']);
    const internal = readInternal(`topics/${t.id}.json`);
    assert.equal(internal.tracks.pro.status, 'held');
  } finally {
    delete process.env.NJ_MOCK_DEBATE;
    delete process.env.NJ_FAKE_NOW;
  }
});

test('사실·의견 혼재 지적만으로는 발행을 막지 않는다(사실 오류는 계속 차단)', () => {
  const policy = loadPolicy();
  const final = { decision: 'publish', blockingIssues: [], companionIssues: [], remainingUncertainties: [], publicReviewSummary: '' };
  const checklist = [{ item: 'requirements_covered', verdict: 'pass', note: '' }, { item: 'no_internal_contradiction', verdict: 'pass', note: '' }, { item: 'fact_opinion_separated', verdict: 'fail', note: '의견 섞임' }];
  assert.equal(evaluateGate({ openIssues: [{ type: 'fact_opinion_confusion', severity: 'major', source: 'llm', evidence: 'x' }], factcheck: { claims: [], factsSheetProblems: [] }, critique: { checklist }, final, policy }).publishable, true);
  assert.equal(evaluateGate({ openIssues: [], factcheck: { claims: [{ kind: 'factual', verdict: 'contradicted', quote: 'q', paragraph: 1 }], factsSheetProblems: [] }, critique: { checklist }, final, policy }).publishable, false);
});
