// 발행: 'ready' 주제를 공개 데이터로 옮기고 발행호·목록·검색·이슈 묶음·운영 현황을 갱신한다.
// 공개 데이터에는 미발행 초안·검토 원문을 넣지 않는다. 발행된 주제는 덮어쓰지 않고, 정정은 버전과 이력으로 남긴다.
import { readInternal, writeInternal, readPublic, writePublic, listPublic, listInternal, existsPublic } from '../lib/store.js';
import { loadSite, loadPolicy, loadControl, loadSources, categoryLabel } from '../lib/config.js';
import { toKstIso, nowMs, kstTimeMs, kstDateOf, addDays } from '../lib/time.js';
import { splitParagraphs, countChars, countCharsNoSpace, truncate, normalizeForCompare } from '../lib/text.js';
import { reviewIndependence } from '../llm/index.js';
import { promptVersions } from '../llm/prompts.js';
import { ISSUE_TYPE_LABELS } from '../llm/schemas.js';
import { loadThreads, saveThreads, ensureThread } from '../pipeline/threads.js';
import * as L from './labels.js';
import { currentLock } from '../lib/lock.js';

export function publicTopic(t, issue) {
  const facts = t.facts;
  const c = t.companion;
  const finalRound = t.rounds[t.rounds.length - 1];
  const fc = finalRound.review.factcheck;
  const cr = finalRound.review.critique;
  const notesBySid = Object.fromEntries((facts.sourceNotes || []).map((n) => [n.sourceId, n]));
  const supports = {};
  for (const f of facts.facts) for (const sid of f.sourceIds) (supports[sid] ||= []).push(f.id);
  const allIssues = t.rounds.flatMap((r) => (r.openIssues || []).map((i) => ({ ...i, round: r.round })));
  const uniqueIssues = new Map();
  for (const i of allIssues) if (!uniqueIssues.has(i.id)) uniqueIssues.set(i.id, i);
  const issueCounts = {};
  for (const i of uniqueIssues.values()) {
    const k = `${i.severity}`;
    issueCounts[k] = (issueCounts[k] || 0) + 1;
  }
  const remainingMinor = (finalRound.openIssues || []).filter((i) => i.severity === 'minor').map((i) => ({ type: ISSUE_TYPE_LABELS[i.type] || i.type, note: i.evidence, paragraph: i.location?.paragraph || 0 }));
  const servedModels = [...new Set(t.calls.map((x) => x.servedModel))];
  const usage = t.calls.reduce((a, x) => ({ calls: a.calls + 1, inputTokens: a.inputTokens + (x.usage?.inputTokens || 0), outputTokens: a.outputTokens + (x.usage?.outputTokens || 0), costUsd: a.costUsd + (x.costUsd || 0) }), { calls: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 });
  usage.costUsd = Math.round(usage.costUsd * 100) / 100;
  const text = t.answer.text;
  return {
    id: t.id,
    version: 1,
    issueDate: t.issueDate,
    category: t.category,
    categoryLabel: categoryLabel(t.category),
    kind: t.kind,
    threadId: t.threadId,
    title: t.question.title,
    headline: facts.headline,
    dates: {
      eventDate: facts.eventDate,
      eventDateBasis: facts.eventDateBasis,
      window: { start: issue.window.primaryStart, end: issue.window.primaryEnd, overlapStart: issue.window.overlapStart },
      infoCutoff: t.infoCutoff,
      generatedAt: t.readyAt,
      publishedAt: null,
      recovered: issue.recovered ? { originalDate: issue.date, generatedAt: t.readyAt, note: '누락된 날짜를 나중에 복구 발행했습니다. 정보 기준 시점 이후에 보도된 내용은 사용하지 않았습니다.' } : null,
    },
    lateEntry: t.lateEntry || null,
    briefing: {
      whatHappened: facts.whatHappened,
      whatChanged: facts.whatChangedInWindow,
      stage: { code: facts.developmentStage, label: L.STAGE_LABELS[facts.developmentStage] || facts.developmentStage, note: facts.developmentStageNote },
      legalStatusNote: facts.legalStatusNote,
      stakeholders: facts.stakeholders,
      facts: facts.facts.map((f) => ({ id: f.id, statement: f.statement, kind: f.kind, kindLabel: L.FACT_KIND_LABELS[f.kind], attributedTo: f.attributedTo, asOf: f.asOf, sourceIds: f.sourceIds, access: f.accessBasis, accessLabel: L.ACCESS_LABELS[f.accessBasis] })),
      discrepancies: facts.discrepancies,
      uncertainties: facts.uncertainties,
      interpretation: c.briefing,
    },
    question: {
      type: t.question.questionType,
      typeLabel: L.QUESTION_TYPE_LABELS[t.question.questionType] || t.question.questionType,
      background: t.question.background,
      passages: t.question.passages.map((p) => ({ ...p, reconstructed: true })),
      prompt: t.question.prompt,
      requirements: t.question.requirements,
      length: t.question.length,
      timeMinutes: t.question.timeMinutes,
      intent: t.question.intent,
      rubric: t.question.rubric,
    },
    answer: {
      text,
      paragraphs: splitParagraphs(text),
      chars: countChars(text),
      charsNoSpace: countCharsNoSpace(text),
      countMode: '공백 포함, 줄바꿈 제외',
      paragraphRoles: t.answer.paragraphRoles,
    },
    logic: { ...c.logic, definitions: t.stages.design?.output?.definitions || [], judgmentCriteria: t.stages.design?.output?.judgmentCriteria || null },
    alternatives: c.alternatives,
    alternativesNote: c.alternativesNote,
    learning: c.learning,
    followUp: t.kind === 'follow_up' && c.followUp ? { ...c.followUp, previous: (t.followUpContext?.previous || []).map((p) => ({ id: p.id, issueDate: p.issueDate, title: p.title })) } : null,
    sources: t.sourcePack.map((s) => ({
      id: s.sid, title: s.title, outlet: s.outlet, url: s.url, type: s.sourceType,
      publishedAt: s.publishedAt, pageModifiedAt: s.pageModifiedAt, checkedAt: s.checkedAt,
      access: s.accessLevel, accessLabel: L.ACCESS_LABELS[s.accessLevel],
      independence: notesBySid[s.sid]?.independence || null, independenceLabel: L.INDEPENDENCE_LABELS[notesBySid[s.sid]?.independence] || null,
      supportsFacts: supports[s.sid] || [],
    })),
    claims: fc.claims.map((x) => ({ paragraph: x.paragraph, quote: x.quote, kind: x.kind, verdict: x.verdict, verdictLabel: L.VERDICT_LABELS[x.verdict], factIds: x.factIds, sourceIds: x.sourceIds, note: x.note })),
    review: {
      independence: reviewIndependence(),
      stages: ['자료 수집과 사실 정리', '문제·평가 기준 작성', '논증 설계', '답안 초안', '사실 검증', '논리 비판', '수정', '최종 검토와 발행 판단'],
      rounds: t.rounds.length,
      revisions: t.rounds.filter((r) => r.revisedBy).map((r) => ({ afterRound: r.round, changes: r.revisedBy.changes.map((ch) => ch.description), notAddressed: r.revisedBy.notAddressed })),
      issuesFound: issueCounts,
      issuesByType: [...uniqueIssues.values()].reduce((a, i) => { const k = ISSUE_TYPE_LABELS[i.type] || i.type; a[k] = (a[k] || 0) + 1; return a; }, {}),
      remainingMinor,
      checklist: cr.checklist.map((x) => ({ item: x.item, label: L.CHECKLIST_LABELS[x.item] || x.item, verdict: x.verdict, note: x.note })),
      remainingUncertainties: t.stages.final.output.remainingUncertainties,
      summary: t.stages.final.output.publicReviewSummary,
      accessCaveat: t.sourcePack.filter((s) => s.accessLevel !== 'full_text').map((s) => `${s.sid} ${s.outlet}: ${L.ACCESS_LABELS[s.accessLevel]}`),
      factsCheck: t.factsCheck,
      models: servedModels,
      promptVersions: [...new Set(t.calls.map((x) => `${x.promptId}@${x.promptVersion}`))],
      policyVersion: loadPolicy().policyVersion,
      limits: '자동 검토는 제공된 출처 범위 안에서만 사실을 확인합니다. 출처 자체의 오류, 원문 비공개 자료, 미묘한 맥락 왜곡은 놓칠 수 있습니다.',
    },
    usage,
    corrections: [],
    notices: [],
    test: process.env.NJ_TEST_DATA === '1',
  };
}

function issueNumber(date) {
  const site = loadSite();
  const d0 = Date.parse(`${site.launchDate}T00:00:00Z`);
  return Math.floor((Date.parse(`${date}T00:00:00Z`) - d0) / 86400000) + 1;
}

/** 발행 시각이 지났는지 */
export function publishDue(date, policy, now = nowMs()) {
  return now >= kstTimeMs(date, policy.schedule.publishAtKst);
}

export function publishIssue(date, { force = false, now = nowMs() } = {}) {
  const policy = loadPolicy();
  const issue = readInternal(`issues/${date}.json`);
  if (!issue) return { published: 0, reason: 'no_issue' };
  if (!force && !publishDue(date, policy, now)) return { published: 0, reason: 'not_due' };
  const pubIssue = readPublic(`issues/${date}.json`) || null;
  const topicIds = issue.topicIds || [];
  const topics = topicIds.map((id) => readInternal(`topics/${id}.json`)).filter(Boolean);
  const nowIso = toKstIso(now);
  const newly = [];
  const threads = loadThreads();
  for (const t of topics) {
    if (t.status !== 'ready') continue;
    if (existsPublic(`topics/${t.id}.json`)) { t.status = 'published'; writeInternal(`topics/${t.id}.json`, t); continue; }
    const pub = publicTopic(t, issue);
    pub.dates.publishedAt = nowIso;
    writePublic(`topics/${t.id}.json`, pub);
    t.status = 'published';
    t.publishedAt = nowIso;
    writeInternal(`topics/${t.id}.json`, t);
    newly.push(t.id);
    const th = ensureThread(threads, { id: t.threadId, title: t.facts.headline, category: t.category, issueDate: t.issueDate });
    if (!th.topics.some((x) => x.id === t.id)) {
      th.topics.push({ id: t.id, issueDate: t.issueDate, title: t.question.title, prompt: t.question.prompt, thesis: t.stages.design?.output?.thesis || '', keyFacts: t.facts.facts.slice(0, 6).map((f) => f.statement), kind: t.kind });
    }
    th.articleIds = [...new Set([...(th.articleIds || []), ...t.cluster.articleIds])];
  }
  saveThreads(threads);
  const published = topics.filter((t) => t.status === 'published');
  const held = topics.filter((t) => t.status === 'held');
  const failed = topics.filter((t) => t.status === 'failed');
  const deferred = topics.filter((t) => t.status === 'deferred_budget');
  let state = issue.state;
  if (published.length) state = held.length || failed.length || deferred.length ? 'partial' : 'published';
  issue.state = state;
  if (newly.length) issue.publishedAt = issue.publishedAt || nowIso;
  writeInternal(`issues/${date}.json`, issue);
  const versions = pubIssue?.versions || [];
  if (newly.length || !pubIssue) versions.push({ version: versions.length + 1, at: nowIso, change: newly.length ? `주제 ${newly.length}건 발행` : `상태 기록: ${state}` });
  const followUpNews = (issue.minorUpdates || []).map((u) => ({ threadId: u.threadId, summary: u.summary, eventDate: u.eventDate }));
  writePublic(`issues/${date}.json`, {
    date,
    number: issueNumber(date),
    state,
    stateLabel: L.ISSUE_STATE_LABELS[state] || state,
    window: issue.window,
    infoCutoff: issue.infoCutoff,
    generatedAt: issue.generatedAt || null,
    publishedAt: issue.publishedAt || null,
    recovered: issue.recovered ? { generatedAt: issue.generatedAt } : null,
    topics: published.map((t) => {
      const p = readPublic(`topics/${t.id}.json`);
      return { id: t.id, title: p.title, headline: p.headline, category: p.category, categoryLabel: p.categoryLabel, kind: p.kind, questionType: p.question.typeLabel, prompt: p.question.prompt, chars: p.answer.chars, lateEntry: p.lateEntry, threadId: p.threadId, version: p.version, hasCorrections: (p.corrections || []).length > 0 };
    }),
    counts: { published: published.length, held: held.length, failed: failed.length, deferredBudget: deferred.length, candidates: issue.steps?.select?.counts?.candidates ?? null },
    heldSummary: summarizeHeld(held),
    noTopicReason: issue.noTopicReason || null,
    followUpNews,
    versions,
    test: process.env.NJ_TEST_DATA === '1',
  });
  rebuildIndexes();
  return { published: newly.length, state };
}

function summarizeHeld(held) {
  const buckets = {};
  for (const t of held) {
    const r = (t.holdReasons || [''])[0];
    const k = /자료 부족|근거 부족/.test(r) ? '근거 부족' : /문제 형식/.test(r) ? '문제 형식 미충족' : '검토 미통과(수정 상한 도달 또는 차단 항목)';
    buckets[k] = (buckets[k] || 0) + 1;
  }
  return Object.entries(buckets).map(([reason, count]) => ({ reason, count }));
}

/** 공개 목록·검색·이슈 묶음·운영 현황 재생성. 발행된 파일만 읽으므로 반복 실행해도 결과가 같다. */
export function rebuildIndexes() {
  const site = loadSite();
  const issues = listPublic('issues').map((f) => readPublic(`issues/${f}`)).filter(Boolean).sort((a, b) => b.date.localeCompare(a.date));
  const topics = listPublic('topics').map((f) => readPublic(`topics/${f}`)).filter(Boolean);
  writePublic('index.json', {
    site: { name: site.name, tagline: site.tagline, description: site.description, launchDate: site.launchDate },
    generatedAt: toKstIso(nowMs()),
    latestPublished: issues.find((i) => i.topics.length)?.date || null,
    issues: issues.map((i) => ({ date: i.date, number: i.number, state: i.state, stateLabel: i.stateLabel, count: i.topics.length, held: i.counts.held, topics: i.topics.map((t) => ({ id: t.id, title: t.title, category: t.category, categoryLabel: t.categoryLabel, kind: t.kind })) })),
    categories: loadSources().categories,
    test: process.env.NJ_TEST_DATA === '1',
  });
  writePublic('search.json', topics.map((t) => ({
    id: t.id, date: t.issueDate, title: t.title, headline: t.headline, category: t.category, categoryLabel: t.categoryLabel, kind: t.kind,
    prompt: t.question.prompt, type: t.question.typeLabel,
    text: normalizeForCompare([t.title, t.headline, t.question.prompt, t.briefing.whatHappened, ...(t.learning?.concepts || []).map((c) => c.term)].join(' ')).slice(0, 1200),
  })).sort((a, b) => b.date.localeCompare(a.date)));
  // 이슈 묶음(발행된 주제가 있는 것만 공개)
  const threads = loadThreads();
  for (const th of threads.threads) {
    if (!th.topics.length) continue;
    writePublic(`threads/${th.id}.json`, {
      id: th.id, title: th.title, category: th.category, firstDate: th.firstDate, lastDate: th.lastDate,
      topics: th.topics.filter((x) => existsPublic(`topics/${x.id}.json`)).map((x) => ({ id: x.id, issueDate: x.issueDate, title: x.title, kind: x.kind })),
      updates: th.updates.map((u) => ({ date: u.date, summary: u.summary, articles: u.articles || [] })),
    });
  }
  writeStatus();
}

export function writeStatus(extra = {}) {
  const policy = loadPolicy();
  const control = loadControl();
  const now = nowMs();
  const today = kstDateOf(now);
  const prev = readPublic('status.json', {});
  const issues = listPublic('issues').map((f) => readPublic(`issues/${f}`)).filter(Boolean).sort((a, b) => b.date.localeCompare(a.date));
  const lastOk = issues.find((i) => i.topics.length);
  const todayIssue = issues.find((i) => i.date === today);
  const internalToday = readInternal(`issues/${today}.json`);
  const publishAt = kstTimeMs(today, policy.schedule.publishAtKst);
  let todayState = todayIssue?.state || internalToday?.state || (now < publishAt ? 'scheduled' : 'delayed');
  if (!todayIssue?.topics?.length && now >= publishAt + 10 * 60000 && ['scheduled', 'generating', 'ready'].includes(todayState)) todayState = 'delayed';
  if (control.paused) todayState = todayIssue?.topics?.length ? todayState : 'paused';
  const next = now < publishAt ? publishAt : kstTimeMs(addDays(today, 1), policy.schedule.publishAtKst);
  const runs = listInternal('runs').slice(-15).map((f) => readInternal(`runs/${f}`)).filter(Boolean).reverse();
  const status = {
    generatedAt: toKstIso(now),
    paused: control.paused,
    pausedReason: control.paused ? control.reason : null,
    schedule: { publishAtKst: policy.schedule.publishAtKst, generateStartKst: policy.schedule.generateStartKst, timezone: 'Asia/Seoul', daily: true },
    nextScheduledPublish: toKstIso(next),
    lastSuccessfulPublish: lastOk ? { date: lastOk.date, publishedAt: lastOk.publishedAt, count: lastOk.topics.length } : null,
    today: { date: today, state: todayState, stateLabel: L.ISSUE_STATE_LABELS[todayState] || todayState, published: todayIssue?.topics?.length || 0, held: todayIssue?.counts?.held || 0, failedStage: internalToday?.error?.stage || null, message: internalToday?.error ? '작업 중 오류가 발생해 재시도가 필요합니다.' : null },
    lock: (() => { const l = currentLock(); return l && l.expiresAtMs > now ? { purpose: l.purpose, since: l.acquiredAt, expiresAt: l.expiresAt } : null; })(),
    recentRuns: runs.length ? runs.map((r) => ({ id: r.id, kind: r.kind, targetDate: r.targetDate, startedAt: r.startedAt, finishedAt: r.finishedAt, outcome: r.outcome, outcomeLabel: L.ISSUE_STATE_LABELS[r.outcome] || r.outcome, failedStep: r.failedStep || null, trigger: r.trigger })) : (prev.recentRuns || []),
    models: { writer: reviewIndependence().label },
    promptVersions: promptVersions(),
    policyVersion: policy.policyVersion,
    test: process.env.NJ_TEST_DATA === '1',
    ...extra,
  };
  writePublic('status.json', status);
  return status;
}

/** 정정: 기존 버전을 보관하고 새 버전을 만든다. 과거 답안을 몰래 덮어쓰지 않는다. */
export function applyCorrection({ topicId, reason, kind = 'fact_correction', replaceAnswerText = null, notice = null, by = 'admin' }) {
  const cur = readPublic(`topics/${topicId}.json`);
  if (!cur) throw new Error(`발행된 주제 없음: ${topicId}`);
  writePublic(`topics/${topicId}/v${cur.version}.json`, cur);
  const next = structuredClone(cur);
  next.version = cur.version + 1;
  const entry = { version: next.version, at: toKstIso(nowMs()), kind, reason, by, previousVersionPath: `topics/${topicId}/v${cur.version}.json` };
  if (replaceAnswerText) {
    entry.answerChanged = true;
    entry.charsBefore = cur.answer.chars;
    next.answer.text = replaceAnswerText;
    next.answer.paragraphs = splitParagraphs(replaceAnswerText);
    next.answer.chars = countChars(replaceAnswerText);
    next.answer.charsNoSpace = countCharsNoSpace(replaceAnswerText);
    entry.charsAfter = next.answer.chars;
  }
  if (notice) next.notices = [...(next.notices || []), { at: entry.at, text: notice }];
  next.corrections = [...(cur.corrections || []), entry];
  writePublic(`topics/${topicId}.json`, next);
  const iss = readPublic(`issues/${cur.issueDate}.json`);
  if (iss) {
    const t = iss.topics.find((x) => x.id === topicId);
    if (t) { t.version = next.version; t.hasCorrections = true; }
    iss.versions.push({ version: iss.versions.length + 1, at: entry.at, change: `${topicId} 정정(v${next.version}): ${truncate(reason, 80)}` });
    writePublic(`issues/${cur.issueDate}.json`, iss);
  }
  rebuildIndexes();
  return entry;
}
