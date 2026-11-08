// Google Gemini 제공자(공식 SDK @google/genai). 기본값은 무료 등급(결제 미연결 프로젝트의 API 키) 운영을 전제로 한다.
// - 모델 이름을 코드에 박아 두지 않는다. 실행할 때 키로 사용 가능한 모델 목록(models.list)을 조회해 고른다.
//   "auto:pro"  → pro 계열 최신 안정판 우선, 없거나 무료 한도가 다 되면 flash 계열로 내려간다.
//   "auto:flash" → flash 계열 우선. 특정 모델을 쓰려면 NJ_GEMINI_MODEL 또는 NJ_<ROLE>_MODEL에 정확한 이름을 넣는다.
// - 무료 등급의 분당 요청 제한에 맞춰 호출 간격을 둔다(NJ_GEMINI_MIN_INTERVAL_MS).
// - 하루 한도가 소진된 모델은 이번 실행에서 제외하고 다음 후보로 넘어간다. 후보가 모두 소진되면 'quota_exhausted'.
import { GoogleGenAI, ApiError } from '@google/genai';
import { z } from 'zod';
import { log } from '../lib/log.js';

let client = null;
let testClient = null;
let catalog = null; // [{ id, family, version, stable, outputTokenLimit }]
const exhausted = new Set();
let lastCallAt = 0;

/** 테스트 전용: 가짜 클라이언트 주입 */
export function setGeminiClientForTest(c) {
  testClient = c;
  catalog = null;
  exhausted.clear();
  lastCallAt = 0;
}

function getClient(timeoutMs) {
  if (testClient) return testClient;
  if (!process.env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY가 설정되지 않았습니다.');
  if (!client) client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY, httpOptions: { timeout: timeoutMs } });
  return client;
}

const EXCLUDE = /(embedding|tts|image|imagen|veo|audio|live|native|vision|aqa|learnlm|gemma|robotics|computer-use|search)/i;

export function parseModelId(name) {
  const id = String(name).replace(/^models\//, '');
  if (!/^gemini-/.test(id) || EXCLUDE.test(id)) return null;
  const family = /flash-lite/.test(id) ? 'flash-lite' : /flash/.test(id) ? 'flash' : /pro/.test(id) ? 'pro' : null;
  if (!family) return null;
  const v = (id.match(/^gemini-(\d+(?:\.\d+)?)/) || [])[1];
  if (!v) return null;
  const stable = !/(preview|exp|experimental|latest|\d{2}-\d{2}$|-\d{3}$)/.test(id);
  return { id, family, version: Number(v), stable };
}

async function loadCatalog(c) {
  if (catalog) return catalog;
  const out = [];
  const pager = await c.models.list();
  for await (const m of pager) {
    const p = parseModelId(m.name);
    if (!p) continue;
    if (m.supportedActions && !m.supportedActions.includes('generateContent')) continue;
    out.push({ ...p, outputTokenLimit: m.outputTokenLimit || null });
  }
  catalog = out;
  log(`[gemini] 사용 가능 모델: ${out.map((m) => m.id).join(', ') || '(없음)'}`);
  return catalog;
}

const FAMILY_ORDER = { pro: 0, flash: 1, 'flash-lite': 2 };
// 안정판 우선 → 높은 버전 우선 → 같은 버전이면 pro, flash 순
const rank = (a, b) => (b.stable - a.stable) || (b.version - a.version) || (FAMILY_ORDER[a.family] - FAMILY_ORDER[b.family]) || a.id.localeCompare(b.id);

/** 역할 설정("auto:pro" 등 또는 정확한 모델명)에 따른 시도 순서 */
export function candidatesFor(spec, models) {
  const override = process.env.NJ_GEMINI_MODEL;
  if (override) return [{ id: override, outputTokenLimit: null }];
  if (spec && !spec.startsWith('auto')) return [{ id: spec, outputTokenLimit: models.find((m) => m.id === spec)?.outputTokenLimit || null }];
  // auto:pro(품질 우선): pro·flash를 함께 놓고 최신 안정판부터. 예: 3.x flash가 2.5 pro보다 앞선다.
  // auto:flash(속도·한도 우선): flash 계열 먼저.
  const main = spec === 'auto:flash'
    ? [...models.filter((m) => m.family === 'flash').sort(rank), ...models.filter((m) => m.family === 'pro').sort(rank)]
    : models.filter((m) => m.family === 'pro' || m.family === 'flash').sort(rank);
  const list = [...main, ...models.filter((m) => m.family === 'flash-lite').sort(rank)];
  return list.filter((m) => !exhausted.has(m.id));
}

function toGeminiSchema(schema) {
  const js = z.toJSONSchema(schema, { target: 'draft-2020-12', io: 'output' });
  const walk = (n) => {
    if (Array.isArray(n)) return n.map(walk);
    if (!n || typeof n !== 'object') return n;
    const o = {};
    for (const [k, v] of Object.entries(n)) if (!['$schema', 'pattern', 'exclusiveMinimum', 'exclusiveMaximum'].includes(k)) o[k] = walk(v);
    // ["string","null"] 형태의 다중 type은 문서에 명시된 anyOf 형태로 바꾼다.
    if (Array.isArray(o.type)) {
      const { type, ...rest } = o;
      return { ...(rest.description ? { description: rest.description } : {}), anyOf: type.map((t) => (t === 'null' ? { type: 'null' } : { ...rest, description: undefined, type: t })).map((x) => JSON.parse(JSON.stringify(x))) };
    }
    return o;
  };
  return walk(js);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function pace() {
  const gap = Number(process.env.NJ_GEMINI_MIN_INTERVAL_MS ?? 13000);
  const wait = lastCallAt + gap - Date.now();
  if (wait > 0) await sleep(wait);
  lastCallAt = Date.now();
}

function isDailyQuota(err) {
  const msg = String(err?.message || '');
  return err instanceof ApiError && err.status === 429 && /(per ?day|PerDay|daily|limit: 0)/i.test(msg);
}

export async function callGemini({ model: spec, system, prompt, schema, maxTokens, timeoutMs }) {
  const c = getClient(timeoutMs);
  const models = await loadCatalog(c);
  const cands = candidatesFor(spec, models);
  if (!cands.length) {
    const e = new Error('사용 가능한 Gemini 모델이 없거나 오늘 무료 한도를 모두 썼습니다.');
    e.code = 'quota_exhausted';
    throw e;
  }
  let lastErr = null;
  for (const m of cands) {
    const maxOutputTokens = Math.min(maxTokens, m.outputTokenLimit || 32768);
    let useSchema = true;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await pace();
      try {
        const res = await c.models.generateContent({
          model: m.id,
          contents: prompt,
          config: {
            systemInstruction: useSchema ? system : `${system}\n\n[출력 형식] 아래 JSON 스키마를 만족하는 JSON만 출력한다.\n${JSON.stringify(toGeminiSchema(schema))}`,
            responseMimeType: 'application/json',
            ...(useSchema ? { responseJsonSchema: toGeminiSchema(schema) } : {}),
            maxOutputTokens,
          },
        });
        const cand = res.candidates?.[0];
        const finish = cand?.finishReason;
        if (finish === 'MAX_TOKENS') { const e = new Error('출력이 최대 길이에서 잘렸습니다.'); e.code = 'max_tokens'; throw e; }
        if (finish && !['STOP', 'FINISH_REASON_UNSPECIFIED'].includes(finish)) { const e = new Error(`모델이 응답을 중단했습니다(${finish}).`); e.code = 'refusal'; throw e; }
        if (!cand && res.promptFeedback?.blockReason) { const e = new Error(`요청이 차단되었습니다(${res.promptFeedback.blockReason}).`); e.code = 'refusal'; throw e; }
        const u = res.usageMetadata || {};
        return {
          text: res.text || '',
          servedModel: m.id,
          usage: { inputTokens: u.promptTokenCount || 0, outputTokens: (u.candidatesTokenCount || 0) + (u.thoughtsTokenCount || 0), cacheReadTokens: u.cachedContentTokenCount || 0 },
          stopReason: finish || 'STOP',
        };
      } catch (err) {
        lastErr = err;
        if (isDailyQuota(err)) { exhausted.add(m.id); log(`[gemini] ${m.id} 오늘 한도 소진 → 다음 후보`); break; }
        // 스키마 지정 요청이 400으로 거부되면 스키마를 지시문으로 옮겨 한 번 더 시도(결과는 어차피 zod로 검증한다)
        if (useSchema && err instanceof ApiError && err.status === 400) { log(`[gemini] 스키마 지정 요청 거부(${String(err.message).slice(0, 120)}) → 지시문 방식으로 재시도`); useSchema = false; continue; }
        if (err instanceof ApiError && err.status === 404) { exhausted.add(m.id); break; }
        throw err;
      }
    }
  }
  if (lastErr && isDailyQuota(lastErr)) {
    const e = new Error('오늘 Gemini 무료 한도를 모두 썼습니다.');
    e.code = 'quota_exhausted';
    throw e;
  }
  throw lastErr || new Error('Gemini 호출 실패');
}

export function isRetryableGemini(err) {
  if (err instanceof ApiError) return err.status === 429 || err.status === 500 || err.status === 503 || err.status === 504;
  return /(ECONNRESET|ETIMEDOUT|fetch failed|network|timeout)/i.test(String(err?.message || ''));
}
