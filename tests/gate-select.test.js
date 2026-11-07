import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateGate } from '../src/pipeline/gate.js';
import { decide, scoreCandidate } from '../src/pipeline/select.js';
import { clusterArticles, rankClusters } from '../src/collect/cluster.js';
import { parseFeed } from '../src/collect/rss.js';
import { issueWindow } from '../src/lib/time.js';
import { loadPolicy } from '../src/lib/config.js';

const policy = loadPolicy();
const okFinal = { decision: 'publish', blockingIssues: [], companionIssues: [], remainingUncertainties: [], publicReviewSummary: '' };
const passChecklist = ['requirements_covered', 'no_internal_contradiction', 'fact_opinion_separated'].map((item) => ({ item, verdict: 'pass', note: '' }));
const issue = (type, severity, source = 'llm') => ({ type, severity, source, evidence: 'x', location: { paragraph: 1, quote: 'q' } });

test('게이트: 문제 없으면 발행 가능', () => {
  const g = evaluateGate({ openIssues: [], factcheck: { claims: [], factsSheetProblems: [] }, critique: { checklist: passChecklist }, final: okFinal, policy });
  assert.equal(g.publishable, true);
});

test('게이트: 중대한 사실 오류·핵심 모순·요구사항 미충족은 점수와 무관하게 차단', () => {
  for (const i of [issue('factual_error', 'critical'), issue('internal_contradiction', 'major'), issue('requirement_missing', 'major'), issue('fabricated_detail', 'major', 'code'), issue('length_out_of_range', 'major', 'code'), issue('status_misstated', 'major')]) {
    const g = evaluateGate({ openIssues: [i], factcheck: { claims: [], factsSheetProblems: [] }, critique: { checklist: passChecklist }, final: okFinal, policy });
    assert.equal(g.publishable, false, i.type);
  }
});

test('게이트: minor·비차단 major만 남으면 발행 가능(공개 검토 요약에 표시)', () => {
  const g = evaluateGate({ openIssues: [issue('style_clarity', 'minor'), issue('vague_conclusion', 'minor')], factcheck: { claims: [], factsSheetProblems: [] }, critique: { checklist: passChecklist }, final: okFinal, policy });
  assert.equal(g.publishable, true);
});

test('게이트: 출처와 어긋나거나 근거 없는 사실 진술, 사실표 오류, 필수 체크 실패·누락, 최종 보류, 최종 검토 누락은 차단', () => {
  const base = { openIssues: [], factcheck: { claims: [], factsSheetProblems: [] }, critique: { checklist: passChecklist }, final: okFinal, policy };
  assert.equal(evaluateGate({ ...base, factcheck: { claims: [{ kind: 'statistical', verdict: 'contradicted', quote: 'q', paragraph: 1 }], factsSheetProblems: [] } }).publishable, false);
  assert.equal(evaluateGate({ ...base, factcheck: { claims: [{ kind: 'attribution', verdict: 'unsupported', quote: 'q', paragraph: 1 }], factsSheetProblems: [] } }).publishable, false);
  assert.equal(evaluateGate({ ...base, factcheck: { claims: [{ kind: 'normative', verdict: 'not_a_factual_claim', quote: 'q', paragraph: 1 }], factsSheetProblems: [] } }).publishable, true);
  assert.equal(evaluateGate({ ...base, factcheck: { claims: [], factsSheetProblems: [{ factId: 'F1', problem: 'x', severity: 'major' }] } }).publishable, false);
  assert.equal(evaluateGate({ ...base, critique: { checklist: [{ item: 'no_internal_contradiction', verdict: 'fail', note: '' }] } }).publishable, false);
  assert.equal(evaluateGate({ ...base, critique: { checklist: [] } }).publishable, false);
  assert.equal(evaluateGate({ ...base, final: { ...okFinal, decision: 'hold' } }).publishable, false);
  assert.equal(evaluateGate({ ...base, final: null }).publishable, false);
});

const win = issueWindow('2026-11-08');
const tr = (id, o = {}) => ({
  clusterId: id, mergeInto: null, eventSummary: `사건 ${id}`, eventDate: '2026-11-07', eventDateBasis: '', timing: 'target_day', category: 'society', exclude: false, excludeReason: null,
  threadMatch: { threadId: null, relation: 'new', changeTypes: [], whatChanged: null, priorFactsPossiblyInvalidated: null, rationale: '' },
  scores: { publicSignificance: 4, valueConflict: 4, arguability: 4, evidenceAvailability: 4, conceptualTransfer: 4 }, essayAngles: [], scoreRationale: '', ...o,
});
const clustersById = (ids) => new Map(ids.map((id) => [id, { id, articleIds: [`a-${id}`] }]));

test('선정: 기사 수가 아니라 평가 점수, 후속 변화 유형, 날짜로 판단', () => {
  const triaged = [
    tr('new1'),
    tr('dup', { threadMatch: { threadId: 'th-1', relation: 'duplicate', changeTypes: ['none'], whatChanged: null, priorFactsPossiblyInvalidated: null, rationale: '' } }),
    tr('minor', { threadMatch: { threadId: 'th-1', relation: 'minor_update', changeTypes: ['none'], whatChanged: '노조 서명', priorFactsPossiblyInvalidated: null, rationale: '' } }),
    tr('follow', { threadMatch: { threadId: 'th-2', relation: 'meaningful_followup', changeTypes: ['policy_stage_change'], whatChanged: '의결', priorFactsPossiblyInvalidated: null, rationale: '' } }),
    tr('fakeFollow', { threadMatch: { threadId: 'th-3', relation: 'meaningful_followup', changeTypes: ['none'], whatChanged: '표현만 다름', priorFactsPossiblyInvalidated: null, rationale: '' } }),
    tr('old', { timing: 'earlier_already_reported' }),
    tr('late', { timing: 'earlier_missed', eventDate: '2026-11-06' }),
    tr('future', { timing: 'after_window' }),
    tr('low', { scores: { publicSignificance: 2, valueConflict: 2, arguability: 2, evidenceAvailability: 3, conceptualTransfer: 2 } }),
    tr('gossip', { exclude: true, excludeReason: '연예' }),
  ];
  const d = decide({ triaged, clustersById: clustersById(triaged.map((t) => t.clusterId)), recentCategories: [], policy: { ...policy, topics: { ...policy.topics, maxPerCategoryPerIssue: 9 } }, window: win });
  const by = Object.fromEntries(d.decisions.map((x) => [x.clusterId, x.decision]));
  assert.equal(by.new1, 'selected');
  assert.equal(by.follow, 'selected');
  assert.equal(by.dup, 'excluded');
  assert.equal(by.minor, 'follow_up_news');
  assert.equal(by.fakeFollow, 'follow_up_news');
  assert.equal(by.old, 'excluded');
  assert.equal(by.future, 'deferred');
  assert.equal(by.low, 'below_threshold');
  assert.equal(by.gossip, 'excluded');
  assert.ok(['selected', 'standby'].includes(by.late));
  const late = d.decisions.find((x) => x.clusterId === 'late');
  assert.ok(late.lateEntry && late.lateEntry.eventDate === '2026-11-06');
  assert.equal(d.minorUpdates.length, 1);
});

test('선정: 목표 개수를 채우려고 기준 미달 주제를 넣지 않는다', () => {
  const triaged = [tr('a'), tr('b', { scores: { publicSignificance: 1, valueConflict: 1, arguability: 1, evidenceAvailability: 1, conceptualTransfer: 1 } })];
  const d = decide({ triaged, clustersById: clustersById(['a', 'b']), recentCategories: [], policy, window: win });
  assert.equal(d.picks.length, 1);
});

test('선정: 최근 7일 특정 분야 쏠림이면 그 분야는 더 높은 기준을 요구', () => {
  const recent = ['economy', 'economy', 'economy', 'economy', 'economy', 'society', 'world'];
  const mid = { publicSignificance: 4, valueConflict: 3, arguability: 3, evidenceAvailability: 3, conceptualTransfer: 3 };
  const triaged = [tr('e', { category: 'economy', scores: mid }), tr('s', { category: 'scitech', scores: mid })];
  const d = decide({ triaged, clustersById: clustersById(['e', 's']), recentCategories: recent, policy, window: win });
  const by = Object.fromEntries(d.decisions.map((x) => [x.clusterId, x.decision]));
  assert.ok(scoreCandidate(triaged[0]) >= policy.topics.minSelectionScore);
  assert.equal(by.e, 'balance_skip');
  assert.equal(by.s, 'selected');
});

test('선정: 같은 사건 후보 병합(mergeInto)', () => {
  const triaged = [tr('x'), tr('y', { mergeInto: 'x' })];
  const d = decide({ triaged, clustersById: clustersById(['x', 'y']), recentCategories: [], policy, window: win });
  assert.equal(d.picks.length, 1);
  assert.deepEqual(d.picks[0].articleIds.sort(), ['a-x', 'a-y']);
});

test('기사 묶기: 제목이 달라도 같은 사건은 하나로, 이미 처리한 기사만 있는 묶음은 제외', () => {
  const mk = (id, title, group) => ({ id, title, group, lang: 'ko', sourceType: 'press', fetchable: true, publishedAtMs: Date.parse('2026-11-07T03:00:00Z'), hint: null });
  const arts = [
    mk('1', '국회, 노란봉투법 개정안 본회의 통과', 'a'),
    mk('2', '노란봉투법 개정안 국회 본회의 통과…경영계 반발', 'b'),
    mk('3', '서울 지하철 요금 인상 확정', 'c'),
  ];
  const cl = clusterArticles(arts);
  assert.equal(cl.length, 2);
  const ranked = rankClusters(cl, win, new Set(['3']));
  assert.equal(ranked.length, 1);
  assert.equal(ranked[0].independentGroups, 2);
});

test('RSS/Atom 파싱, DTD 엔티티 거부', () => {
  const rss = '<?xml version="1.0"?><rss><channel><item><title>제목 &amp; 부제</title><link>https://a.example/1</link><pubDate>Sat, 07 Nov 2026 10:00:00 +0900</pubDate><description><![CDATA[<p>요약</p>]]></description></item></channel></rss>';
  const items = parseFeed(rss);
  assert.equal(items[0].title, '제목 & 부제');
  assert.equal(items[0].description, '요약');
  const atom = '<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>A</title><link href="https://a.example/2"/><updated>2026-11-07T01:00:00Z</updated></entry></feed>';
  assert.equal(parseFeed(atom)[0].link, 'https://a.example/2');
  assert.throws(() => parseFeed('<!DOCTYPE x [<!ENTITY a "b">]><rss><channel></channel></rss>'), /DTD/);
});
