// Gemini 제공자 테스트: 실제 네트워크 없이 가짜 클라이언트로 모델 선택·한도 소진 대체·스키마 대체·응답 해석을 확인한다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ApiError } from '@google/genai';
import { z } from 'zod';
import { callGemini, setGeminiClientForTest, parseModelId, candidatesFor } from '../src/llm/gemini.js';
import { Budget } from '../src/llm/budget.js';
import { loadPolicy } from '../src/lib/config.js';
import { tempDataDir } from './helpers.js';

process.env.NJ_GEMINI_MIN_INTERVAL_MS = '0';
const schema = z.object({ answer: z.string(), n: z.number().nullable() });

// 실제 이름이 아닌 시험용 이름이다. 선택 규칙(계열·버전·안정판 우선)만 확인한다.
const MODELS = [
  { name: 'models/gemini-9.0-pro', supportedActions: ['generateContent'], outputTokenLimit: 65536 },
  { name: 'models/gemini-9.5-pro-preview-01-01', supportedActions: ['generateContent'], outputTokenLimit: 65536 },
  { name: 'models/gemini-9.0-flash', supportedActions: ['generateContent'], outputTokenLimit: 65536 },
  { name: 'models/gemini-9.0-flash-lite', supportedActions: ['generateContent'], outputTokenLimit: 8192 },
  { name: 'models/gemini-9.0-flash-tts', supportedActions: ['generateContent'] },
  { name: 'models/text-embedding-9', supportedActions: ['embedContent'] },
];

function fakeClient(handler) {
  const calls = [];
  return {
    calls,
    models: {
      list: async () => ({ async *[Symbol.asyncIterator]() { yield* MODELS; } }),
      generateContent: async (req) => { calls.push(req); return handler(req, calls.length); },
    },
  };
}
const ok = (obj, extra = {}) => ({ text: JSON.stringify(obj), candidates: [{ finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 20, thoughtsTokenCount: 30 }, ...extra });

test('모델 이름 해석: 생성 모델만, 계열·버전·안정판 구분', () => {
  assert.deepEqual(parseModelId('models/gemini-9.0-pro'), { id: 'gemini-9.0-pro', family: 'pro', version: 9, stable: true });
  assert.equal(parseModelId('models/gemini-9.5-pro-preview-01-01').stable, false);
  assert.equal(parseModelId('models/gemini-9.0-flash-lite').family, 'flash-lite');
  assert.equal(parseModelId('models/gemini-9.0-flash-tts'), null);
  assert.equal(parseModelId('models/text-embedding-9'), null);
});

test('auto:pro는 안정판 pro를 먼저, 그다음 flash 계열 순으로 시도', async () => {
  const c = fakeClient(() => ok({ answer: '가', n: 1 }));
  setGeminiClientForTest(c);
  const r = await callGemini({ model: 'auto:pro', system: 's', prompt: 'p', schema, maxTokens: 64000, timeoutMs: 1000 });
  assert.equal(r.servedModel, 'gemini-9.0-pro');
  assert.equal(c.calls[0].config.responseMimeType, 'application/json');
  assert.ok(c.calls[0].config.responseJsonSchema.properties.answer);
  assert.equal(c.calls[0].config.maxOutputTokens, 64000);
  assert.deepEqual(r.usage, { inputTokens: 100, outputTokens: 50, cacheReadTokens: 0 });
  assert.deepEqual(JSON.parse(r.text), { answer: '가', n: 1 });
  const order = candidatesFor('auto:pro', [parseModelId('models/gemini-9.0-flash'), parseModelId('models/gemini-9.0-pro'), parseModelId('models/gemini-9.5-pro-preview-01-01')]).map((m) => m.id);
  assert.deepEqual(order, ['gemini-9.0-pro', 'gemini-9.5-pro-preview-01-01', 'gemini-9.0-flash']);
});

test('하루 무료 한도가 소진된 모델은 건너뛰고 다음 후보로', async () => {
  const c = fakeClient((req) => {
    if (req.model === 'gemini-9.0-pro') throw new ApiError({ message: 'Quota exceeded for metric generate_content_free_tier_requests, limit: 0 per day', status: 429 });
    return ok({ answer: '나', n: null });
  });
  setGeminiClientForTest(c);
  const r = await callGemini({ model: 'auto:pro', system: 's', prompt: 'p', schema, maxTokens: 1000, timeoutMs: 1000 });
  assert.equal(r.servedModel, 'gemini-9.5-pro-preview-01-01');
  // 같은 실행 안에서는 소진된 모델을 다시 부르지 않는다
  await callGemini({ model: 'auto:pro', system: 's', prompt: 'p', schema, maxTokens: 1000, timeoutMs: 1000 });
  assert.equal(c.calls.filter((x) => x.model === 'gemini-9.0-pro').length, 1);
});

test('모든 후보가 소진되면 quota_exhausted', async () => {
  const c = fakeClient(() => { throw new ApiError({ message: 'Resource exhausted: requests per day', status: 429 }); });
  setGeminiClientForTest(c);
  await assert.rejects(callGemini({ model: 'auto:flash', system: 's', prompt: 'p', schema, maxTokens: 1000, timeoutMs: 1000 }), (e) => e.code === 'quota_exhausted');
});

test('분당 제한(429)은 재시도 대상으로 위로 던진다', async () => {
  const c = fakeClient(() => { throw new ApiError({ message: 'Resource exhausted: requests per minute', status: 429 }); });
  setGeminiClientForTest(c);
  await assert.rejects(callGemini({ model: 'auto:pro', system: 's', prompt: 'p', schema, maxTokens: 1000, timeoutMs: 1000 }), (e) => e instanceof ApiError && e.status === 429);
});

test('스키마를 거부하면 스키마를 지시문으로 옮겨 다시 시도', async () => {
  const c = fakeClient((req, n) => {
    if (n === 1) throw new ApiError({ message: 'Invalid JSON schema: unsupported keyword', status: 400 });
    return ok({ answer: '다', n: 2 });
  });
  setGeminiClientForTest(c);
  const r = await callGemini({ model: 'auto:pro', system: 'sys', prompt: 'p', schema, maxTokens: 1000, timeoutMs: 1000 });
  assert.equal(JSON.parse(r.text).answer, '다');
  assert.equal(c.calls[1].config.responseJsonSchema, undefined);
  assert.match(c.calls[1].config.systemInstruction, /JSON 스키마/);
});

test('출력 잘림·차단은 명확한 오류로', async () => {
  setGeminiClientForTest(fakeClient(() => ok({ answer: 'x', n: 1 }, { candidates: [{ finishReason: 'MAX_TOKENS' }] })));
  await assert.rejects(callGemini({ model: 'auto:pro', system: 's', prompt: 'p', schema, maxTokens: 1000, timeoutMs: 1000 }), (e) => e.code === 'max_tokens');
  setGeminiClientForTest(fakeClient(() => ok({ answer: 'x', n: 1 }, { candidates: [{ finishReason: 'SAFETY' }] })));
  await assert.rejects(callGemini({ model: 'auto:pro', system: 's', prompt: 'p', schema, maxTokens: 1000, timeoutMs: 1000 }), (e) => e.code === 'refusal');
});

test('무료 운영용 일일 호출 상한', () => {
  tempDataDir();
  const policy = loadPolicy();
  const b = new Budget({ ...policy, budget: { ...policy.budget, dailyCallCap: 3 } });
  assert.equal(b.canAfford(0, 3), true);
  for (let i = 0; i < 3; i += 1) b.record({ inputTokens: 1, outputTokens: 1, costUsd: null });
  assert.equal(b.canAfford(0, 1), false);
  assert.throws(() => b.assertCall(), /호출 상한/);
});
