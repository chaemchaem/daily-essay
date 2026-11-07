// 주제 1개를 처리하는 단계 기계. 각 단계 결과를 저장하므로 실패 지점부터 재개할 수 있다.
// ① 자료 수집·사실 정리 → ② 문제·평가 기준 → ③ 논증 설계 → ④ 초안 → ⑤ 사실 검증 → ⑥ 논리 비판 → ⑦ 수정(반복)
// → 해설·다른 입장·학습 포인트 → ⑧ 최종 검토·발행 판단(코드 게이트 포함)
import { callLLM } from '../llm/index.js';
import * as P from '../llm/prompts.js';
import * as S from '../llm/schemas.js';
import { checkAnswer, checkQuestion, checkFacts, checkCompanion } from './checks.js';
import { evaluateGate, isBlockingIssue } from './gate.js';
import { buildSourcePack, packForRecord, renderSources } from './sources.js';
import { readInternal, writeInternal } from '../lib/store.js';
import { splitParagraphs, countChars } from '../lib/text.js';
import { toKstIso, nowMs } from '../lib/time.js';
import { log, errorSummary } from '../lib/log.js';

export function loadTopic(id) { return readInternal(`topics/${id}.json`); }
export function saveTopic(t) { t.updatedAt = toKstIso(nowMs()); writeInternal(`topics/${t.id}.json`, t); }

const J = (o) => JSON.stringify(o, null, 1);

function factsBrief(facts) {
  return J({
    headline: facts.headline, eventDate: facts.eventDate, developmentStage: facts.developmentStage, developmentStageNote: facts.developmentStageNote,
    whatHappened: facts.whatHappened, whatChangedInWindow: facts.whatChangedInWindow,
    facts: facts.facts.map((f) => ({ id: f.id, kind: f.kind, statement: f.statement, attributedTo: f.attributedTo, asOf: f.asOf, accessBasis: f.accessBasis })),
    stakeholders: facts.stakeholders.map((s) => ({ name: s.name, position: s.position, interest: s.interest })),
    unresolvedDiscrepancies: facts.discrepancies.filter((d) => !d.resolved).map((d) => d.description),
    uncertainties: facts.uncertainties, legalStatusNote: facts.legalStatusNote,
  });
}

function questionText(q) {
  return J({ title: q.title, type: q.questionType, background: q.background, passages: q.passages.map((p) => ({ label: p.label, text: p.text })), prompt: q.prompt, requirements: q.requirements, length: q.length, timeMinutes: q.timeMinutes });
}

function numbered(text) {
  return splitParagraphs(text).map((p, i) => `[${i + 1}] ${p}`).join('\n\n');
}

function followUpBlock(t) {
  if (t.kind !== 'follow_up' || !t.followUpContext) return '이 주제는 새 이슈다(후속 주제 아님).';
  const f = t.followUpContext;
  return `이 주제는 기존 이슈 묶음의 후속 주제다.\n- 이전에 다룬 문제들: ${J(f.previous)}\n- 선별 단계가 판단한 변화: ${f.whatChanged}\n- 변화 유형: ${(f.changeTypes || []).join(', ')}\n기존 문제와 발문·논점이 실질적으로 달라야 한다. 같은 논증을 표현만 바꿔 반복하지 말 것.`;
}

function header(t, ctx) {
  return `[발행호] ${t.issueDate}\n[수집 대상 기간] ${ctx.window.primaryStart} 이상 ~ ${ctx.window.primaryEnd} 미만 (지연 보도 보완: ${ctx.window.overlapStart}부터 검색)\n[정보 기준 시점] ${t.infoCutoff}\n${t.lateEntry ? `[늦게 발견된 사건] 실제 발생일 ${t.lateEntry.eventDate}, 추가 수록 이유: ${t.lateEntry.reason}\n` : ''}[분야] ${t.category}`;
}

function issueList(issues) {
  return issues.length ? J(issues.map((i) => ({ id: i.id, type: i.type, severity: i.severity, location: i.location, evidence: i.evidence, fixDirection: i.fixDirection }))) : '(없음)';
}

async function stage(t, name, fn) {
  if (t.stages[name]?.done) return t.stages[name].output;
  t.status = 'in_progress';
  t.currentStage = name;
  saveTopic(t);
  const res = await fn();
  t.stages[name] = { done: true, at: toKstIso(nowMs()), output: res.data, calls: res.calls, notes: res.notes || null };
  t.calls.push(...res.calls);
  saveTopic(t);
  return res.data;
}

function hold(t, reasons) {
  t.status = 'held';
  t.holdReasons = [...new Set(reasons)];
  t.currentStage = null;
  saveTopic(t);
  return t;
}

/**
 * @param {object} t 주제 기록(내부)
 * @param {object} ctx { policy, budget, window, articlesById, allowHosts, recent, fetcher }
 */
export async function runTopic(t, ctx) {
  const { policy, budget } = ctx;
  const base = { budget, policy };
  try {
    // ── ① 자료 수집과 사실 정리 ──
    let pack = ctx.packCache?.get(t.id);
    if (!t.stages.facts?.done || !pack) {
      const arts = t.cluster.articleIds.map((id) => ctx.articlesById.get(id)).filter(Boolean);
      pack = await buildSourcePack(arts, { policy, allowHosts: ctx.allowHosts, fetcher: ctx.fetcher });
      ctx.packCache?.set(t.id, pack);
      t.sourcePack = packForRecord(pack);
      saveTopic(t);
    }
    const rawFacts = await stage(t, 'facts', () => callLLM({ ...base, role: 'facts', stage: 'facts', promptDef: P.FACTS, schema: S.FactsOutput,
      prompt: `${header(t, ctx)}\n\n${followUpBlock(t)}\n\n선별 단계 사건 요약(참고용, 검증 대상): ${t.selection.eventSummary}\n\n아래 출처만으로 사실을 정리하라.\n\n${renderSources(pack)}` }));
    const fc = checkFacts({ facts: rawFacts, sourcePack: pack, policy });
    t.factsCheck = { problems: fc.problems, independence: fc.independence };
    const facts = fc.facts;
    t.facts = facts;
    t.category = facts.category || t.category;
    saveTopic(t);
    if (!rawFacts.suitability.enoughEvidence) return hold(t, [`자료 부족 판단: ${rawFacts.suitability.reason}`]);
    if (!fc.independence.enough) return hold(t, [`근거 부족: 독립 출처 ${fc.independence.independentGroups}곳, 공식 원자료 ${fc.independence.hasOfficial ? '있음' : '없음'}, 본문 확인 출처 ${fc.independence.fullTextSources}건`]);

    // ── ② 문제와 평가 기준 ──
    const recentBrief = J(ctx.recent.slice(0, 20).map((r) => ({ id: r.id, title: r.title, prompt: r.prompt, thesis: r.thesis })));
    let question = await stage(t, 'question', () => callLLM({ ...base, role: 'writer', stage: 'question', promptDef: P.QUESTION, schema: S.QuestionOutput,
      prompt: `${header(t, ctx)}\n\n${followUpBlock(t)}\n\n[사실표]\n${factsBrief(facts)}\n\n[선별 단계가 본 논점 후보]\n${J(t.selection.essayAngles)}\n\n[최근 발행한 문제 — 이것들과 논점이 겹치지 않게]\n${recentBrief}\n\n분량 기준: 공백 포함 ${policy.answer.minChars}~${policy.answer.maxChars}자.` }));
    let qIssues = checkQuestion({ question, policy, recent: ctx.recent });
    if (qIssues.some((i) => isBlockingIssue(i, policy) || i.severity === 'major') && !t.stages.question.regenerated) {
      const res = await callLLM({ ...base, role: 'writer', stage: 'question_regen', promptDef: P.QUESTION, schema: S.QuestionOutput,
        prompt: `${header(t, ctx)}\n\n${followUpBlock(t)}\n\n[사실표]\n${factsBrief(facts)}\n\n[직전 출제안]\n${questionText(question)}\n\n[직전 출제안의 형식 문제 — 고쳐서 다시 출제]\n${J(qIssues)}\n\n[최근 발행한 문제]\n${recentBrief}` });
      question = res.data;
      t.calls.push(...res.calls);
      t.stages.question = { ...t.stages.question, output: question, regenerated: true, previousIssues: qIssues };
      qIssues = checkQuestion({ question, policy, recent: ctx.recent });
      saveTopic(t);
    }
    question.length = { minChars: policy.answer.minChars, maxChars: policy.answer.maxChars, countMode: policy.answer.countMode };
    t.question = question;
    t.questionIssues = qIssues;
    saveTopic(t);
    if (qIssues.some((i) => i.severity === 'major')) return hold(t, qIssues.filter((i) => i.severity === 'major').map((i) => `문제 형식: ${i.evidence}`));

    // ── ③ 논증 설계 ──
    const design = await stage(t, 'design', () => callLLM({ ...base, role: 'writer', stage: 'design', promptDef: P.DESIGN, schema: S.DesignOutput,
      prompt: `${header(t, ctx)}\n\n[문제]\n${questionText(question)}\n\n[사실표]\n${factsBrief(facts)}` }));

    // ── ④ 초안 ──
    const draftDef = P.withLength(P.DRAFT, policy);
    const draft = await stage(t, 'draft', () => callLLM({ ...base, role: 'writer', stage: 'draft', promptDef: draftDef, schema: S.DraftOutput,
      prompt: `${header(t, ctx)}\n\n[문제]\n${questionText(question)}\n\n[사실표]\n${factsBrief(facts)}\n\n[논증 설계]\n${J(design)}` }));

    // ── ⑤~⑦ 검증·비판·수정 반복 ──
    if (!t.rounds.length) t.rounds.push({ round: 0, text: draft.text, paragraphRoles: draft.paragraphRoles, producedBy: 'draft' });
    const reviseDef = P.withLength(P.REVISE, policy);
    for (;;) {
      const r = t.rounds[t.rounds.length - 1];
      const prior = t.rounds.length > 1 ? t.rounds[t.rounds.length - 2].openIssues.filter((i) => i.source !== 'code') : [];
      if (!r.review) {
        const code = checkAnswer({ text: r.text, paragraphRoles: r.paragraphRoles, question, facts, policy, recent: ctx.recent, issueDate: t.issueDate });
        const priorFc = prior.filter((i) => i.stage === 'factcheck');
        const priorCr = prior.filter((i) => i.stage === 'critique');
        const fcRes = await callLLM({ ...base, role: 'reviewer', stage: `factcheck_r${r.round}`, promptDef: P.FACTCHECK, schema: S.FactCheckOutput,
          prompt: `${header(t, ctx)}\n\n[문제]\n${questionText(question)}\n\n[사실표]\n${factsBrief(facts)}\n\n[원출처]\n${renderSources(pack)}\n\n[검증할 답안 — 문단 번호 포함]\n${numbered(r.text)}\n\n[이전 검토에서 지적된 사실 문제 — 해결 여부 판정]\n${issueList(priorFc)}` });
        const crRes = await callLLM({ ...base, role: 'reviewer', stage: `critique_r${r.round}`, promptDef: P.CRITIQUE, schema: S.CritiqueOutput,
          prompt: `${header(t, ctx)}\n\n[문제]\n${questionText(question)}\n\n[사실표 요약]\n${factsBrief(facts)}\n\n[최근 발행 문제의 발문과 중심 주장 — 중복 판단용]\n${recentBrief}\n\n[비판할 답안 — 문단 번호 포함]\n${numbered(r.text)}\n\n[이전 검토에서 지적된 논리 문제 — 해결 여부 판정]\n${issueList(priorCr)}\n\n${r.round > 0 ? `[직전 수정 내역(필자 기록) — 필자 주장이므로 그대로 믿지 말고 원고로 확인]\n${J(r.reviseLog || {})}` : ''}` });
        t.calls.push(...fcRes.calls, ...crRes.calls);
        const stillOpen = [];
        for (const st of [...fcRes.data.priorIssueStatus, ...crRes.data.priorIssueStatus]) {
          const p = prior.find((i) => i.id === st.issueId);
          if (p && st.status !== 'resolved') stillOpen.push({ ...p, carriedNote: st.note });
        }
        // 판정이 누락된 이전 문제는 해결되지 않은 것으로 본다.
        for (const p of prior) if (![...fcRes.data.priorIssueStatus, ...crRes.data.priorIssueStatus].some((s) => s.issueId === p.id)) stillOpen.push({ ...p, carriedNote: '검토자가 해결 여부를 판정하지 않음' });
        const fresh = [
          ...fcRes.data.issues.map((i, n) => ({ ...i, id: `R${r.round}-F${n + 1}`, stage: 'factcheck', source: 'llm' })),
          ...crRes.data.issues.map((i, n) => ({ ...i, id: `R${r.round}-L${n + 1}`, stage: 'critique', source: 'llm' })),
          ...code.issues.map((i, n) => ({ ...i, id: `R${r.round}-C${n + 1}`, stage: 'code' })),
        ];
        r.review = { at: toKstIso(nowMs()), metrics: code.metrics, factcheck: fcRes.data, critique: crRes.data, priorStatus: [...fcRes.data.priorIssueStatus, ...crRes.data.priorIssueStatus] };
        r.openIssues = [...stillOpen, ...fresh];
        saveTopic(t);
      }
      const blocking = r.openIssues.filter((i) => isBlockingIssue(i, policy));
      const claimProblems = (r.review.factcheck.claims || []).filter((c) => ['contradicted', 'unsupported'].includes(c.verdict) && ['factual', 'statistical', 'attribution', 'legal_or_policy_status'].includes(c.kind));
      const majors = r.openIssues.filter((i) => i.severity !== 'minor');
      const minors = r.openIssues.filter((i) => i.severity === 'minor');
      const needsRevision = blocking.length || claimProblems.length || majors.length || minors.length >= 2 || r.review.factcheck.factsSheetProblems.some((p) => p.severity !== 'minor');
      if (!needsRevision) break;
      if (r.round >= policy.quality.maxRevisionRounds) {
        if (blocking.length || claimProblems.length || majors.length) {
          t.lastText = r.text;
          return hold(t, [`수정 ${r.round}회 후에도 해결되지 않은 문제`, ...[...blocking, ...majors].slice(0, 6).map((i) => `${S.ISSUE_TYPE_LABELS[i.type] || i.type}(${i.severity}): ${i.evidence}`), ...claimProblems.slice(0, 3).map((c) => `검증 실패 진술: ${c.quote}`)]);
        }
        break; // 사소한 문제만 남음 — 공개 검토 요약에 남은 문제로 표시
      }
      const toFix = [...r.openIssues, ...claimProblems.map((c, n) => ({ id: `R${r.round}-V${n + 1}`, type: c.verdict === 'contradicted' ? 'factual_error' : 'unsupported_key_evidence', severity: 'critical', location: { paragraph: c.paragraph, quote: c.quote }, evidence: `사실 검증 결과 ${c.verdict}: ${c.note}`, fixDirection: '사실표 범위로 고치거나 삭제', stage: 'factcheck', source: 'llm' }))];
      r.openIssues = toFix;
      const rev = await callLLM({ ...base, role: 'writer', stage: `revise_r${r.round + 1}`, promptDef: reviseDef, schema: S.ReviseOutput,
        prompt: `${header(t, ctx)}\n\n[문제]\n${questionText(question)}\n\n[사실표]\n${factsBrief(facts)}\n\n[현재 원고 — 문단 번호 포함]\n${numbered(r.text)}\n\n[고쳐야 할 문제 목록]\n${issueList(toFix)}\n\n문단 번호 표기([1] 등) 없이 전체 원고를 다시 출력하라.` });
      t.calls.push(...rev.calls);
      r.revisedBy = { at: toKstIso(nowMs()), changes: rev.data.changes, notAddressed: rev.data.notAddressed, ripple: rev.data.ripple };
      t.rounds.push({ round: r.round + 1, text: rev.data.text.replace(/^\[\d+\]\s*/gm, ''), paragraphRoles: rev.data.paragraphRoles, producedBy: 'revise', reviseLog: { changes: rev.data.changes, notAddressed: rev.data.notAddressed, ripple: rev.data.ripple } });
      saveTopic(t);
    }
    const finalRound = t.rounds[t.rounds.length - 1];
    const answerText = finalRound.text;
    const nPara = splitParagraphs(answerText).length;

    // ── 해설·다른 입장·학습 포인트 ──
    const companion = await stage(t, 'companion', () => callLLM({ ...base, role: 'writer', stage: 'companion', promptDef: P.COMPANION, schema: S.CompanionOutput,
      prompt: `${header(t, ctx)}\n\n${followUpBlock(t)}\n\n[문제]\n${questionText(question)}\n\n[사실표]\n${factsBrief(facts)}\n\n[확정 답안 — 문단 번호 포함]\n${numbered(answerText)}\n\n[문단 역할]\n${J(finalRound.paragraphRoles)}` }));
    const companionIssues = checkCompanion({ companion, answerParagraphs: nPara, facts });

    // ── ⑧ 최종 검토와 발행 판단 ──
    const reviewHistory = t.rounds.map((r) => ({ round: r.round, chars: countChars(r.text), issues: (r.openIssues || []).map((i) => ({ id: i.id, type: i.type, severity: i.severity, evidence: i.evidence })), changes: r.revisedBy?.changes || null }));
    const final = await stage(t, 'final', () => callLLM({ ...base, role: 'reviewer', stage: 'final', promptDef: P.FINAL, schema: S.FinalReviewOutput,
      prompt: `${header(t, ctx)}\n\n[문제]\n${questionText(question)}\n\n[사실표]\n${factsBrief(facts)}\n\n[원출처]\n${renderSources(pack, { maxBodyChars: 2500 })}\n\n[최종 답안 — 문단 번호 포함]\n${numbered(answerText)}\n\n[해설·다른 입장·학습 포인트]\n${J(companion)}\n\n[해설 형식 검사(코드)]\n${J(companionIssues)}\n\n[검토 이력]\n${J(reviewHistory)}` }));
    const openAfter = (finalRound.openIssues || []);
    const gate = evaluateGate({ openIssues: openAfter, factcheck: finalRound.review.factcheck, critique: finalRound.review.critique, final, companionIssues, policy });
    t.gate = { ...gate, at: toKstIso(nowMs()) };
    t.answer = { text: answerText, paragraphRoles: finalRound.paragraphRoles, metrics: finalRound.review.metrics };
    t.companion = companion;
    t.companionIssues = companionIssues;
    if (!gate.publishable) return hold(t, gate.blockers.slice(0, 8).map((b) => `${b.kind}/${b.type}: ${b.detail}`));
    t.status = 'ready';
    t.currentStage = null;
    t.readyAt = toKstIso(nowMs());
    saveTopic(t);
    return t;
  } catch (err) {
    if (err.calls) t.calls.push(...err.calls);
    t.status = err.code === 'budget_exceeded' ? 'deferred_budget' : 'failed';
    t.error = { stage: t.currentStage, message: errorSummary(err), code: err.code || null, at: toKstIso(nowMs()) };
    saveTopic(t);
    log(`[topic] ${t.id} ${t.status} @${t.currentStage}: ${err.message}`);
    return t;
  }
}
