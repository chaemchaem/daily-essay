// ⚠ 테스트 전용 LLM 대역. 실제 모델 호출 없이 파이프라인의 흐름·저장·게이트를 검증하기 위해 고정 응답을 돌려준다.
// 이 응답으로 만든 결과물은 모두 test=true로 표시되고 실제 발행 데이터와 섞이지 않는다.
import * as F from './fixture-data.js';
import { countChars } from '../lib/text.js';

const CHECK = ['requirements_covered', 'concept_consistency', 'premises_explicit', 'no_unwarranted_generalization', 'no_causal_leap', 'no_circular_reasoning', 'no_straw_man', 'no_false_dilemma', 'no_internal_contradiction', 'fact_opinion_separated', 'proposal_matches_cause', 'proposal_feasible', 'objection_answered', 'conclusion_within_scope', 'not_duplicate_of_recent', 'paragraph_roles_connected', 'value_judgment_criteria_stated', 'no_hollow_conclusion'];

export function scooterText() {
  const base = [
    '나래시가 공유 전동킥보드의 보도 주차를 전면 금지하는 조례안을 입법예고했다. 이 글은 보행 안전과 이동 수단 선택의 자유가 충돌하는 지점을 살핀다.',
    '조례안은 지정 주차구역 밖에 세워진 킥보드를 즉시 견인할 수 있도록 했다. 시행 첫해 견인 건수가 3배로 늘어날 것이 분명하다.',
    '공유 킥보드 업체들은 조례가 시행되면 이용자가 줄어들 것이라고 우려했다. 이 우려는 사업자의 이해관계에서 나온 주장이지만, 단거리 이동 수단이 줄어드는 문제와도 연결된다.',
  ];
  let text = base.join('\n\n');
  const pad = '보도는 보행자가 가장 먼저 쓰는 공간이며, 그 공간을 누가 얼마나 차지하는지는 도시 설계의 기본 문제다. 주차 질서를 세우는 방식이 이동 수단의 존속까지 좌우한다면 규제의 범위를 다시 따져야 한다.';
  while (countChars(text) < 1650) text += `\n\n${pad}`;
  return text;
}

function priorIds(prompt) {
  const sec = prompt.split('[이전 검토에서 지적된')[1] || '';
  return [...sec.matchAll(/"id":\s*"(R\d+-[A-Z]\d+)"/g)].map((m) => m[1]);
}

function topicOf(prompt) {
  if (prompt.includes('킥보드')) return 'scooter';
  return 'library';
}

export async function mockHandler({ stage, prompt }) {
  const day2 = prompt.includes('[발행호] 2026-11-09');
  if (stage.startsWith('triage')) {
    const cands = [...prompt.matchAll(/<candidate id="([^"]+)"[^>]*>([\s\S]*?)<\/candidate>/g)].map((m) => ({ id: m[1], text: m[2] }));
    const threadId = (prompt.match(/"threadId":\s*"(th-[^"]+)"/) || [])[1] || null;
    const firstLib = cands.find((c) => c.text.includes('도서관') && !c.text.includes('서명'));
    return {
      clusters: cands.map((c) => {
        const score = (n) => ({ publicSignificance: n, valueConflict: n, arguability: n, evidenceAvailability: n, conceptualTransfer: n });
        const common = { mergeInto: null, eventDateBasis: '기사 본문 날짜 표현(테스트)', essayAngles: [], scoreRationale: '테스트 판정' };
        if (c.text.includes('도서관') && c.text.includes('서명')) {
          return { ...common, clusterId: c.id, eventSummary: '[테스트] 가온시 도서관 노조가 야간 운영 중단 반대 서명을 시에 제출했다.', eventDate: '2026-11-08', timing: 'target_day', category: 'society', exclude: false, excludeReason: null,
            threadMatch: { threadId, relation: 'minor_update', changeTypes: ['none'], whatChanged: '[테스트] 노조가 반대 서명을 제출했으나 정책 단계나 논점은 바뀌지 않았다.', priorFactsPossiblyInvalidated: null, rationale: '기존 논점과 같음' }, scores: score(3) };
        }
        if (c.text.includes('도서관')) {
          return { ...common, clusterId: c.id, mergeInto: firstLib && firstLib.id !== c.id ? firstLib.id : null, eventSummary: '[테스트] 가온시가 시립도서관 5곳의 야간 운영 중단과 무인 대출기 도입 계획을 발표했다.', eventDate: '2026-11-07', timing: 'target_day', category: 'society', exclude: false, excludeReason: null,
            threadMatch: { threadId: null, relation: 'new', changeTypes: [], whatChanged: null, priorFactsPossiblyInvalidated: null, rationale: '새 이슈' }, scores: score(4), essayAngles: ['공공서비스 축소와 접근성', '무인화의 대체 가능성'] };
        }
        if (c.text.includes('킥보드')) {
          return { ...common, clusterId: c.id, eventSummary: '[테스트] 나래시가 전동킥보드 보도 주차 금지 조례안을 입법예고했다.', eventDate: '2026-11-08', timing: 'target_day', category: 'society', exclude: false, excludeReason: null,
            threadMatch: { threadId: null, relation: 'new', changeTypes: [], whatChanged: null, priorFactsPossiblyInvalidated: null, rationale: '새 이슈' }, scores: score(4), essayAngles: ['보행 안전과 이동의 자유'] };
        }
        return { ...common, clusterId: c.id, eventSummary: '[테스트] 지역 행사 안내', eventDate: day2 ? '2026-11-08' : '2026-11-07', timing: 'target_day', category: 'culture', exclude: true, excludeReason: '단순 행사 안내(테스트)',
          threadMatch: { threadId: null, relation: 'new', changeTypes: [], whatChanged: null, priorFactsPossiblyInvalidated: null, rationale: '-' }, scores: score(1) };
      }),
    };
  }
  const topic = topicOf(prompt);
  const round = Number((stage.match(/_r(\d+)$/) || [])[1] || 0);
  if (stage === 'facts') return topic === 'library' ? F.LIB_FACTS : F.SCOOTER_FACTS;
  if (stage.startsWith('question')) {
    if (topic === 'library') return F.LIB_QUESTION;
    return { ...F.LIB_QUESTION, title: '[테스트] 보도 위의 킥보드, 누구의 공간인가', background: F.SCOOTER_FACTS.whatHappened, passages: [], prompt: '나래시 조례안이 보행 안전과 이동 수단 선택의 자유 사이에서 어떤 선택을 했는지 평가하고, 그 선택이 정당화되는 조건을 논하시오.', requirements: [{ id: 'R1', text: '충돌하는 두 가치를 정의할 것' }, { id: 'R2', text: '조례안의 선택이 정당화되는 조건을 제시할 것' }] };
  }
  if (stage === 'design') return F.LIB_DESIGN;
  if (stage === 'draft') {
    if (topic === 'library') return { text: F.LIB_DRAFT, paragraphRoles: F.LIB_ROLES };
    const n = scooterText().split('\n\n').length;
    return { text: scooterText(), paragraphRoles: Array.from({ length: n }, (_, i) => ({ index: i + 1, role: i === 0 ? 'introduction' : 'argument', requirementIds: i === 0 ? ['R1'] : ['R2'], factIds: ['F1'] })) };
  }
  if (stage.startsWith('factcheck')) {
    const prior = priorIds(prompt);
    if (topic === 'scooter') {
      return { priorIssueStatus: prior.map((id) => ({ issueId: id, status: 'unresolved', note: '같은 문장이 그대로 남아 있음' })),
        claims: [{ paragraph: 2, quote: '시행 첫해 견인 건수가 3배로 늘어날 것이 분명하다.', kind: 'statistical', verdict: 'unsupported', factIds: [], sourceIds: [], note: '출처에 견인 건수 전망이 없음' }],
        issues: [{ location: { paragraph: 2, quote: '견인 건수가 3배로 늘어날 것이 분명하다' }, type: 'fabricated_detail', severity: 'critical', evidence: '사실표와 원출처에 없는 수치이며 전망을 확정처럼 서술', fixDirection: '삭제하거나 확인된 사실로 대체' }],
        factsSheetProblems: [] };
    }
    return { priorIssueStatus: prior.map((id) => ({ issueId: id, status: 'resolved', note: '수정 원고에서 해당 문장이 구체적 결론으로 바뀜' })),
      claims: [
        { paragraph: 1, quote: '시립도서관 12곳 가운데 5곳의 평일 야간 운영을 내년 3월부터 중단', kind: 'factual', verdict: 'supported', factIds: ['F1'], sourceIds: ['S1', 'S2'], note: '' },
        { paragraph: 1, quote: '무인 대출기 20대', kind: 'factual', verdict: 'supported', factIds: ['F2'], sourceIds: ['S1'], note: '' },
        { paragraph: 2, quote: '야간 이용자 가운데 청소년과 직장인이 61%', kind: 'statistical', verdict: 'supported', factIds: ['F4'], sourceIds: ['S1'], note: '시 자료로 명시해 주장 주체를 밝힘' },
        { paragraph: 4, quote: '연간 인건비 9억 원을 아낄 수 있다고 밝혔다', kind: 'attribution', verdict: 'supported', factIds: ['F3'], sourceIds: ['S1', 'S3'], note: '시의 주장으로 서술됨' },
        { paragraph: 6, quote: '11월 20일로 예정된 시의회 예산 심사', kind: 'legal_or_policy_status', verdict: 'supported', factIds: ['F6'], sourceIds: ['S2'], note: '예정으로 서술됨' },
        { paragraph: 5, quote: '절감액이 크다는 사실만으로 계획이 정당해지지는 않는다', kind: 'normative', verdict: 'not_a_factual_claim', factIds: [], sourceIds: [], note: '' },
      ], issues: [], factsSheetProblems: [] };
  }
  if (stage.startsWith('critique')) {
    const prior = priorIds(prompt);
    const firstLib = topic === 'library' && round === 0;
    return {
      priorIssueStatus: prior.map((id) => ({ issueId: id, status: topic === 'scooter' ? 'unresolved' : 'resolved', note: '테스트 판정' })),
      checklist: CHECK.map((item) => ({ item, verdict: firstLib && item === 'no_hollow_conclusion' ? 'fail' : (item.startsWith('proposal') && topic === 'scooter' ? 'not_applicable' : 'pass'), note: firstLib && item === 'no_hollow_conclusion' ? '마지막 두 문장이 구체적 내용 없는 상투적 결론' : '' })),
      issues: firstLib ? [{ location: { paragraph: 7, quote: '사회적 합의를 이루어야 해결될 수 있으며, 모두의 관심과 노력이 필요하다' }, type: 'vague_conclusion', severity: 'major', evidence: '본론에서 제시한 거점 운영안과 판단 기준이 결론에 반영되지 않고 상투적 문구로 끝남', fixDirection: '본론의 기준(손실 집중·대체 가능성)과 대안의 조건을 결론에 반영' }] : [],
      knockOnEffects: round === 0 ? '해당 없음' : '결론 수정이 5문단의 판단 기준과 일관되며 6문단 대안과 연결됨',
      overall: '테스트 판정',
    };
  }
  if (stage.startsWith('revise')) {
    if (topic === 'scooter') { const n = scooterText().split('\n\n').length; return { text: scooterText(), paragraphRoles: Array.from({ length: n }, (_, i) => ({ index: i + 1, role: 'argument', requirementIds: i === 0 ? ['R1'] : ['R2'], factIds: ['F1'] })), changes: [], notAddressed: [{ issueId: 'R0-F1', reason: '(테스트) 수정하지 않음' }], ripple: '없음' }; }
    return { text: F.LIB_ANSWER, paragraphRoles: F.LIB_ROLES, changes: [{ issueIds: ['R0-L1', 'R0-C1'], description: '결론 문단의 상투적 문구("사회적 합의", "모두의 관심과 노력")를 삭제하고, 본론의 판단 기준과 거점 운영안의 조건을 결론에 반영했다.', paragraphsTouched: [7] }], notAddressed: [], ripple: '결론이 5문단의 판단 기준, 6문단의 대안과 같은 범위를 유지하도록 맞췄다.' };
  }
  if (stage === 'companion') return F.LIB_COMPANION;
  if (stage === 'final') {
    return { decision: 'publish', blockingIssues: [], companionIssues: [], remainingUncertainties: ['지점별 야간 이용 실적이 공개되지 않아, 답안의 조건부 결론이 실제 수치로 검증되지 않았다.', '절감액 9억 원은 시의 주장이며 산정 근거는 확인하지 못했다.'],
      publicReviewSummary: '[테스트 데이터] 답안의 수치 5개와 기관 입장 2건을 원출처와 대조했다. 초안 결론의 상투적 문구를 지적해 수정했고, 수정 후 결론이 본론의 판단 기준과 일치하는지 다시 확인했다. 시의 절감액과 이용자 구성 수치는 시 자료에만 근거한 주장으로 표시했다.' };
  }
  throw new Error(`mock: 처리하지 않은 단계 ${stage}`);
}
