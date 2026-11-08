import fs from 'node:fs';
import path from 'node:path';
import { CONFIG_DIR } from './paths.js';

function readConfig(name) {
  return JSON.parse(fs.readFileSync(path.join(CONFIG_DIR, name), 'utf8'));
}

export function loadSite() {
  const site = readConfig('site.json');
  if (process.env.NJ_SITE_NAME) site.name = process.env.NJ_SITE_NAME;
  return site;
}

/** 관리자 설정. 환경변수로 일부 값을 덮어쓸 수 있다(GitHub 저장소 변수 → 워크플로 env). */
export function loadPolicy() {
  const p = readConfig('policy.json');
  const num = (v) => (v === undefined || v === '' ? undefined : Number(v));
  const env = process.env;
  if (num(env.NJ_TOPICS_MIN) !== undefined) p.topics.targetMin = num(env.NJ_TOPICS_MIN);
  if (num(env.NJ_TOPICS_MAX) !== undefined) p.topics.targetMax = num(env.NJ_TOPICS_MAX);
  if (num(env.NJ_ANSWER_MIN_CHARS) !== undefined) p.answer.minChars = num(env.NJ_ANSWER_MIN_CHARS);
  if (num(env.NJ_ANSWER_MAX_CHARS) !== undefined) p.answer.maxChars = num(env.NJ_ANSWER_MAX_CHARS);
  if (num(env.NJ_DAILY_USD_CAP) !== undefined) p.budget.dailyUsdCap = num(env.NJ_DAILY_USD_CAP);
  if (num(env.NJ_DAILY_CALL_CAP) !== undefined) p.budget.dailyCallCap = num(env.NJ_DAILY_CALL_CAP);
  if (num(env.NJ_MAX_REVISIONS) !== undefined) p.quality.maxRevisionRounds = num(env.NJ_MAX_REVISIONS);
  if (num(env.NJ_TOPIC_CONCURRENCY) !== undefined) p.runtime.topicConcurrency = num(env.NJ_TOPIC_CONCURRENCY);
  if (p.topics.targetMin > p.topics.targetMax) throw new Error('topics.targetMin이 targetMax보다 큽니다.');
  if (p.answer.minChars > p.answer.maxChars) throw new Error('answer.minChars가 maxChars보다 큽니다.');
  return p;
}

export function loadSources() {
  return readConfig('sources.json');
}

export function loadModels() {
  const m = readConfig('models.json');
  for (const role of Object.keys(m.roles)) {
    const up = role.toUpperCase();
    if (process.env[`NJ_${up}_PROVIDER`]) m.roles[role].provider = process.env[`NJ_${up}_PROVIDER`];
    if (process.env[`NJ_${up}_MODEL`]) m.roles[role].model = process.env[`NJ_${up}_MODEL`];
    if (process.env[`NJ_${up}_EFFORT`]) m.roles[role].effort = process.env[`NJ_${up}_EFFORT`];
  }
  return m;
}

export function loadControl() {
  const c = readConfig('control.json');
  if (process.env.NJ_PAUSED === 'true') return { ...c, paused: true, reason: c.reason || '저장소 변수 NJ_PAUSED=true' };
  return c;
}

export function writeControl(control) {
  fs.writeFileSync(path.join(CONFIG_DIR, 'control.json'), `${JSON.stringify(control, null, 2)}\n`);
}

export function categoryLabel(id) {
  const c = loadSources().categories.find((x) => x.id === id);
  return c ? c.label : id;
}
