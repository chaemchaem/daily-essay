// Anthropic Claude 제공자. 공식 SDK(@anthropic-ai/sdk)를 사용한다.
// 긴 출력에 대비해 스트리밍으로 받고 finalMessage()로 완성 응답을 얻는다.
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';

let client = null;
function getClient(timeoutMs, maxRetries) {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY가 설정되지 않았습니다.');
  if (!client) client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: timeoutMs, maxRetries });
  return client;
}

export async function callAnthropic({ model, effort, system, prompt, schema, maxTokens, timeoutMs, maxRetries }) {
  const c = getClient(timeoutMs, maxRetries);
  const fmt = zodOutputFormat(schema);
  const base = {
    model,
    max_tokens: maxTokens,
    // 시스템 프롬프트는 단계별로 고정이므로 캐시해 반복 호출 비용을 줄인다.
    system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: prompt }],
    output_config: { effort, format: { type: fmt.type, schema: fmt.schema } },
  };
  let msg;
  try {
    // 안전 분류기가 요청을 거절하면 서버 측에서 권장 대체 모델로 다시 실행한다(fallbacks: "default").
    msg = await c.beta.messages.stream({ ...base, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' }).finalMessage();
  } catch (err) {
    if (err instanceof Anthropic.BadRequestError && /fallback/i.test(err.message)) {
      msg = await c.messages.stream(base).finalMessage();
    } else {
      throw err;
    }
  }
  if (msg.stop_reason === 'refusal') {
    const e = new Error(`모델이 요청을 거절했습니다(${msg.stop_details?.category ?? 'unknown'})`);
    e.code = 'refusal';
    throw e;
  }
  if (msg.stop_reason === 'max_tokens') {
    const e = new Error('출력이 max_tokens에서 잘렸습니다.');
    e.code = 'max_tokens';
    throw e;
  }
  const text = msg.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  const u = msg.usage || {};
  return {
    text,
    servedModel: msg.model || model,
    usage: {
      inputTokens: (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0),
      outputTokens: u.output_tokens || 0,
      cacheReadTokens: u.cache_read_input_tokens || 0,
    },
    stopReason: msg.stop_reason,
  };
}

export function isRetryableAnthropic(err) {
  return err instanceof Anthropic.RateLimitError || err instanceof Anthropic.InternalServerError || err instanceof Anthropic.APIConnectionError;
}
