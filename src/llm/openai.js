// OpenAI 제공자(선택). Responses API + JSON Schema strict 출력. 모델명은 반드시 환경변수로 지정한다
// (존재하지 않는 모델명을 추측해 기본값으로 넣지 않는다). 검토 역할을 다른 회사 모델로 분리할 때 쓴다.
import { z } from 'zod';

const STRIP = new Set(['minLength', 'maxLength', 'minimum', 'maximum', 'minItems', 'maxItems', 'pattern', 'format', 'exclusiveMinimum', 'exclusiveMaximum', '$schema']);

export function toStrictJsonSchema(schema) {
  const js = z.toJSONSchema(schema, { target: 'draft-2020-12', io: 'output' });
  const walk = (node) => {
    if (Array.isArray(node)) return node.map(walk);
    if (!node || typeof node !== 'object') return node;
    const out = {};
    for (const [k, v] of Object.entries(node)) if (!STRIP.has(k)) out[k] = walk(v);
    if (out.type === 'object' && out.properties) {
      out.additionalProperties = false;
      out.required = Object.keys(out.properties);
    }
    return out;
  };
  return walk(js);
}

export async function callOpenAI({ model, effort, system, prompt, schema, schemaName, maxTokens, timeoutMs }) {
  if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY가 설정되지 않았습니다.');
  if (!model) throw new Error('OpenAI 모델명이 지정되지 않았습니다(NJ_<ROLE>_MODEL).');
  const body = {
    model,
    input: [{ role: 'system', content: system }, { role: 'user', content: prompt }],
    text: { format: { type: 'json_schema', name: schemaName.replace(/[^a-zA-Z0-9_-]/g, '_'), schema: toStrictJsonSchema(schema), strict: true } },
    max_output_tokens: maxTokens,
  };
  if (process.env.NJ_OPENAI_REASONING_EFFORT || effort) body.reasoning = { effort: process.env.NJ_OPENAI_REASONING_EFFORT || (effort === 'xhigh' || effort === 'max' ? 'high' : effort) };
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const e = new Error(`OpenAI HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
      e.status = res.status;
      throw e;
    }
    const payload = await res.json();
    let text = payload.output_text || '';
    if (!text) {
      for (const item of payload.output || []) for (const c of item.content || []) if (c.type === 'output_text') text += c.text;
    }
    if (payload.status === 'incomplete') {
      const e = new Error(`OpenAI 응답 미완성: ${payload.incomplete_details?.reason}`);
      e.code = 'max_tokens';
      throw e;
    }
    return {
      text,
      servedModel: payload.model || model,
      usage: { inputTokens: payload.usage?.input_tokens || 0, outputTokens: payload.usage?.output_tokens || 0, cacheReadTokens: payload.usage?.input_tokens_details?.cached_tokens || 0 },
      stopReason: payload.status,
    };
  } finally {
    clearTimeout(t);
  }
}

export function isRetryableOpenAI(err) {
  return err.status === 429 || (err.status >= 500 && err.status < 600) || err.name === 'AbortError' || err.code === 'ECONNRESET';
}
