// 실제 LLM 검토자로 결함 사례를 검토해 탐지·차단 여부를 기록한다(API 키 필요, 비용 발생).
// 결과: docs/adversarial-report.md, data/state/adversarial-report.json
import fs from 'node:fs';
import path from 'node:path';
import { ADVERSARIAL_CASES } from './adversarial-cases.js';
import * as F from './fixture-data.js';
import { fixtureArticleFetcher } from './fixture-feeds.js';
import { callLLM, reviewIndependence } from '../llm/index.js';
import * as P from '../llm/prompts.js';
import * as S from '../llm/schemas.js';
import { checkAnswer } from '../pipeline/checks.js';
import { evaluateGate, isBlockingIssue } from '../pipeline/gate.js';
import { renderSources } from '../pipeline/sources.js';
import { loadPolicy } from '../lib/config.js';
import { Budget } from '../llm/budget.js';
import { splitParagraphs } from '../lib/text.js';
import { PKG_ROOT } from '../lib/paths.js';
import { writeState } from '../lib/store.js';
import { toKstIso, nowMs } from '../lib/time.js';

const FACT_TYPES = ['factual_error', 'unsupported_key_evidence', 'fabricated_detail', 'status_misstated', 'source_misrepresentation'];

export async function runAdversarialEval() {
  const policy = loadPolicy();
  const budget = new Budget(policy);
  const body = (await fixtureArticleFetcher('x/lib')).body;
  const pack = [
    { sid: 'S1', outlet: '가온시(테스트)', sourceType: 'official', publishedAt: '2026-11-07T10:30:00+09:00', pageModifiedAt: null, accessLevel: 'full_text', title: '[테스트] 시립도서관 야간 운영 조정 계획', body },
    { sid: 'S2', outlet: '테스트일보', sourceType: 'press', publishedAt: '2026-11-07T11:00:00+09:00', pageModifiedAt: null, accessLevel: 'full_text', title: '[테스트] 가온시 도서관 야간 운영 중단에 노조 반발', body },
    { sid: 'S3', outlet: '테스트방송', sourceType: 'press', publishedAt: '2026-11-07T12:00:00+09:00', pageModifiedAt: null, accessLevel: 'full_text', title: '[테스트] 무인 대출기로 대체되는 야간 도서관', body },
  ];
  const q = JSON.stringify(F.LIB_QUESTION);
  const facts = JSON.stringify(F.LIB_FACTS.facts);
  const only = process.env.NJ_ADV_ONLY ? process.env.NJ_ADV_ONLY.split(',') : null;
  const results = [];
  for (const c of ADVERSARIAL_CASES.filter((x) => !only || only.includes(x.id))) {
    const numbered = splitParagraphs(c.text).map((p, i) => `[${i + 1}] ${p}`).join('\n\n');
    const code = checkAnswer({ text: c.text, paragraphRoles: c.roles || F.LIB_ROLES, question: F.LIB_QUESTION, facts: F.LIB_FACTS, policy, issueDate: '2026-11-08' });
    const fc = await callLLM({ role: 'reviewer', stage: `adv_factcheck_${c.id}`, promptDef: P.FACTCHECK, schema: S.FactCheckOutput, budget, policy,
      prompt: `[발행호] 2026-11-08 (테스트)\n\n[문제]\n${q}\n\n[사실표]\n${facts}\n\n[원출처]\n${renderSources(pack)}\n\n[검증할 답안 — 문단 번호 포함]\n${numbered}\n\n[이전 검토에서 지적된 사실 문제 — 해결 여부 판정]\n(없음)` });
    const cr = await callLLM({ role: 'reviewer', stage: `adv_critique_${c.id}`, promptDef: P.CRITIQUE, schema: S.CritiqueOutput, budget, policy,
      prompt: `[발행호] 2026-11-08 (테스트)\n\n[문제]\n${q}\n\n[사실표 요약]\n${facts}\n\n[최근 발행 문제의 발문과 중심 주장 — 중복 판단용]\n[]\n\n[비판할 답안 — 문단 번호 포함]\n${numbered}\n\n[이전 검토에서 지적된 논리 문제 — 해결 여부 판정]\n(없음)` });
    const open = [...code.issues, ...fc.data.issues.map((i) => ({ ...i, source: 'llm' })), ...cr.data.issues.map((i) => ({ ...i, source: 'llm' }))];
    // ⑧ 최종 검토를 '통과'로 가정해, 앞 단계(코드·사실 검증·논리 비판)만으로 차단되는지 측정한다.
    const gate = evaluateGate({ openIssues: open, factcheck: fc.data, critique: cr.data, final: { decision: 'publish', blockingIssues: [], companionIssues: [], remainingUncertainties: [], publicReviewSummary: '' }, policy });
    const detected = [...new Set(open.filter((i) => i.severity !== 'minor' || c.id === 'hollow').map((i) => i.type))];
    const failedChecklist = cr.data.checklist.filter((x) => x.verdict === 'fail').map((x) => x.item);
    const badClaims = fc.data.claims.filter((x) => ['contradicted', 'unsupported'].includes(x.verdict));
    const hit = c.expectTypes.length === 0 ? null : c.expectTypes.some((t) => detected.includes(t)) || (badClaims.length > 0 && c.expectTypes.some((t) => FACT_TYPES.includes(t)));
    const ok = c.expectBlock ? !gate.publishable : c.expectRevision ? open.some((i) => c.expectTypes.includes(i.type)) : gate.publishable;
    results.push({
      id: c.id, label: c.label, expectBlock: c.expectBlock, blocked: !gate.publishable, outcomeAsExpected: ok, expectedTypeDetected: hit,
      detectedTypes: detected, failedChecklist,
      byLayer: {
        code: code.issues.filter((i) => isBlockingIssue(i, policy)).map((i) => i.type),
        factcheck: fc.data.issues.map((i) => `${i.type}/${i.severity}`),
        critique: cr.data.issues.map((i) => `${i.type}/${i.severity}`),
        claims: badClaims.map((x) => x.quote.slice(0, 60)),
      },
      blockers: gate.blockers.slice(0, 5).map((b) => `${b.kind}/${b.type}`),
    });
    console.log(`${ok ? 'PASS' : 'FAIL'} ${c.id}: blocked=${!gate.publishable} detected=${detected.join(',')}`);
  }
  const report = { at: toKstIso(nowMs()), reviewer: reviewIndependence(), budget: budget.state, results };
  writeState('adversarial-report.json', report);
  const md = [
    '# 결함 주입 검증 결과',
    '',
    `- 실행 시각: ${report.at}`,
    `- 검토 구성: ${report.reviewer.label}`,
    `- 사용량: 호출 ${budget.state.calls}회, 입력 ${budget.state.inputTokens} 토큰, 출력 ${budget.state.outputTokens} 토큰, 추정 $${budget.state.usd}`,
    '- ⑧ 최종 검토를 통과로 가정하고, 코드 검사·사실 검증·논리 비판만으로 차단되는지 측정했다(실제 운영에서는 최종 검토가 한 번 더 막는다).',
    '',
    '| 사례 | 기대 | 결과 | 기대 유형 탐지 | 탐지 유형 | 차단 근거 |',
    '|---|---|---|---|---|---|',
    ...results.map((r) => `| ${r.label} | ${r.expectBlock ? '차단' : r.id === 'hollow' ? '수정 유도' : '통과'} | ${r.outcomeAsExpected ? '기대대로' : '기대와 다름'} · ${r.blocked ? '차단됨' : '통과'} | ${r.expectedTypeDetected === null ? '-' : r.expectedTypeDetected ? '예' : '아니오'} | ${r.detectedTypes.join(', ') || '-'} | ${r.blockers.join(', ') || '-'} |`),
    '',
    '## 한계',
    '- 같은 모델이 쓰고 검토하면 같은 맹점을 공유할 수 있다. 검토 역할을 다른 제공자 모델로 바꾸면(NJ_REVIEWER_PROVIDER) 이 표를 다시 만들어 비교해야 한다.',
    '- 출처 자체가 틀린 경우, 출처에 없는 맥락(예: 오래된 통계의 시점 차이), 미묘한 뉘앙스 왜곡은 탐지하지 못할 수 있다.',
    '- LLM 판정은 실행마다 달라질 수 있으므로 한 번의 통과가 항상 통과를 보장하지 않는다.',
  ].join('\n');
  fs.writeFileSync(path.join(PKG_ROOT, 'docs', 'adversarial-report.md'), `${md}\n`);
  return report;
}
