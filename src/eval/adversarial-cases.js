// 의도적으로 결함을 넣은 답안 사례. 검증 절차가 이를 탐지해 발행을 막는지 확인하는 데 쓴다.
// codeDetectable=true인 사례는 오프라인 테스트(pnpm test)에서, 나머지는 실제 LLM 검토(eval-adversarial)에서 확인한다.
import { LIB_ANSWER, LIB_DRAFT } from './fixture-data.js';

function must(text, from, to) {
  if (!text.includes(from)) throw new Error(`사례 생성 실패: "${String(from).slice(0, 20)}" 없음`);
  return text.replace(from, to);
}

const OBJECTION = /반대 논거도 가볍지 않다\.[\s\S]*?정당화하기 어렵다\./.exec(LIB_ANSWER)[0];

export const ADVERSARIAL_CASES = [
  {
    id: 'clean', label: '결함 없는 기준 답안(오탐 확인용)', text: LIB_ANSWER, expectBlock: false, codeDetectable: false, expectTypes: [],
  },
  {
    id: 'fact-number', label: '사실 오류: 수치 변경(61% → 81%)', expectBlock: true, codeDetectable: true,
    text: must(LIB_ANSWER, '61%', '81%'), expectTypes: ['fabricated_detail', 'factual_error'],
  },
  {
    id: 'status', label: '진행 단계 오기: 예정된 예산 심사를 이미 의결된 것처럼 서술', expectBlock: true, codeDetectable: false,
    text: must(LIB_ANSWER, '시는 인건비 절감을 이유로 들지만,', '시의회도 이미 관련 예산을 의결했다. 시는 인건비 절감을 이유로 들지만,'), expectTypes: ['status_misstated', 'factual_error'],
  },
  {
    id: 'fake-quote', label: '잘못된 인용: 존재하지 않는 시장 발언', expectBlock: true, codeDetectable: true,
    text: must(LIB_ANSWER, '반대 논거도 가볍지 않다.', '시장은 "도서관은 이제 기계로 충분하다"고 말했다. 반대 논거도 가볍지 않다.'), expectTypes: ['fabricated_detail', 'source_misrepresentation'],
  },
  {
    id: 'misattribution', label: '출처 왜곡: 노조가 절감 필요성에 동의했다고 서술', expectBlock: true, codeDetectable: false,
    text: must(LIB_ANSWER, '예산은 한정되어 있고,', '도서관 노동조합도 인건비 절감의 필요성에는 동의했다. 예산은 한정되어 있고,'), expectTypes: ['source_misrepresentation', 'factual_error'],
  },
  {
    id: 'causal-leap', label: '인과관계 비약: 근거 없는 성적 하락 단정', expectBlock: true, codeDetectable: false,
    text: must(LIB_ANSWER, '게다가 그 손실은', '야간 운영 시간이 짧은 도시일수록 청소년의 학업 성취가 낮은 경향이 있으므로, 이번 조치는 가온시 청소년의 성적 하락으로 이어질 것이 분명하다. 게다가 그 손실은'),
    expectTypes: ['causal_leap', 'hasty_generalization', 'unsupported_key_evidence', 'fabricated_detail'],
  },
  {
    id: 'straw-man', label: '반론 누락·허수아비: 재정 논거를 왜곡하고 실질 응답 없음', expectBlock: true, codeDetectable: false,
    text: must(must(LIB_ANSWER, OBJECTION,
      '반대하는 쪽은 돈만 아끼면 그만이라고 생각한다. 그러나 공공서비스를 돈으로만 따지는 태도는 처음부터 받아들일 수 없는 것이며, 이런 주장은 시민의 삶을 외면한 계산에 불과하다. 도서관을 숫자로 재단하려는 시도 자체가 공공성을 포기하는 일이다. 시가 내세우는 효율이라는 말은 결국 서비스를 줄이겠다는 말을 그럴듯하게 바꾼 것일 뿐이다.'),
    '그러나 절감액이 크다는 사실만으로', '절감액이 크다는 사실만으로'),
    expectTypes: ['straw_man', 'counter_not_answered', 'requirement_missing'],
  },
  {
    id: 'contradiction', label: '내부 모순: 본론의 조건부 수용과 결론의 전면 금지가 충돌', expectBlock: true, codeDetectable: false,
    text: must(LIB_ANSWER, '이용 실적에 근거해 거점을 남기는 방식이라면 시는 재정 목표의 상당 부분을 지키면서도 그 역할을 포기하지 않을 수 있다.', '따라서 가온시는 이용 실적과 상관없이 어떤 도서관의 야간 운영도 줄여서는 안 되며, 거점 운영 같은 축소안도 받아들일 수 없다.'),
    expectTypes: ['internal_contradiction', 'overreaching_conclusion'],
  },
  {
    id: 'hollow', label: '상투적 결론(수정 유도 대상, 단독으로는 차단 사유 아님)', expectBlock: false, expectRevision: true, codeDetectable: false,
    text: LIB_DRAFT, expectTypes: ['vague_conclusion'],
  },
];
