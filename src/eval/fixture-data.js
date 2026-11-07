// ⚠ 테스트 전용 가상 데이터. 실제 기사·실제 지명·실제 기관이 아니다(가온시·나래시는 가상의 도시).
// 파이프라인 전체 흐름과 품질 게이트를 오프라인에서 검증하고, 화면 확인용 견본 사이트를 만드는 데만 쓴다.

export const LIB_FACTS = {
  headline: '[테스트] 가온시 시립도서관 야간 운영 축소 계획',
  category: 'society',
  eventDate: '2026-11-07',
  eventDateBasis: '시 발표 보도자료 게시일과 기사 본문의 "7일 발표" 표현',
  developmentStage: 'announced',
  developmentStageNote: '시가 계획을 발표한 단계이며, 관련 예산은 시의회 심사를 앞두고 있다.',
  whatHappened: '가온시는 시립도서관 12곳 가운데 5곳의 평일 19~22시 야간 운영을 내년 3월부터 중단하고 무인 대출기 20대를 설치하겠다는 계획을 발표했다. 시는 연간 인건비 9억 원을 절감할 수 있다고 밝혔다. 도서관 노동조합은 계획 철회를 요구하는 성명을 냈다. 관련 예산은 11월 20일 시의회 예산 심사에서 다뤄질 예정이다.',
  whatChangedInWindow: '시가 야간 운영 중단 대상(5곳)과 시행 시점(내년 3월), 대체 수단(무인 대출기 20대)을 처음 공식 발표했다.',
  facts: [
    { id: 'F1', statement: '가온시는 시립도서관 12곳 가운데 5곳의 평일 19~22시 야간 운영을 내년 3월부터 중단하겠다고 발표했다.', kind: 'confirmed', attributedTo: null, sourceIds: ['S1', 'S2', 'S3'], asOf: '2026-11-07', accessBasis: 'full_text' },
    { id: 'F2', statement: '가온시는 야간 운영을 중단하는 도서관에 무인 대출기 20대를 설치할 계획이라고 밝혔다.', kind: 'confirmed', attributedTo: null, sourceIds: ['S1', 'S2'], asOf: '2026-11-07', accessBasis: 'full_text' },
    { id: 'F3', statement: '가온시는 이번 조치로 연간 인건비 9억 원을 절감할 수 있다고 밝혔다.', kind: 'party_claim', attributedTo: '가온시', sourceIds: ['S1', 'S3'], asOf: '2026-11-07', accessBasis: 'full_text' },
    { id: 'F4', statement: '가온시 자료에 따르면 야간 이용자 가운데 청소년과 직장인이 61%를 차지한다.', kind: 'party_claim', attributedTo: '가온시', sourceIds: ['S1'], asOf: '2026-11-07', accessBasis: 'full_text' },
    { id: 'F5', statement: '가온시 도서관 노동조합은 야간 운영 중단 계획의 철회를 요구하는 성명을 냈다.', kind: 'confirmed', attributedTo: null, sourceIds: ['S2', 'S3'], asOf: '2026-11-07', accessBasis: 'full_text' },
    { id: 'F6', statement: '관련 예산은 11월 20일 가온시의회 예산 심사에서 다뤄질 예정이다.', kind: 'scheduled', attributedTo: null, sourceIds: ['S2'], asOf: '2026-11-07', accessBasis: 'full_text' },
    { id: 'F7', statement: '무인 대출기는 대출과 반납 기능만 제공하며 열람실 운영과 사서 상담은 포함하지 않는다.', kind: 'confirmed', attributedTo: null, sourceIds: ['S1', 'S3'], asOf: '2026-11-07', accessBasis: 'full_text' },
  ],
  stakeholders: [
    { name: '가온시', position: '야간 운영 축소와 무인 대출기 도입', interest: '인건비 절감과 예산 재배분', sourceIds: ['S1'] },
    { name: '도서관 노동조합', position: '계획 철회 요구', interest: '고용·근무 조건과 공공서비스 유지', sourceIds: ['S2'] },
    { name: '야간 이용자(청소년·직장인)', position: '공식 입장 없음', interest: '이용 가능한 시간대의 학습 공간과 서비스', sourceIds: ['S1'] },
  ],
  discrepancies: [],
  uncertainties: ['지점별 야간 이용 실적은 공개되지 않았다.', '절감액 9억 원의 산정 근거는 시가 밝히지 않았다.'],
  legalStatusNote: null,
  sourceNotes: [
    { sourceId: 'S1', independence: 'official_primary', sameOriginAs: null, note: '시 보도자료(테스트)' },
    { sourceId: 'S2', independence: 'independent_reporting', sameOriginAs: null, note: '노조 성명과 시의회 일정을 별도 취재' },
    { sourceId: 'S3', independence: 'independent_reporting', sameOriginAs: null, note: '이용자 반응 별도 취재' },
  ],
  ignoredInstructions: null,
  suitability: { enoughEvidence: true, reason: '공식 발표와 독립 보도가 함께 있고 가치 충돌이 분명하다.' },
};

export const LIB_QUESTION = {
  title: '[테스트] 무인 대출기는 야간 도서관을 대신할 수 있는가',
  questionType: 'policy_evaluation',
  whyThisType: '시가 구체적 계획을 발표했고, 그 계획이 공공서비스의 목적에 부합하는지를 평가하는 것이 핵심이다.',
  background: '가온시는 시립도서관 12곳 가운데 5곳의 평일 19~22시 야간 운영을 내년 3월부터 중단하고 무인 대출기 20대를 설치하겠다고 발표했다. 시는 연간 인건비 9억 원을 절감할 수 있다고 밝혔고, 도서관 노동조합은 계획 철회를 요구했다. 관련 예산은 11월 20일 시의회 예산 심사에서 다뤄질 예정이다.',
  passages: [
    { label: '가', text: '시의 설명을 바탕으로 재구성: 한정된 예산을 이용이 적은 시간대에 계속 쓰기보다, 대출·반납은 무인 기기로 처리하고 절감한 인건비를 다른 공공서비스에 돌리는 것이 합리적이다.', basisFactIds: ['F2', 'F3'] },
    { label: '나', text: '노동조합 성명과 이용자 반응을 바탕으로 재구성: 도서관은 책을 빌리는 곳만이 아니라 낮에 시간을 내기 어려운 시민이 공부하고 도움을 받는 공간이며, 기계는 그 역할을 대신하지 못한다.', basisFactIds: ['F4', 'F5', 'F7'] },
  ],
  prompt: '제시문 (가)와 (나)의 관점을 참고하여, 가온시의 야간 운영 중단 계획을 공공도서관이 보장해야 할 접근성의 관점에서 평가하고, 재정 절감 목표와 접근성을 함께 고려한 운영 방안을 제시하시오.',
  requirements: [
    { id: 'R1', text: '공공도서관의 접근성이 무엇을 뜻하는지 정의하고 그 기준으로 계획을 평가할 것' },
    { id: 'R2', text: '제시문 (가)의 재정 효율 논거를 가장 강한 형태로 검토할 것' },
    { id: 'R3', text: '실행 주체와 절차, 비용과 부작용을 포함한 운영 방안을 제시할 것' },
  ],
  timeMinutes: 60,
  intent: '공공서비스 축소를 비용 절감만으로 판단하지 않고, 손실의 분배와 대체 가능성을 기준으로 평가하는 능력을 본다.',
  rubric: [
    { criterion: '요구사항 충족', description: 'R1~R3을 모두 다루었는가', weight: 25 },
    { criterion: '개념 정의와 평가 기준', description: '접근성을 정의하고 그 기준을 일관되게 적용했는가', weight: 25 },
    { criterion: '반론 처리', description: '재정 효율 논거를 약화하지 않고 다룬 뒤 응답했는가', weight: 25 },
    { criterion: '대안의 타당성', description: '주체·절차·비용·부작용이 구체적인가', weight: 25 },
  ],
  stanceNeutrality: '계획을 지지하는 답안도 R1~R3을 충족하면 높은 평가를 받을 수 있도록 기준을 입장과 무관하게 구성했다.',
  notGeneric: '무인 대출기가 대체하는 서비스와 대체하지 못하는 서비스를 구분해야만 답할 수 있다.',
};

export const LIB_DESIGN = {
  thesis: '야간 운영 일괄 중단은 대체 수단이 없는 집단에 손실을 몰아 공공도서관의 접근성 기준에 어긋나며, 이용 실적에 근거한 권역별 거점 유지가 더 타당하다.',
  stance: 'conditional_position',
  whyThisStance: '운영 축소 자체는 이용 실적에 따라 정당할 수 있으므로, 축소 방식에 조건을 붙인 입장이 사실관계에 맞다.',
  definitions: [{ term: '접근성', meaning: '이용자가 실제로 이용 가능한 시간에 필요한 서비스를 받을 수 있는 정도', whyNeeded: '개방 여부와 서비스 이용 가능성을 구분해야 평가가 가능하다.' }],
  scope: '가온시 계획의 방식과 대안에 한정한다. 도서관 정책 일반은 다루지 않는다.',
  judgmentCriteria: '공공서비스 축소는 손실이 특정 집단에 집중되고 대체 경로가 없을 때 절감액만으로 정당화될 수 없다.',
  paragraphs: [
    { index: 1, role: 'introduction', claim: '논점 제시', factIds: ['F1', 'F2'], reasoning: '사건과 질문을 연결', requirementIds: ['R1'] },
    { index: 2, role: 'definition_scope', claim: '접근성 정의', factIds: ['F4'], reasoning: '야간 이용자 구성이 접근성의 의미를 구체화', requirementIds: ['R1'] },
    { index: 3, role: 'argument', claim: '무인 대출기는 손실 일부만 메움', factIds: ['F7'], reasoning: '대체 가능한 서비스와 불가능한 서비스 구분', requirementIds: ['R1'] },
    { index: 4, role: 'objection', claim: '재정 효율 논거', factIds: ['F3'], reasoning: '기회비용과 형평 논거', requirementIds: ['R2'] },
    { index: 5, role: 'rebuttal', claim: '판단 기준과 조건', factIds: ['F1'], reasoning: '손실 집중·대체 경로 기준', requirementIds: ['R2'] },
    { index: 6, role: 'proposal', claim: '권역별 거점 유지', factIds: ['F6', 'F5'], reasoning: '절감 목표와 접근성 동시 고려', requirementIds: ['R3'] },
    { index: 7, role: 'conclusion', claim: '결론', factIds: [], reasoning: '본론 범위 내 결론', requirementIds: ['R1'] },
  ],
  premises: [
    { statement: '야간 이용자 다수는 다른 시간대 이용이 어렵다.', type: 'factual', supportedBy: ['F4'] },
    { statement: '공공서비스 축소의 정당성은 손실의 분배에 따라 달라진다.', type: 'normative', supportedBy: [] },
  ],
  strongestObjection: { statement: '절감액은 다른 공공서비스의 기회비용이며 이용이 적은 지점까지 같은 시간 운영하는 것은 비효율적이다.', basis: 'F3', whyStrongest: '예산 제약은 실재하고 형평 논리로도 뒷받침된다.' },
  response: { concede: '모든 지점의 동일 운영시간 유지는 정당화하기 어렵다.', reply: '손실이 대체 수단 없는 집단에 몰리면 절감액만으로 정당화되지 않는다.', conditionsThesisHolds: '지점별 이용 실적이 공개되어 일부 지점 이용이 적다면 축소 자체는 수용 가능하다.' },
  proposal: { needed: true, reasonIfNotNeeded: null, actor: '가온시(도서관 운영 부서)', instrument: '권역별 거점 야간 운영 유지', procedure: '시의회 예산 심사 전 지점별 통계 공개 후 거점 선정', costs: '절감액 축소', sideEffects: '거점까지 이동 거리 증가', conflicts: '노조와 근무 시간 조정', mitigations: '대중교통 접근성 기준으로 거점 선정, 노조와 사전 협의' },
  conclusionBoundary: '가온시 계획의 방식에 대한 평가에 한정한다.',
  failureConditions: ['지점별 야간 이용 실적이 모든 지점에서 매우 낮다면 일괄 축소도 정당화될 수 있다.', '야간 이용자에게 다른 대체 학습 공간이 충분히 있다면 손실 집중 논거가 약해진다.'],
};

export const LIB_ANSWER = `가온시가 시립도서관 12곳 가운데 5곳의 평일 야간 운영을 내년 3월부터 중단하고, 그 자리를 무인 대출기 20대로 채우겠다고 발표했다. 시는 인건비 절감을 이유로 들지만, 이 계획이 실제로 줄이는 것이 비용뿐인지는 따져 볼 필요가 있다. 이 글은 공공도서관이 보장해야 할 접근성이 무엇인지부터 정하고, 그 기준으로 계획을 평가한 뒤 절감 목표와 함께 갈 수 있는 운영 방식을 제시한다.

도서관의 접근성은 건물이 열려 있다는 사실만을 뜻하지 않는다. 이용자가 실제로 쓸 수 있는 시간에 필요한 서비스를 받을 수 있어야 접근성이 성립한다. 도서관이 제공하는 서비스는 대출과 반납, 열람과 학습 공간, 사서의 자료 안내로 나눌 수 있다. 시 자료에 따르면 야간 이용자 가운데 청소년과 직장인이 61%를 차지한다. 낮에 학교나 직장에 묶여 있는 이들에게 야간은 도서관을 이용할 수 있는 사실상 유일한 시간대다.

이 기준으로 보면 무인 대출기는 손실의 일부만 메운다. 대출과 반납은 기계로 처리할 수 있지만, 조용히 공부할 자리와 자료 찾기를 돕는 사람은 기계가 대신하지 못한다. 예컨대 시험을 앞둔 고등학생이 밤마다 찾던 열람실이 닫힌다고 가정해 보자. 이 학생은 무인 대출기에서 책을 빌릴 수는 있어도 공부할 자리는 다시 찾아야 한다. 계획이 줄이는 것은 야간 서비스 전체가 아니라 그중 대체하기 가장 어려운 부분인 셈이다. 게다가 그 손실은 시민 전체에 고르게 퍼지지 않고, 야간 말고는 시간을 내기 어려운 집단에 몰린다.

반대 논거도 가볍지 않다. 시는 이번 조치로 연간 인건비 9억 원을 아낄 수 있다고 밝혔다. 예산은 한정되어 있고, 그 돈은 다른 공공서비스에 쓰일 수 있다. 이용자가 적은 지점까지 모두 같은 시간 동안 문을 열어 두는 것은 오히려 다른 시민에게 불공평하다는 주장도 가능하다. 모든 지점의 운영시간을 지금처럼 유지하라는 요구는 이 반론 앞에서 정당화하기 어렵다.

그러나 절감액이 크다는 사실만으로 계획이 정당해지지는 않는다. 공공서비스를 줄일 때는 손실이 특정 집단에 집중되는지, 그 집단에 다른 이용 경로가 남는지를 함께 따져야 한다. 여기서 판단 기준은 총절감액의 크기가 아니라 줄어드는 서비스의 대체 가능성과 손실을 떠안는 사람의 범위다. 이번 계획은 두 조건 모두에서 약하다. 다만 시가 지점별 야간 이용 실적을 공개하고, 일부 지점의 이용이 실제로 적다는 점이 확인된다면 운영 축소 자체는 받아들일 수 있다. 문제는 축소가 아니라 근거를 공개하지 않은 채 5곳을 한꺼번에 닫는 방식이다.

대안은 일괄 중단 대신 권역마다 거점 도서관 한 곳씩은 야간 운영을 유지하는 것이다. 시는 11월 20일로 예정된 시의회 예산 심사 전에 지점별 야간 이용 통계를 공개하고, 이용이 많은 지점을 거점으로 정한다. 나머지 지점은 무인 대출기로 대출과 반납만 이어 간다. 이렇게 하면 절감액은 원안보다 줄지만, 열람 공간과 사서 상담처럼 기계가 대신할 수 없는 서비스는 권역마다 남는다. 거점까지 이동 거리가 늘어나는 이용자가 생기므로 거점은 대중교통으로 가기 쉬운 지점으로 고르고, 근무 시간 조정은 도서관 노동조합과 미리 협의해야 갈등을 줄일 수 있다.

이 계획의 쟁점은 비용을 아끼느냐가 아니라 누구의 접근성을 줄이느냐에 있다. 손실이 대체 수단이 없는 집단에 몰리는 한, 일괄 중단은 공공도서관의 역할과 맞지 않는다. 이용 실적에 근거해 거점을 남기는 방식이라면 시는 재정 목표의 상당 부분을 지키면서도 그 역할을 포기하지 않을 수 있다.`;

/** 초안(수정 전): 결론이 상투적 문구로 끝난다 — 검토가 잡아내고 수정되는 과정을 보여주기 위함 */
export const LIB_DRAFT = LIB_ANSWER.replace(
  /이 계획의 쟁점은[\s\S]*$/,
  '이 계획의 쟁점은 비용을 아끼느냐가 아니라 누구의 접근성을 줄이느냐에 있다. 손실이 대체 수단이 없는 집단에 몰리는 한, 일괄 중단은 공공도서관의 역할과 맞지 않는다. 결국 이 문제는 시와 시민이 사회적 합의를 이루어야 해결될 수 있으며, 모두의 관심과 노력이 필요하다.',
);

export const LIB_ROLES = [
  { index: 1, role: 'introduction', requirementIds: ['R1'], factIds: ['F1', 'F2'] },
  { index: 2, role: 'definition_scope', requirementIds: ['R1'], factIds: ['F4'] },
  { index: 3, role: 'argument', requirementIds: ['R1'], factIds: ['F7'] },
  { index: 4, role: 'objection', requirementIds: ['R2'], factIds: ['F3'] },
  { index: 5, role: 'rebuttal', requirementIds: ['R2'], factIds: ['F1'] },
  { index: 6, role: 'proposal', requirementIds: ['R3'], factIds: ['F6', 'F5'] },
  { index: 7, role: 'conclusion', requirementIds: ['R1'], factIds: [] },
];

export const LIB_COMPANION = {
  briefing: {
    stakeholderSummary: '시는 인건비 절감과 예산 재배분을, 노동조합은 고용과 공공서비스 유지를 내세운다. 야간 이용자인 청소년과 직장인은 공식 입장을 내지 않았지만 손실이 가장 직접적으로 미치는 집단이다.',
    valueConflicts: [{ values: ['재정 효율', '공공서비스 접근성'], description: '같은 예산으로 더 많은 시민에게 서비스를 줄 것인가, 특정 시간대에만 이용 가능한 시민의 접근을 지킬 것인가.' }],
    coreIssues: ['무인 기기가 대체하는 서비스와 대체하지 못하는 서비스의 구분', '축소의 손실이 누구에게 집중되는가', '이용 실적 공개 없이 일괄 축소하는 결정 방식'],
    whySelected: '공공서비스 축소를 비용만이 아니라 손실의 분배로 평가하는 연습에 적합하고, 다른 공공시설 운영 문제에도 같은 틀을 적용할 수 있다.',
  },
  logic: {
    centralQuestion: '무인 대출기 도입을 전제로 한 야간 운영 일괄 중단이 공공도서관의 접근성 기준에 부합하는가.',
    finalPosition: '일괄 중단은 부합하지 않으며, 이용 실적에 근거한 권역별 거점 유지가 타당하다(조건부).',
    paragraphs: [
      { index: 1, role: '서론', mainClaim: '계획이 줄이는 것이 비용뿐인지 따져야 한다.', evidenceFactIds: ['F1', 'F2'], inference: '사건을 접근성 평가의 문제로 재구성한다.' },
      { index: 2, role: '개념 정의', mainClaim: '접근성은 이용 가능한 시간에 필요한 서비스를 받을 수 있는 정도다.', evidenceFactIds: ['F4'], inference: '야간 이용자 구성이 야간 시간대의 대체 불가능성을 보여준다.' },
      { index: 3, role: '평가', mainClaim: '무인 대출기는 손실의 일부만 메운다.', evidenceFactIds: ['F7'], inference: '대체 가능한 서비스(대출·반납)와 불가능한 서비스(열람·상담)를 구분하면 손실의 핵심이 드러난다.' },
      { index: 4, role: '반론', mainClaim: '절감액의 기회비용과 형평 논거는 타당한 부분이 있다.', evidenceFactIds: ['F3'], inference: '모든 지점 동일 운영 요구는 정당화가 어렵다는 점을 인정한다.' },
      { index: 5, role: '재반박', mainClaim: '손실 집중과 대체 경로 부재가 확인되면 절감액만으로 정당화되지 않는다.', evidenceFactIds: ['F1'], inference: '판단 기준을 명시하고, 주장이 유지되는 조건(이용 실적 공개)을 밝힌다.' },
      { index: 6, role: '대안', mainClaim: '권역별 거점 야간 운영 유지.', evidenceFactIds: ['F6', 'F5'], inference: '절감 목표 일부를 유지하면서 대체 불가능한 서비스를 남긴다.' },
      { index: 7, role: '결론', mainClaim: '쟁점은 누구의 접근성을 줄이느냐다.', evidenceFactIds: [], inference: '본론의 기준과 조건 안에서 결론을 맺는다.' },
    ],
    premises: ['야간 이용자 다수는 다른 시간대에 이용하기 어렵다(시 자료, 당사자 주장).', '공공서비스 축소의 정당성은 손실의 분배에 따라 달라진다(규범적 전제).'],
    strongestObjection: '절감한 9억 원은 다른 공공서비스의 재원이며, 이용이 적은 지점까지 같은 시간 운영하는 것은 다른 시민에게 불공평하다.',
    rebuttal: '반론의 타당성을 인정하되, 손실이 대체 경로 없는 집단에 집중되는 한 절감액만으로는 정당화되지 않는다고 응답한다.',
    proposalConditions: '지점별 이용 통계 공개, 대중교통 접근성을 기준으로 한 거점 선정, 노동조합과의 사전 협의가 전제되어야 한다.',
    failureConditions: ['모든 지점의 야간 이용 실적이 매우 낮게 확인되는 경우', '야간 이용자가 쓸 수 있는 다른 학습 공간이 충분한 경우'],
  },
  alternatives: [
    {
      position: '계획을 지지하는 답안',
      valuePriority: '한정된 예산을 이용 총량이 많은 서비스에 우선 배분하는 효율과 형평을 더 중시한다.',
      factualPremise: '야간 이용 총량이 낮고, 인근에 대체 학습 공간이 있다는 사실이 확인된다고 전제한다.',
      outline: ['예산 제약과 기회비용 제시', '야간 이용 실적 공개를 조건으로 일괄 축소의 효율성 논증', '무인 대출기와 인근 공공 학습 공간 연계로 손실 완화', '절감액의 사용처를 공개해 정당성 확보'],
      keyFactIds: ['F3', 'F2'],
      weakPoint: '현재 지점별 이용 실적이 공개되지 않아, 이 입장의 핵심 사실 전제가 아직 확인되지 않았다.',
    },
  ],
  alternativesNote: '계획 지지 입장은 효율을 우선하는 가치 판단과 야간 이용이 적다는 사실 전제가 확인되면 성립한다. 다만 그 전제는 아직 공개 자료로 확인되지 않았다.',
  learning: {
    concepts: [
      { term: '접근성', explanation: '개방 여부가 아니라 실제 이용 가능한 시간에 필요한 서비스를 받을 수 있는 정도.' },
      { term: '기회비용', explanation: '어떤 선택에 쓴 자원으로 대신 얻을 수 있었던 가장 큰 가치.' },
      { term: '손실의 분배', explanation: '정책 변화의 부담이 누구에게 얼마나 집중되는지를 따지는 관점.' },
      { term: '대체 가능성', explanation: '줄어드는 서비스를 다른 수단이 얼마나 대신할 수 있는가.' },
    ],
    commonErrors: [
      { name: '비용 단일 기준', howItAppears: '절감액이 크다는 사실만으로 정책을 정당화한다.' },
      { name: '허수아비 반박', howItAppears: '시의 입장을 "돈만 아끼려 한다"로 단순화해 반박한다.' },
      { name: '형식적 대안', howItAppears: '"시민 의견을 수렴해야 한다"처럼 주체와 절차 없는 대안을 제시한다.' },
    ],
    transferableMethods: ['서비스를 기능별로 쪼개 대체 가능한 부분과 불가능한 부분을 구분하기', '정책의 총편익뿐 아니라 손실이 누구에게 집중되는지 따지기'],
    furtherQuestions: ['지점별 이용 실적이 공개되어 모든 지점의 이용이 적다면 결론은 어떻게 달라지는가?', '공공 서비스의 무인화는 어떤 서비스에서 정당화되기 쉬운가?'],
  },
  followUp: null,
};

/** 2일차: 의도적으로 사실표에 없는 수치("3배")를 넣은 초안 — 수정 상한 안에 고쳐지지 않아 보류되어야 한다. */
export const SCOOTER_FACTS = {
  headline: '[테스트] 나래시 전동킥보드 보도 주차 금지 조례 입법예고',
  category: 'society',
  eventDate: '2026-11-08',
  eventDateBasis: '입법예고 공고일',
  developmentStage: 'proposed',
  developmentStageNote: '조례안 입법예고 단계로, 시의회 의결 전이다.',
  whatHappened: '나래시는 공유 전동킥보드의 보도 주차를 전면 금지하고 지정 주차구역 외 주차 시 즉시 견인하는 조례안을 입법예고했다. 공유 킥보드 업체들은 이용자 감소를 우려했다.',
  whatChangedInWindow: '조례안이 처음 입법예고되었다.',
  facts: [
    { id: 'F1', statement: '나래시는 공유 전동킥보드의 보도 주차를 전면 금지하는 조례안을 입법예고했다.', kind: 'confirmed', attributedTo: null, sourceIds: ['S1', 'S2'], asOf: '2026-11-08', accessBasis: 'full_text' },
    { id: 'F2', statement: '조례안은 지정 주차구역 밖에 세워진 킥보드를 즉시 견인할 수 있도록 했다.', kind: 'confirmed', attributedTo: null, sourceIds: ['S1', 'S2'], asOf: '2026-11-08', accessBasis: 'full_text' },
    { id: 'F4', statement: '조례안은 시의회 의결을 거쳐야 시행된다.', kind: 'confirmed', attributedTo: null, sourceIds: ['S1'], asOf: '2026-11-08', accessBasis: 'full_text' },
    { id: 'F5', statement: '지정 주차구역의 규모는 공개되지 않았다.', kind: 'confirmed', attributedTo: null, sourceIds: ['S1', 'S2'], asOf: '2026-11-08', accessBasis: 'full_text' },
    { id: 'F3', statement: '공유 킥보드 업체들은 조례가 시행되면 이용자가 줄어들 것이라고 우려했다.', kind: 'party_claim', attributedTo: '공유 킥보드 업체', sourceIds: ['S2'], asOf: '2026-11-08', accessBasis: 'full_text' },
  ],
  stakeholders: [
    { name: '나래시', position: '보도 주차 금지', interest: '보행 안전', sourceIds: ['S1'] },
    { name: '공유 킥보드 업체', position: '우려', interest: '사업 유지', sourceIds: ['S2'] },
  ],
  discrepancies: [],
  uncertainties: ['지정 주차구역의 규모는 공개되지 않았다.'],
  legalStatusNote: null,
  sourceNotes: [
    { sourceId: 'S1', independence: 'official_primary', sameOriginAs: null, note: '시 공고(테스트)' },
    { sourceId: 'S2', independence: 'independent_reporting', sameOriginAs: null, note: '업계 반응 취재' },
  ],
  ignoredInstructions: null,
  suitability: { enoughEvidence: true, reason: '조례안 원문과 이해관계자 반응이 있다.' },
};
