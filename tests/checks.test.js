import test from 'node:test';
import assert from 'node:assert/strict';
import { checkAnswer, checkQuestion, checkFacts, extractNumbers } from '../src/pipeline/checks.js';
import { countChars, countCharsNoSpace } from '../src/lib/text.js';
import { loadPolicy } from '../src/lib/config.js';
import * as F from '../src/eval/fixture-data.js';
import { ADVERSARIAL_CASES } from '../src/eval/adversarial-cases.js';

const policy = loadPolicy();
const run = (text, roles = F.LIB_ROLES) => checkAnswer({ text, paragraphRoles: roles, question: F.LIB_QUESTION, facts: F.LIB_FACTS, policy, issueDate: '2026-11-08' });

test('글자 수: 공백 포함·줄바꿈 제외, 한글 완성형 1자', () => {
  assert.equal(countChars('가 나\n\n다'), 4);
  assert.equal(countCharsNoSpace('가 나\n\n다'), 3);
  assert.equal(countChars('한국어 abc'), 7);
});

test('견본 모범답안은 코드 검사에서 major 이상 문제가 없다', () => {
  const r = run(F.LIB_ANSWER);
  assert.deepEqual(r.issues.filter((i) => i.severity !== 'minor'), []);
  assert.ok(r.metrics.chars >= 1500 && r.metrics.chars <= 2000);
});

test('사실표에 없는 수치를 지어내면 fabricated_detail', () => {
  const r = run(F.LIB_ANSWER.replace('61%', '81%'));
  assert.ok(r.issues.some((i) => i.type === 'fabricated_detail' && /81%/.test(i.location.quote)));
});

test('사실표에 없는 직접 인용을 넣으면 fabricated_detail', () => {
  const r = run(F.LIB_ANSWER.replace('반대 논거도 가볍지 않다.', '시장은 "도서관은 이제 기계로 충분하다"고 말했다. 반대 논거도 가볍지 않다.'));
  assert.ok(r.issues.some((i) => i.type === 'fabricated_detail' && /인용/.test(i.evidence)));
});

test('분량 미달·요구사항 대응 누락·상투적 결론·마크다운', () => {
  const short = run(F.LIB_ANSWER.slice(0, 900));
  assert.ok(short.issues.some((i) => i.type === 'length_out_of_range'));
  const missing = run(F.LIB_ANSWER, F.LIB_ROLES.map((p) => ({ ...p, requirementIds: p.requirementIds.filter((x) => x !== 'R3') })));
  assert.ok(missing.issues.some((i) => i.type === 'requirement_missing'));
  const hollow = run(F.LIB_DRAFT);
  assert.ok(hollow.issues.some((i) => i.type === 'vague_conclusion'));
  const md = run(`## 서론\n\n${F.LIB_ANSWER}`);
  assert.ok(md.issues.some((i) => i.type === 'style_clarity' && i.severity === 'major'));
});

test('최근 발행 문제와 사실상 같은 발문은 duplicate_of_recent', () => {
  const r = checkAnswer({ text: F.LIB_ANSWER, paragraphRoles: F.LIB_ROLES, question: F.LIB_QUESTION, facts: F.LIB_FACTS, policy, issueDate: '2026-11-08', recent: [{ id: 'old', title: 'x', prompt: F.LIB_QUESTION.prompt.replace('가온시', '가온 시'), answerHead: '' }] });
  assert.ok(r.issues.some((i) => i.type === 'duplicate_of_recent'));
});

test('문제 형식 검사: 일반적 발문, 재구성 제시문의 따옴표', () => {
  const q = { ...F.LIB_QUESTION, prompt: '이 사건의 문제점과 해결 방안을 논하시오.', passages: [{ label: '가', text: '시장은 "충분하다"고 말했다', basisFactIds: [] }] };
  const issues = checkQuestion({ question: q, policy });
  assert.ok(issues.some((i) => /일반적 발문/.test(i.evidence)));
  assert.ok(issues.some((i) => i.type === 'fabricated_detail'));
  assert.equal(checkQuestion({ question: F.LIB_QUESTION, policy }).filter((i) => i.severity === 'major').length, 0);
});

test('사실표 정합성: 없는 출처 ID 제거, 출처 없는 사실 제외, 같은 원문은 독립 근거로 세지 않음', () => {
  const pack = [{ sid: 'S1', group: 'gov', sourceType: 'official', accessLevel: 'full_text' }, { sid: 'S2', group: 'a', sourceType: 'press', accessLevel: 'full_text' }];
  const facts = { ...F.LIB_FACTS, facts: [...F.LIB_FACTS.facts, { id: 'F99', statement: 'x', kind: 'confirmed', attributedTo: null, sourceIds: ['S9'], asOf: null, accessBasis: 'full_text' }], sourceNotes: [{ sourceId: 'S2', independence: 'same_origin_as_other', sameOriginAs: 'S1', note: '' }] };
  const r = checkFacts({ facts, sourcePack: pack, policy });
  assert.ok(!r.facts.facts.some((f) => f.id === 'F99'));
  assert.ok(r.problems.some((p) => p.includes('F99')));
  assert.equal(r.independence.independentGroups, 1);
});

test('숫자 추출: 단위·쉼표 처리, 한 자리 무단위 숫자 제외', () => {
  const n = extractNumbers('예산 1,200억 원과 3곳, 그리고 2가지 이유와 7');
  assert.deepEqual(n.map((x) => x.digits + x.unit), ['1200억', '3곳']);
});

test('의도적으로 오류를 넣은 사례 중 코드 검사로 잡혀야 하는 것은 잡힌다', () => {
  for (const c of ADVERSARIAL_CASES.filter((x) => x.codeDetectable)) {
    const r = run(c.text, c.roles || F.LIB_ROLES);
    assert.ok(r.issues.some((i) => c.expectTypes.includes(i.type) && i.severity !== 'minor'), `${c.id} 미탐지`);
  }
});
