#!/usr/bin/env node
// 논점 관리 명령. GitHub Actions(workflow_dispatch)가 관리자 실행 경로이며, 저장소 쓰기 권한이 있는 사람만 실행할 수 있다.
import fs from 'node:fs';
import { parseArgs } from 'node:util';
import { runDaily, runPublish, findMissingDates } from './pipeline/daily.js';
import { writeStatus, rebuildIndexes, applyCorrection } from './publish/publish.js';
import { loadControl, writeControl, loadSources, loadPolicy, loadModels } from './lib/config.js';
import { safeFetch } from './lib/safe-fetch.js';
import { parseFeed } from './collect/rss.js';
import { toKstIso, nowMs, assertDate } from './lib/time.js';
import { log } from './lib/log.js';
import { encryptionEnabled } from './lib/crypto.js';

const [, , cmd, ...rest] = process.argv;
const { values } = parseArgs({
  args: rest,
  options: {
    date: { type: 'string' }, kind: { type: 'string' }, trigger: { type: 'string' }, 'publish-now': { type: 'boolean' },
    wait: { type: 'boolean' }, max: { type: 'string' }, reason: { type: 'string' }, by: { type: 'string' },
    topic: { type: 'string' }, 'answer-file': { type: 'string' }, notice: { type: 'string' }, json: { type: 'boolean' },
  },
  allowPositionals: true,
});
if (values.date) assertDate(values.date);

function requireKeysForGeneration() {
  const missing = [];
  const providers = new Set(Object.values(loadModels().roles).map((r) => r.provider));
  if (!process.env.NJ_LLM_PROVIDER_OVERRIDE) {
    if (providers.has('gemini') && !process.env.GEMINI_API_KEY) missing.push('GEMINI_API_KEY');
    if (providers.has('anthropic') && !process.env.ANTHROPIC_API_KEY) missing.push('ANTHROPIC_API_KEY');
    if (providers.has('openai') && !process.env.OPENAI_API_KEY) missing.push('OPENAI_API_KEY');
  }
  if (process.env.GITHUB_ACTIONS && !encryptionEnabled()) missing.push('NJ_INTERNAL_KEY (공개 저장소에 내부 기록을 암호화해 커밋하기 위해 필요)');
  if (missing.length) {
    // 운영 현황 화면에 '설정 필요'를 남겨, 자동화가 동작하는 것처럼 보이지 않게 한다.
    try { writeStatus({ setupMissing: missing }); } catch { /* 상태 기록 실패는 무시 */ }
    console.error(`필수 설정 누락: ${missing.join(', ')}\n실제 자동 생성은 실행되지 않았습니다. .env.example과 docs/OPERATIONS.md를 참고하세요.`);
    process.exit(2);
  }
}

const commands = {
  async daily() {
    requireKeysForGeneration();
    const run = await runDaily({ date: values.date, kind: values.kind || 'manual', trigger: values.trigger || 'local', publishNow: values['publish-now'] });
    log(JSON.stringify({ run: run.id, outcome: run.outcome, failedStep: run.failedStep || null, budget: run.budget }, null, 1));
    if (['failed_collect', 'failed_generation', 'lock_held'].includes(run.outcome)) process.exitCode = 1;
  },
  async publish() {
    const res = await runPublish({ date: values.date, waitUntilDue: values.wait });
    log(JSON.stringify(res));
  },
  async recover() {
    requireKeysForGeneration();
    const missing = findMissingDates();
    const max = Number(values.max || loadPolicy().recovery.maxRecoverPerRun);
    log(`누락·실패 날짜: ${missing.map((m) => `${m.date}(${m.reason})`).join(', ') || '없음'}`);
    for (const m of missing.slice(0, max)) {
      const run = await runDaily({ date: m.date, kind: 'recover', trigger: values.trigger || 'local' });
      log(`복구 ${m.date}: ${run.outcome}`);
    }
  },
  async status() {
    const s = writeStatus();
    const missing = findMissingDates();
    console.log(JSON.stringify({ ...s, missingDates: missing, encryption: encryptionEnabled() }, null, 2));
  },
  async pause() {
    const c = loadControl();
    writeControl({ ...c, paused: true, reason: values.reason || '관리자 일시 중지', changedAt: toKstIso(nowMs()), changedBy: values.by || process.env.GITHUB_ACTOR || 'local' });
    writeStatus();
    log('예약 실행을 일시 중지했습니다. 수동 실행(manual/retry)은 계속 가능합니다.');
  },
  async resume() {
    const c = loadControl();
    writeControl({ ...c, paused: false, reason: null, changedAt: toKstIso(nowMs()), changedBy: values.by || process.env.GITHUB_ACTOR || 'local' });
    writeStatus();
    log('예약 실행을 재개했습니다.');
  },
  async 'probe-sources'() {
    const src = loadSources();
    for (const s of src.sources) {
      const t0 = Date.now();
      try {
        const r = await safeFetch(s.url, { timeoutMs: 12000, maxBytes: 5_000_000, allowHosts: src.fetchAllowHosts });
        const items = parseFeed(r.text, { defaultTz: s.defaultTz });
        const dated = items.filter((i) => i.publishedMs);
        const newest = dated.length ? toKstIso(Math.max(...dated.map((i) => i.publishedMs))) : '-';
        console.log(`OK   ${s.id.padEnd(22)} ${String(r.status).padEnd(4)} items=${String(items.length).padEnd(4)} newest=${newest} ${Date.now() - t0}ms`);
      } catch (err) {
        console.log(`FAIL ${s.id.padEnd(22)} ${err.code || ''} ${err.message}`);
      }
    }
  },
  async correct() {
    if (!values.topic || !values.reason) throw new Error('--topic 과 --reason 이 필요합니다.');
    const text = values['answer-file'] ? fs.readFileSync(values['answer-file'], 'utf8').trim() : null;
    const entry = applyCorrection({ topicId: values.topic, reason: values.reason, replaceAnswerText: text, notice: values.notice || null, by: values.by || process.env.GITHUB_ACTOR || 'admin', kind: text ? 'fact_correction' : 'notice' });
    log(JSON.stringify(entry));
  },
  async 'rebuild-public'() {
    rebuildIndexes();
    log('공개 목록·검색·상태를 다시 만들었습니다.');
  },
  async 'eval-adversarial'() {
    const { runAdversarialEval } = await import('./eval/adversarial.js');
    requireKeysForGeneration();
    await runAdversarialEval();
  },
  async 'build-fixture-site'() {
    const { buildFixtureSite } = await import('./eval/fixture-site.js');
    await buildFixtureSite();
  },
};

const fn = commands[cmd];
if (!fn) {
  console.log(`사용법: node src/cli.js <명령>\n명령: ${Object.keys(commands).join(', ')}`);
  process.exit(cmd ? 1 : 0);
}
fn().catch((err) => { console.error(err.stack || err.message); process.exit(1); });
