// LLM 호출 공통 계층: 역할별 제공자 선택, 스키마 검증, 스키마 오류 1회 교정 재요청,
// 재시도(속도 제한·일시 오류), 비용 기록, 호출 기록(감사용).
import { loadModels } from '../lib/config.js';
import { callAnthropic, isRetryableAnthropic } from './anthropic.js';
import { callOpenAI, isRetryableOpenAI } from './openai.js';
import { callGemini, isRetryableGemini } from './gemini.js';
import { log } from '../lib/log.js';

const mockHandlers = new Map();
/** 테스트 전용: provider "mock" 호출을 가로챌 함수를 등록한다. */
export function setMockHandler(fn) { mockHandlers.set('default', fn); }

export function resolveRole(role) {
  const models = loadModels();
  const r = models.roles[role];
  if (!r) throw new Error(`알 수 없는 역할: ${role}`);
  if (process.env.NJ_LLM_PROVIDER_OVERRIDE) return { ...r, provider: process.env.NJ_LLM_PROVIDER_OVERRIDE };
  return r;
}

export function priceFor(model) {
  const p = loadModels().pricingUsdPerMTok;
  if (p[model]) return p[model];
  if (process.env.NJ_OPENAI_PRICE_IN && process.env.NJ_OPENAI_PRICE_OUT) return { input: Number(process.env.NJ_OPENAI_PRICE_IN), output: Number(process.env.NJ_OPENAI_PRICE_OUT) };
  return null;
}

export function estimateCost(model, usage) {
  const p = priceFor(model);
  if (!p) return null;
  return ((usage.inputTokens || 0) * p.input + (usage.outputTokens || 0) * p.output + (usage.cacheReadTokens || 0) * (p.cacheRead ?? p.input)) / 1e6;
}

/** 검토 독립성 표시. 같은 모델이면 '같은 모델의 별도 호출'로만 표기한다. */
const modelLabel = (m) => (String(m).startsWith('auto:') ? `Gemini ${m.slice(5)} 계열(실행 시 자동 선택)` : m);

export function reviewIndependence() {
  const w0 = resolveRole('writer');
  const r0 = resolveRole('reviewer');
  const w = { ...w0, model: modelLabel(w0.model) };
  const r = { ...r0, model: modelLabel(r0.model) };
  if (w.provider !== r.provider) return { level: 'different_provider', label: `작성(${w.model})과 다른 회사 모델(${r.model})이 검토` };
  if (w.model !== r.model) return { level: 'different_model', label: `작성(${w.model})과 다른 모델(${r.model})이 검토` };
  return { level: 'same_model_separate_call', label: `작성과 같은 모델(${w.model})을 별도 역할·별도 호출로 검토 — 독립 검증은 아님` };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function extractJson(text) {
  const t = String(text || '').trim();
  try { return JSON.parse(t); } catch { /* fallthrough */ }
  const m = t.match(/\{[\s\S]*\}/);
  if (m) return JSON.parse(m[0]);
  throw new Error('JSON을 찾을 수 없음');
}

/**
 * @param {object} o
 * @param {string} o.role triage|facts|writer|reviewer
 * @param {string} o.stage 기록용 단계명
 * @param {{id:string,version:string,system:string}} o.promptDef
 * @param {string} o.prompt 사용자 메시지(데이터 포함)
 * @param {import('zod').ZodType} o.schema
 * @param {import('./budget.js').Budget} o.budget
 * @param {object} o.policy
 */
export async function callLLM({ role, stage, promptDef, prompt, schema, budget, policy, maxTokens = 64000 }) {
  const r = resolveRole(role);
  const calls = [];
  let attemptPrompt = prompt;
  for (let repair = 0; repair <= policy.runtime.schemaRepairAttempts; repair += 1) {
    let out;
    for (let attempt = 0; ; attempt += 1) {
      budget?.assertCall();
      const started = Date.now();
      try {
        if (r.provider === 'mock') {
          const fn = mockHandlers.get('default');
          if (!fn) throw new Error('mock 핸들러 없음');
          out = await fn({ role, stage, prompt: attemptPrompt, system: promptDef.system });
          out = { text: typeof out === 'string' ? out : JSON.stringify(out), servedModel: 'mock', usage: { inputTokens: 0, outputTokens: 0 }, stopReason: 'end_turn' };
        } else if (r.provider === 'anthropic') {
          out = await callAnthropic({ model: r.model, effort: r.effort, system: promptDef.system, prompt: attemptPrompt, schema, maxTokens, timeoutMs: policy.runtime.llmTimeoutMs, maxRetries: 2 });
        } else if (r.provider === 'gemini') {
          out = await callGemini({ model: r.model, system: promptDef.system, prompt: attemptPrompt, schema, maxTokens, timeoutMs: policy.runtime.llmTimeoutMs });
        } else if (r.provider === 'openai') {
          out = await callOpenAI({ model: r.model, effort: r.effort, system: promptDef.system, prompt: attemptPrompt, schema, schemaName: stage, maxTokens, timeoutMs: policy.runtime.llmTimeoutMs });
        } else {
          throw new Error(`지원하지 않는 제공자: ${r.provider}`);
        }
        const costUsd = r.provider === 'mock' ? 0 : estimateCost(out.servedModel, out.usage);
        budget?.record({ ...out.usage, costUsd });
        calls.push({ stage, role, provider: r.provider, requestedModel: r.model, servedModel: out.servedModel, effort: r.effort, promptId: promptDef.id, promptVersion: promptDef.version, usage: out.usage, costUsd, ms: Date.now() - started, at: new Date().toISOString(), repair });
        break;
      } catch (err) {
        const retryable = r.provider === 'anthropic' ? isRetryableAnthropic(err) : r.provider === 'openai' ? isRetryableOpenAI(err) : r.provider === 'gemini' ? isRetryableGemini(err) : false;
        if (!retryable || attempt >= policy.runtime.llmMaxRetries) throw err;
        const wait = r.provider === 'gemini' ? 30000 * (attempt + 1) : Math.min(60000, 4000 * 2 ** attempt);
        log(`[llm] ${stage} 재시도 ${attempt + 1} (${err.message}) ${wait}ms 대기`);
        await sleep(wait);
      }
    }
    let parsed;
    try {
      parsed = schema.parse(extractJson(out.text));
      return { data: parsed, calls };
    } catch (err) {
      if (repair >= policy.runtime.schemaRepairAttempts) {
        const e = new Error(`${stage} 출력이 스키마를 만족하지 않음: ${String(err.message).slice(0, 400)}`);
        e.code = 'schema_invalid';
        e.calls = calls;
        throw e;
      }
      attemptPrompt = `${prompt}\n\n[직전 응답 오류] 직전 응답이 요구된 JSON 스키마를 만족하지 않았습니다: ${String(err.message).slice(0, 600)}\n스키마에 맞는 JSON만 다시 출력하십시오.`;
    }
  }
  throw new Error('unreachable');
}
