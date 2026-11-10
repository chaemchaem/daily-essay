// 일일 실행 오케스트레이터.
// 단계: 잠금 → 수집 → 묶기 → 선별(LLM) → 선정(코드) → 주제별 처리(병렬 제한) → 발행 시각이면 발행 → 상태 기록.
// 각 단계 결과를 발행호 기록(issues/<date>)에 저장하므로 재실행하면 실패 지점부터 이어서 처리하고, 같은 날짜·주제를 중복 생성하지 않는다.
import { loadPolicy, loadSources, loadControl, loadSite } from '../lib/config.js';
import { readInternal, writeInternal, readPublic, listPublic } from '../lib/store.js';
import { acquireLock, releaseLock, refreshLock } from '../lib/lock.js';
import { issueWindow, kstDateOf, nowMs, toKstIso, kstTimeMs, addDays, dateRange } from '../lib/time.js';
import { collectArticles } from '../collect/collector.js';
import { clusterArticles, rankClusters } from '../collect/cluster.js';
import { triage, decide, selectionRecord } from './select.js';
import { loadThreads, saveThreads, recentThreads, addUpdate } from './threads.js';
import { runTopic, loadTopic, saveTopic } from './topic.js';
import { Budget } from '../llm/budget.js';
import { publishIssue, writeStatus } from '../publish/publish.js';
import { log, errorSummary } from '../lib/log.js';
import { sha1 } from '../lib/crypto.js';
import { diagnoseIssue } from './diagnose.js';

function newRunId(kind, date) {
  return `${toKstIso(nowMs()).replace(/[:+]/g, '').slice(0, 15)}-${kind}-${date}`;
}

function recentPublished(issueDate, days = 21) {
  const from = addDays(issueDate, -days);
  return listPublic('topics').map((f) => readPublic(`topics/${f}`)).filter((t) => t && t.issueDate >= from && t.issueDate < issueDate)
    .sort((a, b) => b.issueDate.localeCompare(a.issueDate))
    .map((t) => ({ id: t.id, title: t.title, prompt: t.question.prompt, thesis: t.logic?.centralQuestion ? `${t.logic.finalPosition}` : '', answerHead: t.answer.text.slice(0, 600), category: t.category, issueDate: t.issueDate }));
}

function recentCategories(issueDate, days) {
  const from = addDays(issueDate, -days);
  return listPublic('topics').map((f) => readPublic(`topics/${f}`)).filter((t) => t && t.issueDate >= from && t.issueDate < issueDate).map((t) => t.category);
}

async function pool(items, n, fn) {
  const q = [...items];
  await Promise.all(Array.from({ length: Math.max(1, Math.min(n, q.length)) }, async () => { while (q.length) await fn(q.shift()); }));
}

/**
 * @param {object} o
 * @param {string} o.date 발행호 날짜(YYYY-MM-DD). 기본값: 오늘(KST)
 * @param {'scheduled'|'manual'|'retry'|'recover'} o.kind
 * @param {string} o.trigger 실행 주체 기록(cron/workflow_dispatch/local)
 * @param {Function} [o.fetcher] 테스트용 피드 조회 함수
 * @param {Function} [o.articleFetcher] 테스트용 기사 조회 함수
 */
export async function runDaily({ date, kind = 'manual', trigger = 'local', fetcher, articleFetcher, publishNow = false, redoEvidenceHolds = false } = {}) {
  const policy = loadPolicy();
  const sources = loadSources();
  const control = loadControl();
  const now = nowMs();
  const today = kstDateOf(now);
  date = date || today;
  if (date > today) throw new Error(`미래 날짜(${date})는 실행할 수 없습니다.`);
  const runId = newRunId(kind, date);
  const run = { id: runId, kind, trigger, targetDate: date, startedAt: toKstIso(now), finishedAt: null, outcome: null, steps: [], policyVersion: policy.policyVersion };
  const step = (name, status, detail = null) => { run.steps.push({ name, status, at: toKstIso(nowMs()), detail }); writeInternal(`runs/${runId}.json`, run); };

  if (control.paused && kind === 'scheduled') {
    run.outcome = 'paused';
    run.finishedAt = toKstIso(nowMs());
    step('control', 'skipped', control.reason);
    writeStatus();
    return run;
  }
  try {
    acquireLock({ runId, ttlMinutes: policy.runtime.lockTtlMinutes, purpose: `${kind}:${date}` });
  } catch (err) {
    run.outcome = 'lock_held';
    run.finishedAt = toKstIso(nowMs());
    step('lock', 'failed', err.message);
    return run;
  }
  const budget = new Budget(policy);
  try {
    const win = issueWindow(date, policy.window);
    let issue = readInternal(`issues/${date}.json`);
    const recovering = kind === 'recover' || date < today;
    if (!issue) {
      // 복구 실행은 원래 발행 시각을 정보 기준 시점으로 고정해, 이후에 보도된 사실이 섞이지 않게 한다.
      const cutoffMs = recovering ? kstTimeMs(date, policy.schedule.publishAtKst) : now;
      issue = { date, state: 'generating', window: { primaryStart: win.primaryStart, primaryEnd: win.primaryEnd, overlapStart: win.overlapStart }, infoCutoffMs: cutoffMs, infoCutoff: toKstIso(cutoffMs), recovered: recovering, createdAt: toKstIso(now), runs: [], steps: {}, topicIds: [], standbyIds: [] };
    }
    if (['published'].includes(issue.state) && kind !== 'retry') {
      step('idempotency', 'skipped', '이미 발행된 날짜');
      run.outcome = 'already_published';
      return run;
    }
    issue.runs.push(runId);
    issue.state = 'generating';
    issue.error = null;
    writeInternal(`issues/${date}.json`, issue);
    writeStatus();

    // ── 수집 ──
    let articles = readInternal(`articles/${date}.json`)?.articles;
    if (!issue.steps.collect?.done || !articles) {
      step('collect', 'started');
      const res = await collectArticles({ window: win, cutoffMs: issue.infoCutoffMs, sources, policy, fetcher, nowIso: toKstIso(nowMs()) });
      const okSources = res.health.filter((h) => h.ok).length;
      issue.steps.collect = { done: false, at: toKstIso(nowMs()), sourcesOk: okSources, sourcesTotal: res.health.length, articles: res.articles.length, undated: res.undated, excluded: res.excluded, health: res.health };
      if (okSources < Math.max(3, Math.ceil(res.health.length * 0.3)) || res.articles.length < 15) {
        writeInternal(`issues/${date}.json`, issue);
        const e = new Error(`수집 실패: 응답한 수집원 ${okSources}/${res.health.length}, 기사 ${res.articles.length}건`);
        e.step = 'collect';
        throw e;
      }
      articles = res.articles;
      writeInternal(`articles/${date}.json`, { date, collectedAt: toKstIso(nowMs()), cutoff: issue.infoCutoff, articles });
      issue.steps.collect.done = true;
      writeInternal(`issues/${date}.json`, issue);
      step('collect', 'done', `${articles.length}건 / 수집원 ${okSources}/${res.health.length}`);
    }
    const articlesById = new Map(articles.map((a) => [a.id, a]));

    // ── 묶기·선별 ──
    const threads = loadThreads();
    if (!issue.steps.select?.done) {
      const seen = readInternal('ledger/seen-articles.json', { ids: {} });
      const seenIds = new Set(Object.entries(seen.ids).filter(([, d]) => d < date).map(([id]) => id));
      const clusters = rankClusters(clusterArticles(articles), win, seenIds).slice(0, policy.topics.candidateClustersForTriage);
      const clustersById = new Map(clusters.map((c) => [c.id, c]));
      step('cluster', 'done', `${clusters.length}개 후보 묶음`);
      let triaged = issue.steps.triage?.done ? readInternal(`selections/${date}-triage.json`).results : null;
      if (!triaged) {
        if (!budget.canAfford(policy.budget.estimatedUsdSelection, policy.budget.estimatedCallsSelection || 0)) { const e = new Error('비용·호출 상한으로 선별을 시작하지 않음'); e.code = 'budget_exceeded'; throw e; }
        step('triage', 'started');
        const tr = await triage({ clusters, articlesById, threads: recentThreads(threads, date), window: win, issueDate: date, budget, policy });
        triaged = tr.results;
        writeInternal(`selections/${date}-triage.json`, { results: triaged, calls: tr.calls, clusters });
        issue.steps.triage = { done: true, at: toKstIso(nowMs()), calls: tr.calls.length };
        writeInternal(`issues/${date}.json`, issue);
        step('triage', 'done', `${triaged.length}건 판정`);
      }
      const decision = decide({ triaged, clustersById, recentCategories: recentCategories(date, policy.topics.categoryLookbackDays), policy, window: win });
      writeInternal(`selections/${date}.json`, selectionRecord({ decision, clusters, at: nowMs() }));
      // 주제 기록 생성(결정적 ID → 재실행해도 중복 생성 없음)
      const mk = (d, role) => {
        const followThread = d.threadMatch.relation === 'meaningful_followup' && d.threadMatch.threadId ? threads.threads.find((x) => x.id === d.threadMatch.threadId) : null;
        // 파일명·URL 호환을 위해 ASCII ID를 쓴다(제목은 데이터 안에 있음).
        const id = `${date}-${sha1(`${date}|${d.clusterId}`).slice(0, 8)}`;
        if (!loadTopic(id)) {
          saveTopic({
            id, issueDate: date, role, status: 'pending', kind: followThread ? 'follow_up' : 'new',
            threadId: followThread ? followThread.id : `th-${id}`,
            followUpContext: followThread ? { previous: followThread.topics.map((x) => ({ id: x.id, issueDate: x.issueDate, title: x.title, prompt: x.prompt, thesis: x.thesis })), whatChanged: d.threadMatch.whatChanged, changeTypes: d.threadMatch.changeTypes } : null,
            category: d.category, cluster: { id: d.clusterId, articleIds: d.articleIds },
            selection: { score: d.score, scores: d.scores, eventSummary: d.eventSummary, eventDate: d.eventDate, timing: d.timing, essayAngles: d.essayAngles, rationale: d.scoreRationale },
            lateEntry: d.lateEntry || null, infoCutoff: issue.infoCutoff, stages: {}, rounds: [], calls: [], createdAt: toKstIso(nowMs()),
          });
        }
        return id;
      };
      issue.topicIds = decision.picks.map((d) => mk(d, 'pick'));
      issue.standbyIds = decision.standby.map((d) => mk(d, 'standby'));
      issue.minorUpdates = decision.minorUpdates.map((u) => ({ ...u, articles: u.articleIds.map((id) => articlesById.get(id)).filter(Boolean).slice(0, 4).map((a) => ({ title: a.title, outlet: a.outlet, url: a.url, publishedAt: a.publishedAt })) }));
      for (const u of issue.minorUpdates) addUpdate(threads, u.threadId, { date, summary: u.summary, articles: u.articles });
      saveThreads(threads);
      // 처리한 기사 표시(대상일 이후 사건·예비 후보는 다음 호에서 다시 볼 수 있게 제외)
      for (const d of decision.decisions) if (!['deferred', 'standby'].includes(d.decision)) for (const id of d.articleIds) seen.ids[id] = seen.ids[id] || date;
      writeInternal('ledger/seen-articles.json', seen);
      issue.steps.select = { done: true, at: toKstIso(nowMs()), counts: { candidates: clusters.length, selected: issue.topicIds.length, standby: issue.standbyIds.length } };
      if (!issue.topicIds.length) issue.noTopicReason = `후보 ${clusters.length}건 중 선정 기준(점수 ${policy.topics.minSelectionScore} 이상, 새로운 논점)을 통과한 주제가 없음`;
      writeInternal(`issues/${date}.json`, issue);
      step('select', 'done', `선정 ${issue.topicIds.length}건, 예비 ${issue.standbyIds.length}건`);
    }

    // ── 주제 처리 ──
    const ctx = { policy, budget, window: win, articlesById, allowHosts: sources.fetchAllowHosts, recent: recentPublished(date), fetcher: articleFetcher, packCache: new Map() };
    const processTopic = async (id) => {
      const t = loadTopic(id);
      if (!t || ['ready', 'published'].includes(t.status)) return;
      if (t.status === 'held') {
        // 보류 판정은 같은 근거로 뒤집지 않는다. 단, '근거·자료 부족' 보류는 근거 수집 방식이 바뀌었을 때
        // 관리자가 명시적으로 요청하면(redoEvidenceHolds) 사실 정리부터 다시 한다. 이력은 남긴다.
        const evidenceHold = /근거 부족|자료 부족/.test(t.holdReasons?.[0] || '');
        if (!(kind === 'retry' && redoEvidenceHolds && evidenceHold)) return;
        t.redoHistory = [...(t.redoHistory || []), { at: toKstIso(nowMs()), previousHoldReasons: t.holdReasons, reason: '근거 수집 방식 변경 후 재시도' }];
        t.stages = {};
        t.rounds = [];
        t.holdReasons = [];
        t.facts = null;
        t.factsCheck = null;
        t.sourcePack = null;
        t.status = 'pending';
        saveTopic(t);
      }
      if (!budget.canAfford(policy.budget.estimatedUsdPerTopic, policy.budget.estimatedCallsPerTopic || 0)) {
        t.status = 'deferred_budget';
        t.error = { stage: null, message: `일일 비용·호출 상한(남은 호출 ${budget.remainingCalls()}회)에 가까워 이 주제는 작성하지 않음(검토 생략 없음)`, at: toKstIso(nowMs()) };
        saveTopic(t);
        return;
      }
      if (['failed', 'deferred_budget'].includes(t.status)) { t.status = 'pending'; t.error = null; }
      step(`topic:${id}`, 'started');
      const done = await runTopic(t, ctx);
      refreshLock({ runId, ttlMinutes: policy.runtime.lockTtlMinutes });
      step(`topic:${id}`, done.status, done.holdReasons?.[0] || done.error?.message || null);
    };
    await pool(issue.topicIds, policy.runtime.topicConcurrency, processTopic);
    // 통과한 주제가 최소 목표보다 적으면, 선정 기준을 이미 통과한 예비 후보를 차례로 처리한다(기준을 낮추지 않음).
    const readyCount = () => issue.topicIds.map(loadTopic).filter((t) => t && ['ready', 'published'].includes(t.status)).length;
    for (const sid of issue.standbyIds || []) {
      if (readyCount() >= policy.topics.targetMin) break;
      if (!issue.topicIds.includes(sid)) issue.topicIds.push(sid);
      writeInternal(`issues/${date}.json`, issue);
      await processTopic(sid);
    }
    const topics = issue.topicIds.map(loadTopic).filter(Boolean);
    const ready = topics.filter((t) => ['ready', 'published'].includes(t.status));
    const failed = topics.filter((t) => t.status === 'failed');
    const held = topics.filter((t) => t.status === 'held');
    const deferred = topics.filter((t) => t.status === 'deferred_budget');
    issue.state = ready.length ? 'ready' : !topics.length ? 'no_qualifying_topics' : failed.length ? 'failed_generation' : deferred.length && !held.length ? 'budget_deferred' : 'all_held';
    if (failed.length) issue.error = { stage: 'topics', message: `주제 ${failed.length}건 생성 오류`, at: toKstIso(nowMs()) };
    issue.generatedAt = toKstIso(nowMs());
    writeInternal(`issues/${date}.json`, issue);
    step('topics', 'done', `발행 가능 ${ready.length}, 보류 ${held.length}, 오류 ${failed.length}`);

    // ── 발행 ──
    if (ready.length || ['no_qualifying_topics', 'all_held', 'budget_deferred'].includes(issue.state)) {
      const pub = publishIssue(date, { force: publishNow || recovering });
      step('publish', pub.reason === 'not_due' ? 'waiting' : 'done', pub.reason === 'not_due' ? `발행 예정 ${policy.schedule.publishAtKst}` : `${pub.published}건 공개`);
    }
    run.outcome = readInternal(`issues/${date}.json`).state;
  } catch (err) {
    const issue = readInternal(`issues/${date}.json`);
    const stepName = err.step || run.steps.filter((s) => s.status === 'started').pop()?.name || 'unknown';
    if (issue) {
      issue.state = stepName === 'collect' ? 'failed_collect' : 'failed_generation';
      issue.error = { stage: stepName, message: errorSummary(err), code: err.code || null, at: toKstIso(nowMs()) };
      writeInternal(`issues/${date}.json`, issue);
    }
    run.outcome = issue?.state || 'failed_generation';
    run.failedStep = stepName;
    run.error = errorSummary(err);
    step(stepName, 'failed', errorSummary(err));
    log(`[daily] 실패 @${stepName}: ${err.message}`);
  } finally {
    try { for (const line of diagnoseIssue(date)) log(line); } catch (e) { log(`[진단] 요약 실패: ${e.message}`); }
    run.finishedAt = toKstIso(nowMs());
    run.budget = budget.state;
    writeInternal(`runs/${runId}.json`, run);
    releaseLock(runId);
    writeStatus();
  }
  return run;
}

/** 발행 시각 처리(09:00 cron). ready 상태를 공개로 옮긴다. 생성이 끝나지 않았으면 아무것도 공개하지 않고 지연으로 표시된다. */
export async function runPublish({ date, waitUntilDue = false, maxWaitMinutes = 30 } = {}) {
  const policy = loadPolicy();
  date = date || kstDateOf(nowMs());
  if (waitUntilDue) {
    const due = kstTimeMs(date, policy.schedule.publishAtKst);
    const wait = due - nowMs();
    if (wait > 0 && wait <= maxWaitMinutes * 60000) {
      log(`[publish] ${Math.round(wait / 1000)}초 뒤 발행 시각`);
      await new Promise((r) => setTimeout(r, wait + 1000));
    }
  }
  const res = publishIssue(date);
  writeStatus();
  return res;
}

/** 발행 시각까지 기다릴 시간(ms). 이미 지났으면 0, 너무 멀면(최대 대기 초과) null */
export function publishWaitMs(date, policy, now = nowMs(), maxWaitMinutes = 330) {
  const due = kstTimeMs(date, policy.schedule.publishAtKst);
  const wait = due - now;
  if (wait <= 0) return 0;
  return wait <= maxWaitMinutes * 60000 ? wait : null;
}

/** 누락 날짜 탐지: 출범일 이후 발행 기록이 없거나 실패한 날짜 */
export function findMissingDates({ lookbackDays } = {}) {
  const policy = loadPolicy();
  const site = loadSite();
  const today = kstDateOf(nowMs());
  const from = [site.launchDate, addDays(today, -(lookbackDays ?? policy.recovery.recoverLookbackDays))].sort().pop();
  if (from > today) return [];
  const out = [];
  // 오늘 날짜는 발행 시각이 지난 뒤에만 본다(아직 생성 전인 오늘을 누락으로 오인하지 않기 위해).
  const until = nowMs() >= kstTimeMs(today, policy.schedule.publishAtKst) ? today : addDays(today, -1);
  if (from > until) return [];
  for (const d of dateRange(from, until)) {
    const i = readInternal(`issues/${d}.json`);
    if (!i) out.push({ date: d, reason: 'no_record' });
    else if (['failed_collect', 'failed_generation', 'generating', 'budget_deferred'].includes(i.state)) out.push({ date: d, reason: i.state });
    else if (i.state === 'ready') out.push({ date: d, reason: 'ready_not_published' });
  }
  return out;
}
