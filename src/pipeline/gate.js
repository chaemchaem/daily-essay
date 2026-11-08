// 발행 차단 규칙. 총점과 무관하게, 하나라도 해당하면 발행하지 않는다.
import { CODE_BLOCKING_TYPES } from './checks.js';

const BLOCKING_CHECKLIST = new Set(['requirements_covered', 'no_internal_contradiction']);
const FACTUAL_KINDS = new Set(['factual', 'statistical', 'attribution', 'legal_or_policy_status']);

export function isBlockingIssue(issue, policy) {
  if (issue.severity === 'critical') return true;
  if (issue.severity !== 'major') return false;
  if (issue.source === 'code' && CODE_BLOCKING_TYPES.has(issue.type)) return true;
  return policy.quality.blockingMajorTypes.includes(issue.type);
}

/** 사실 검증 표에서 차단 대상 진술 */
export function blockingClaims(factcheck) {
  return (factcheck?.claims || []).filter((c) => FACTUAL_KINDS.has(c.kind) && (c.verdict === 'contradicted' || c.verdict === 'unsupported'));
}

/**
 * @param {object} o
 * @param {Array} o.openIssues 마지막 검토 시점에 해결되지 않은 이슈(코드+LLM)
 * @param {object} o.factcheck 마지막 사실 검증 결과
 * @param {object} o.critique 마지막 논리 비판 결과
 * @param {object|null} o.final 최종 검토 결과
 * @param {Array} o.companionIssues 해설 코드 검사 결과
 */
export function evaluateGate({ openIssues, factcheck, critique, final, companionIssues = [], policy }) {
  const blockers = [];
  for (const i of openIssues) if (isBlockingIssue(i, policy)) blockers.push({ kind: 'issue', type: i.type, severity: i.severity, detail: i.evidence, location: i.location, source: i.source || 'llm' });
  for (const c of blockingClaims(factcheck)) blockers.push({ kind: 'claim', type: c.verdict === 'contradicted' ? 'factual_error' : 'unsupported_key_evidence', severity: 'critical', detail: `${c.verdict}: ${c.quote}`, location: { paragraph: c.paragraph, quote: c.quote }, source: 'factcheck' });
  for (const p of factcheck?.factsSheetProblems || []) if (p.severity !== 'minor') blockers.push({ kind: 'facts_sheet', type: 'factual_error', severity: p.severity, detail: `${p.factId}: ${p.problem}`, source: 'factcheck' });
  for (const item of critique?.checklist || []) if (item.verdict === 'fail' && BLOCKING_CHECKLIST.has(item.item)) blockers.push({ kind: 'checklist', type: item.item, severity: 'major', detail: item.note, source: 'critique' });
  const missingChecklist = critique ? [...BLOCKING_CHECKLIST].filter((k) => !critique.checklist.some((c) => c.item === k)) : [];
  for (const k of missingChecklist) blockers.push({ kind: 'checklist', type: k, severity: 'major', detail: '필수 점검 항목이 판정되지 않음', source: 'critique' });
  for (const c of companionIssues) if (c.severity !== 'minor') blockers.push({ kind: 'companion', type: c.section, severity: c.severity, detail: c.problem, source: c.source || 'final' });
  if (final) {
    for (const i of final.blockingIssues || []) if (i.severity !== 'minor') blockers.push({ kind: 'final', type: i.type, severity: i.severity, detail: i.evidence, location: i.location, source: 'final' });
    if (final.decision !== 'publish') blockers.push({ kind: 'final_decision', type: 'hold', severity: 'critical', detail: '최종 검토자가 보류 판단', source: 'final' });
  } else {
    blockers.push({ kind: 'final_missing', type: 'not_reviewed', severity: 'critical', detail: '최종 검토가 완료되지 않음', source: 'pipeline' });
  }
  return { publishable: blockers.length === 0, blockers };
}
