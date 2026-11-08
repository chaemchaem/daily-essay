export const QUESTION_TYPE_LABELS = {
  policy_evaluation: '정책 평가형', value_conflict: '가치 충돌형', cause_analysis: '원인 분석형', alternative_comparison: '대안 비교형',
  passage_comparison: '제시문 비교형', concept_application: '개념 적용형', counterfactual_evaluation: '반사실 평가형',
};
export const STAGE_LABELS = {
  not_applicable: '해당 없음', proposed: '제안', announced: '발표', under_review: '심사·검토 중', passed: '의결', promulgated: '공포', in_force: '시행',
  suspended_or_withdrawn: '보류·철회', ruling_lower_court: '하급심 판결', ruling_appeal: '항소심 판결', ruling_final: '확정 판결',
  allegation: '의혹 제기', under_investigation: '수사 중', indicted: '기소', trial_ongoing: '재판 중', convicted_final: '유죄 확정',
  ongoing: '진행 중', concluded: '종결', scheduled: '예정',
};
export const FACT_KIND_LABELS = { confirmed: '확인된 사실', party_claim: '당사자 주장', scheduled: '예정', estimate_or_forecast: '전망·추정' };
export const ACCESS_LABELS = { full_text: '본문 확인', excerpt_only: '발췌·요약만 확인', headline_only: '제목만 확인' };
export const INDEPENDENCE_LABELS = { official_primary: '공식 원자료', independent_reporting: '독립 보도', same_origin_as_other: '다른 출처와 같은 원문(독립 근거 아님)', aggregator_headline_only: '검색 묶음 제목' };
export const CHECKLIST_LABELS = {
  requirements_covered: '발문 요구사항 충족', concept_consistency: '핵심 개념 의미 유지', premises_explicit: '전제 명시', no_unwarranted_generalization: '근거 없는 일반화 없음',
  no_causal_leap: '인과관계 비약 없음', no_circular_reasoning: '순환논증 없음', no_straw_man: '허수아비 반박 없음', no_false_dilemma: '거짓 양자택일 없음',
  no_internal_contradiction: '내부 모순 없음', fact_opinion_separated: '사실과 의견 구분', proposal_matches_cause: '대안과 원인의 일치', proposal_feasible: '대안의 실행 가능성',
  objection_answered: '반론에 실질적 응답', conclusion_within_scope: '결론이 본론 범위 안', not_duplicate_of_recent: '최근 문제와 중복 아님',
  paragraph_roles_connected: '문단 역할·연결', value_judgment_criteria_stated: '가치판단 기준 명시', no_hollow_conclusion: '상투적 결론 아님',
};
export const VERDICT_LABELS = { supported: '뒷받침됨', partially_supported: '부분적으로 뒷받침', unsupported: '근거 없음', contradicted: '출처와 어긋남', not_a_factual_claim: '사실 진술 아님(판단·분석)' };
export const ISSUE_STATE_LABELS = {
  published: '발행', partial: '일부 발행', ready: '발행 대기', generating: '작성·검토 중', no_qualifying_topics: '기준 통과 주제 없음',
  all_held: '검토 통과 주제 없음', failed_collect: '수집 실패', failed_generation: '생성 실패', paused: '일시 중지', budget_deferred: '비용·무료 한도로 작성 보류', delayed: '발행 지연', scheduled: '예정',
};
