// 서버 붐빔 시 다른 모델로 넘어가기, 요약문까지 비교한 관련 기사 찾기, 9시 대기 계산
import test from 'node:test';
import assert from 'node:assert/strict';
import { ApiError } from '@google/genai';
import { z } from 'zod';
import { callGemini, setGeminiClientForTest } from '../src/llm/gemini.js';
import { findRelated } from '../src/pipeline/related.js';
import { publishWaitMs } from '../src/pipeline/daily.js';
import { loadPolicy } from '../src/lib/config.js';

process.env.NJ_GEMINI_MIN_INTERVAL_MS = '0';
const MODELS = [
  { name: 'models/gemini-9.0-flash', supportedActions: ['generateContent'] },
  { name: 'models/gemini-8.0-flash', supportedActions: ['generateContent'] },
];
const client = (handler) => {
  const calls = [];
  return { calls, models: { list: async () => ({ async *[Symbol.asyncIterator]() { yield* MODELS; } }), generateContent: async (req) => { calls.push(req.model); return handler(req); } } };
};
const ok = { text: '{"a":"x"}', candidates: [{ finishReason: 'STOP' }], usageMetadata: {} };

test('Gemini가 붐빔(503)으로 거절하면 같은 호출에서 다음 모델로 넘어간다', async () => {
  const c = client((req) => { if (req.model === 'gemini-9.0-flash') throw new ApiError({ message: 'high demand', status: 503 }); return ok; });
  setGeminiClientForTest(c);
  const r = await callGemini({ model: 'auto:pro', system: 's', prompt: 'p', schema: z.object({ a: z.string() }), maxTokens: 100, timeoutMs: 100 });
  assert.equal(r.servedModel, 'gemini-8.0-flash');
  // 일시 오류는 한도 소진으로 기록하지 않으므로 다음 호출에서 다시 1순위 모델을 시도한다
  await callGemini({ model: 'auto:pro', system: 's', prompt: 'p', schema: z.object({ a: z.string() }), maxTokens: 100, timeoutMs: 100 });
  assert.equal(c.calls.filter((m) => m === 'gemini-9.0-flash').length, 2);
});

test('모든 모델이 붐비면 오류를 올려 재시도 단계가 기다렸다 다시 시도하게 한다', async () => {
  setGeminiClientForTest(client(() => { throw new ApiError({ message: 'high demand', status: 503 }); }));
  await assert.rejects(callGemini({ model: 'auto:pro', system: 's', prompt: 'p', schema: z.object({ a: z.string() }), maxTokens: 100, timeoutMs: 100 }), (e) => e instanceof ApiError && e.status === 503);
});

test('관련 기사: 제목 표현이 달라도 요약문의 핵심어가 많이 겹치면 찾는다', () => {
  const art = (id, title, group, feedSummary = '') => ({ id, title, group, feedSummary, lang: 'ko', sourceType: 'press', fetchable: true });
  const seed = [art('s', '예결위, 미래대응기금 적격성 공방', 'yonhap', '국회 예산결산특별위원회 전체회의에서 여야가 반도체 추가 세수 기반 미래대응기금을 두고 재정건전성과 예산심의권 우회 문제로 맞섰다')];
  const other = art('h', '"쌈짓돈 될라" 野, 기금 신설에 제동', 'hani', '예산결산특별위원회 전체회의에서 야당은 반도체 추가 세수로 만드는 미래대응기금이 예산심의권을 우회한다고 비판했다');
  const unrelated = art('x', '서울 지하철 요금 인상 확정', 'donga', '서울시는 지하철 기본요금을 올리기로 했다');
  const got = findRelated({ seedArticles: seed, eventSummary: '국회 예결위에서 미래대응기금 적격성을 두고 여야가 공방을 벌였다', all: [...seed, other, unrelated] }).map((a) => a.id);
  assert.deepEqual(got, ['h']);
});

test('9시 대기 계산: 지났으면 0, 5시간 반 이내면 남은 시간, 그 이상이면 기다리지 않음', () => {
  const policy = loadPolicy();
  const at = (iso) => Date.parse(iso);
  assert.equal(publishWaitMs('2026-11-11', policy, at('2026-11-11T09:30:00+09:00')), 0);
  assert.equal(publishWaitMs('2026-11-11', policy, at('2026-11-11T06:00:00+09:00')), 3 * 3600000);
  assert.equal(publishWaitMs('2026-11-11', policy, at('2026-11-11T01:00:00+09:00')), null);
});

test('붐빔(503) 뒤 마지막 모델이 사용 불가(404)여도 재시도 가능한 503을 올린다', async () => {
  setGeminiClientForTest(client((req) => {
    if (req.model === 'gemini-9.0-flash') throw new ApiError({ message: 'high demand', status: 503 });
    throw new ApiError({ message: 'models/gemini-8.0-flash is no longer available to new users', status: 404 });
  }));
  await assert.rejects(callGemini({ model: 'auto:pro', system: 's', prompt: 'p', schema: z.object({ a: z.string() }), maxTokens: 100, timeoutMs: 100 }), (e) => e instanceof ApiError && e.status === 503);
});

test('한도 소진과 사용 불가만 섞이면 무료 한도 소진으로 본다', async () => {
  setGeminiClientForTest(client((req) => {
    if (req.model === 'gemini-9.0-flash') throw new ApiError({ message: 'quota exceeded per day', status: 429 });
    throw new ApiError({ message: 'no longer available', status: 404 });
  }));
  await assert.rejects(callGemini({ model: 'auto:pro', system: 's', prompt: 'p', schema: z.object({ a: z.string() }), maxTokens: 100, timeoutMs: 100 }), (e) => e.code === 'quota_exhausted');
});
