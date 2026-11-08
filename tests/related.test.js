// 같은 사건의 다른 언론사 기사 찾기·묶기, 무관 출처 처리, 근거 부족 보류 재시도
import test from 'node:test';
import assert from 'node:assert/strict';
import { wordTokens } from '../src/lib/text.js';
import { clusterArticles } from '../src/collect/cluster.js';
import { findRelated } from '../src/pipeline/related.js';
import { checkFacts } from '../src/pipeline/checks.js';
import { loadPolicy } from '../src/lib/config.js';
import * as F from '../src/eval/fixture-data.js';
import { tempDataDir } from './helpers.js';
import { setMockHandler } from '../src/llm/index.js';
import { mockHandler } from '../src/eval/mock-llm.js';
import { makeFeedFetcher, fixtureArticleFetcher } from '../src/eval/fixture-feeds.js';
import { runDaily } from '../src/pipeline/daily.js';
import { readInternal } from '../src/lib/store.js';

const art = (id, title, group, extra = {}) => ({ id, title, group, lang: 'ko', sourceType: 'press', fetchable: true, publishedAtMs: Date.parse('2026-11-07T03:00:00Z'), hint: null, ...extra });

test('핵심어: 조사와 흔한 단어를 떼어 낸다', () => {
  const w = wordTokens('[속보] 국민의힘이 서울 도심에서 조작기소 특검법을 규탄했다');
  for (const x of ['국민의힘', '서울', '도심', '조작기소', '특검법']) assert.ok(w.has(x), x);
  assert.ok(!w.has('속보'));
});

test('묶기: 언론사마다 제목이 달라도 핵심어가 많이 겹치면 같은 사건으로', () => {
  const cl = clusterArticles([
    art('1', '국민의힘, 서울 도심서 조작기소 특검법 규탄 장외집회', 'a'),
    art('2', "국힘 장외집회…'조작기소 특검법 강행 처리' 규탄", 'b'),
    art('3', '양대 노총, 특구법 철회 전국노동자대회 개최', 'c'),
  ]);
  assert.equal(cl.length, 2);
  assert.equal(cl.find((c) => c.articleIds.includes('1')).articleIds.length, 2);
});

test('관련 기사 찾기: 다른 언론사의 같은 사건 기사를 보강하고 무관 기사는 제외', () => {
  const seed = [art('s1', '젤렌스키 "러 공습에 북한제 KN-23 미사일 사용"', 'yonhap')];
  const all = [
    ...seed,
    art('r1', '우크라 "러시아 에너지시설 공습에 북한제 KN-23 미사일"', 'hani'),
    art('r2', '젤렌스키, 북한제 미사일 사용 주장…에너지 시설 피해', 'khan'),
    art('r3', '젤렌스키 북한제 미사일 공습 주장 재확인', 'hani'),
    art('x1', '서울 지하철 요금 인상 확정', 'donga'),
    art('g1', '젤렌스키 "북한제 KN-23 미사일 사용" - 테스트일보', 'outlet:test', { sourceType: 'aggregator', fetchable: false }),
  ];
  const got = findRelated({ seedArticles: seed, eventSummary: '젤렌스키 대통령은 러시아 공습에 북한제 KN-23 미사일이 사용되었다고 밝혔다', all, max: 6 }).map((a) => a.id);
  assert.ok(got.includes('r1') && got.includes('r2'));
  assert.ok(!got.includes('x1'));
  assert.equal(got.filter((x) => ['r1', 'r3'].includes(x)).length, 1, '같은 언론사는 1건만');
  assert.ok(got.indexOf('g1') > got.indexOf('r2'), '본문 조회 가능한 기사 우선');
});

test('사실 정리: 무관으로 표시된 출처는 근거와 독립성 계산에서 빠진다', () => {
  const policy = loadPolicy();
  const pack = [{ sid: 'S1', group: 'a', sourceType: 'press', accessLevel: 'full_text' }, { sid: 'S2', group: 'b', sourceType: 'press', accessLevel: 'full_text' }];
  const facts = { ...F.LIB_FACTS, facts: [{ id: 'F1', statement: 'x', kind: 'confirmed', attributedTo: null, sourceIds: ['S1', 'S2'], asOf: null, accessBasis: 'full_text' }], sourceNotes: [{ sourceId: 'S2', independence: 'unrelated_to_event', sameOriginAs: null, note: '' }] };
  const r = checkFacts({ facts, sourcePack: pack, policy });
  assert.deepEqual(r.facts.facts[0].sourceIds, ['S1']);
  assert.equal(r.independence.independentGroups, 1);
});

test('근거 부족 보류는 관리자가 요청할 때만 사실 정리부터 다시 한다', async () => {
  tempDataDir();
  let thin = true;
  setMockHandler(async (req) => {
    if (req.stage === 'facts' && thin) { thin = false; return { ...F.LIB_FACTS, suitability: { enoughEvidence: false, reason: '테스트: 자료 부족' } }; }
    return mockHandler(req);
  });
  process.env.NJ_FAKE_NOW = '2026-11-08T06:10:00+09:00';
  const day = { fetcher: makeFeedFetcher(1), articleFetcher: fixtureArticleFetcher, trigger: 'test' };
  assert.equal((await runDaily({ date: '2026-11-08', kind: 'scheduled', ...day })).outcome, 'all_held');
  assert.equal((await runDaily({ date: '2026-11-08', kind: 'retry', ...day })).outcome, 'all_held', '일반 재시도는 보류를 뒤집지 않음');
  const r = await runDaily({ date: '2026-11-08', kind: 'retry', redoEvidenceHolds: true, ...day });
  assert.equal(r.outcome, 'ready');
  const id = readInternal('issues/2026-11-08.json').topicIds[0];
  assert.equal(readInternal(`topics/${id}.json`).redoHistory.length, 1, '재시도 이력 보존');
  delete process.env.NJ_FAKE_NOW;
});
