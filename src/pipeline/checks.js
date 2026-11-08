// 코드로 확인 가능한 품질 항목. 의미 판단이 필요한 항목은 LLM 검토(factcheck/critique)가 맡는다.
// 여기서 잡는 문제: 분량, 문단 수, 요구사항 대응 누락, 사실표에 없는 수치·인용(지어낸 세부), 존재하지 않는 사실 ID,
// 상투적 결론 문구, 접속사 반복, 문장 길이, 최근 발행물과의 중복, 문제의 형식 요건.
import { countChars, countCharsNoSpace, splitParagraphs, textSimilarity, bigrams, containment } from '../lib/text.js';

export const CODE_BLOCKING_TYPES = new Set(['length_out_of_range', 'requirement_missing', 'fabricated_detail', 'duplicate_of_recent']);

const UNIT = '(?:%p|%|퍼센트포인트|퍼센트|조|억|만|천|백|명|개국|개|건|곳|원|달러|유로|엔|위안|년|월|일|시간|시|분|배|세|살|km|㎞|kg|톤|t|가구|호|차|위|회|석|표|점|bp|GW|MW|kWh|조원|억원|만원|만명|천명)';
const NUM_RE = new RegExp(`(\\d[\\d,]*(?:\\.\\d+)?)\\s*(${UNIT})?`, 'g');

function normNum(s) {
  return s.replace(/(\d),(?=\d{3})/g, '$1');
}

export function extractNumbers(text) {
  const out = [];
  const t = normNum(String(text));
  let m;
  NUM_RE.lastIndex = 0;
  while ((m = NUM_RE.exec(t))) {
    const digits = m[1].replace(/,/g, '');
    const unit = m[2] || '';
    if (!unit && digits.length < 2) continue; // 단위 없는 한 자리 숫자는 서수·구조 표현일 가능성이 커 제외
    out.push({ raw: m[0].trim(), digits, unit, index: m.index });
  }
  return out;
}

function corpusOf(facts, question) {
  const parts = [];
  for (const f of facts?.facts || []) parts.push(f.statement, f.asOf || '');
  parts.push(facts?.whatHappened || '', facts?.whatChangedInWindow || '', facts?.developmentStageNote || '');
  for (const s of facts?.stakeholders || []) parts.push(s.position, s.interest);
  if (question) {
    parts.push(question.background || '', question.prompt || '');
    for (const p of question.passages || []) parts.push(p.text);
    for (const r of question.requirements || []) parts.push(r.text);
  }
  return normNum(parts.join('\n'));
}

function numberGrounded(n, corpus, allowedYears) {
  if (n.unit === '년' && allowedYears.has(n.digits)) return true;
  const esc = n.digits.replace('.', '\\.');
  if (n.unit) {
    const unitRe = new RegExp(`(^|[^\\d.])${esc}\\s*${n.unit.replace(/[%]/g, '%')}`);
    if (unitRe.test(corpus)) return true;
    // 단위 변형(억원/억 원) 허용
    if (new RegExp(`(^|[^\\d.])${esc}\\s*${n.unit[0]}`).test(corpus)) return true;
    return false;
  }
  return new RegExp(`(^|[^\\d.])${esc}($|[^\\d.])`).test(corpus);
}

function quotesIn(text) {
  const out = [];
  const re = /[“"]([^”"]{6,200})[”"]/g;
  let m;
  while ((m = re.exec(text))) out.push(m[1].trim());
  return out;
}

const HOLLOW = [
  /사회적\s*합의(가|를)?\s*(필요|이루어|모아)/, /제도(를|의)?\s*개선(이|해야|할\s*필요)/, /균형\s*(잡힌|있는)\s*(접근|시각|해법)/,
  /다각(적|도)(인|로)?\s*(노력|방안|접근)/, /지혜를\s*모아/, /머리를\s*맞대/, /모두의\s*노력/, /관심과\s*노력/,
];
const CONNECTIVES = ['또한', '따라서', '그러나', '하지만', '이처럼', '즉', '결국', '나아가', '물론', '그러므로'];

function paragraphOf(paragraphs, idx) {
  let acc = 0;
  for (let i = 0; i < paragraphs.length; i += 1) {
    acc += paragraphs[i].length + 2;
    if (idx < acc) return i + 1;
  }
  return 0;
}

/**
 * @returns {{metrics:object, issues:Array}}
 */
export function checkAnswer({ text, paragraphRoles = [], question, facts, policy, recent = [], issueDate }) {
  const issues = [];
  const add = (type, severity, paragraph, quote, evidence, fixDirection) => issues.push({ source: 'code', type, severity, location: { paragraph, quote }, evidence, fixDirection });
  const paragraphs = splitParagraphs(text);
  const chars = countChars(text);
  const metrics = { chars, charsNoSpace: countCharsNoSpace(text), paragraphs: paragraphs.length };

  if (chars < policy.answer.minChars || chars > policy.answer.maxChars) {
    add('length_out_of_range', 'major', 0, '', `공백 포함 ${chars}자(기준 ${policy.answer.minChars}~${policy.answer.maxChars}자)`, chars < policy.answer.minChars ? `${policy.answer.minChars - chars}자 이상 보강하되 논증 밀도를 높이는 방향으로` : `${chars - policy.answer.maxChars}자 이상 줄이되 요구사항 대응은 유지`);
  }
  if (paragraphs.length < policy.answer.minParagraphs || paragraphs.length > policy.answer.maxParagraphs) {
    add('paragraph_role_unclear', 'minor', 0, '', `문단 ${paragraphs.length}개(권장 ${policy.answer.minParagraphs}~${policy.answer.maxParagraphs})`, '문단 구성을 조정');
  }
  if (/^\s*(#|\*|-|\d+\.|[①-⑩]|[가-하]\.)\s/m.test(text) || /\*\*|##/.test(text)) {
    add('style_clarity', 'major', 0, '', '본문에 제목·번호·마크다운 형식이 들어 있음', '완성된 줄글 논술문으로 고칠 것');
  }
  if (/\[?F\d+\]?|\(S\d+\)/.test(text)) {
    add('style_clarity', 'major', 0, (text.match(/\[?F\d+\]?|\(S\d+\)/) || [''])[0], '본문에 내부 사실·출처 ID가 노출됨', '본문에서 ID 표기를 지울 것');
  }

  // 요구사항 대응(형식) — 의미상 충족 여부는 critique가 판정한다.
  const covered = new Set(paragraphRoles.flatMap((p) => p.requirementIds || []));
  for (const r of question?.requirements || []) {
    if (!covered.has(r.id)) add('requirement_missing', 'major', 0, r.text, `요구사항 ${r.id}에 대응하는 문단이 표시되지 않음`, `요구사항 ${r.id}을 다루는 문단을 명시적으로 작성`);
  }
  const factIds = new Set((facts?.facts || []).map((f) => f.id));
  for (const p of paragraphRoles) for (const id of p.factIds || []) {
    if (!factIds.has(id)) add('source_misrepresentation', 'major', p.index, id, `존재하지 않는 사실 ID(${id})를 근거로 표시`, '사실표에 있는 항목만 근거로 쓸 것');
  }
  if (paragraphRoles.length && paragraphRoles.length !== paragraphs.length) {
    add('paragraph_role_unclear', 'minor', 0, '', `문단 역할 표(${paragraphRoles.length})와 실제 문단 수(${paragraphs.length})가 다름`, '문단 역할 표를 실제 문단과 맞출 것');
  }

  // 사실표에 없는 수치
  const corpus = corpusOf(facts, question);
  const y = Number(String(issueDate || '').slice(0, 4)) || new Date().getUTCFullYear();
  const allowedYears = new Set([String(y), String(y - 1), String(y + 1)]);
  const seen = new Set();
  for (const n of extractNumbers(text)) {
    const key = `${n.digits}${n.unit}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (!numberGrounded(n, corpus, allowedYears)) {
      add('fabricated_detail', 'major', paragraphOf(paragraphs, n.index), n.raw, `수치 "${n.raw}"가 사실표·문제에 없음`, '사실표에 있는 수치만 쓰거나 해당 수치를 삭제');
    }
  }
  // 사실표에 없는 직접 인용
  const corpusGrams = bigrams(corpus);
  for (const q of quotesIn(text)) {
    const g = bigrams(q);
    if (g.size >= 4 && containment(g, corpusGrams) < 0.85) {
      add('fabricated_detail', 'major', paragraphOf(paragraphs, text.indexOf(q)), q.slice(0, 60), '큰따옴표 인용문이 사실표의 발언과 일치하지 않음', '실제 확인된 발언만 인용하거나 간접 서술로 바꿀 것');
    }
  }

  // 상투적 결론
  const last = paragraphs[paragraphs.length - 1] || '';
  for (const re of HOLLOW) {
    const m = last.match(re);
    if (m) add('vague_conclusion', 'minor', paragraphs.length, m[0], '결론 문단에 상투적 표현 사용 — 구체적 내용이 뒤따르는지 확인 필요', '누가 무엇을 어떤 조건에서 해야 하는지로 구체화하거나 문장을 삭제');
  }
  // 접속사 반복
  const sentences = text.split(/(?<=[.?!다])\s+/).filter(Boolean);
  for (const c of CONNECTIVES) {
    const n = sentences.filter((s) => s.startsWith(c)).length;
    if (n >= 3) add('style_clarity', 'minor', 0, c, `문장 첫머리 "${c}"가 ${n}회 반복`, '내용으로 연결하거나 다른 방식으로 이음');
  }
  const avg = sentences.length ? chars / sentences.length : 0;
  metrics.avgSentenceChars = Math.round(avg);
  if (avg > 95) add('style_clarity', 'minor', 0, '', `평균 문장 길이 ${Math.round(avg)}자`, '긴 문장을 나눌 것');

  // 최근 발행물과의 중복(발문+중심 주장)
  for (const r of recent) {
    const s = Math.max(textSimilarity(question?.prompt || '', r.prompt || ''), textSimilarity(text.slice(0, 600), r.answerHead || ''));
    if (s >= policy.topics.duplicateQuestionSimilarity) {
      add('duplicate_of_recent', 'major', 0, r.title, `최근 발행 문제(${r.id})와 유사도 ${s.toFixed(2)}`, '논점을 실질적으로 달리하거나 발행하지 않음');
    }
  }
  return { metrics, issues };
}

const GENERIC_PROMPT = [/문제점과\s*(해결|개선)\s*방안을\s*논하시오/, /^.{0,20}에\s*대한\s*(자신|본인)의\s*(생각|견해)를\s*(쓰|서술하)시오\.?$/, /찬반\s*(입장|의견)을\s*밝히고\s*근거를\s*(들어|제시하여)\s*논하시오\.?$/];

export function checkQuestion({ question, policy, recent = [] }) {
  const issues = [];
  const add = (type, severity, evidence, fixDirection) => issues.push({ source: 'code', type, severity, location: { paragraph: 0, quote: '' }, evidence, fixDirection });
  const n = question.requirements.length;
  if (n < 2 || n > 4) add('requirement_missing', 'major', `요구사항 ${n}개(2~4개 권장)`, '분량 안에서 깊이 있게 답할 수 있도록 요구사항 수를 조정');
  for (const re of GENERIC_PROMPT) if (re.test(question.prompt.trim())) add('other', 'major', '어디에나 붙일 수 있는 일반적 발문', '이 사건의 고유한 긴장을 발문에 담을 것');
  const total = question.rubric.reduce((s, r) => s + r.weight, 0);
  if (Math.abs(total - 100) > 5) add('other', 'minor', `평가 기준 가중치 합계 ${total}`, '합계를 100으로');
  if (question.rubric.some((r) => /(찬성|반대|지지|옹호)하(는|면)\s*(답안|경우)\s*(가점|높은)/.test(r.description))) add('other', 'major', '평가 기준이 특정 입장에 가점을 줌', '입장과 무관한 기준으로');
  for (const p of question.passages) {
    if (/[“"]/.test(p.text)) add('fabricated_detail', 'major', `제시문 ${p.label}에 실제 인용처럼 보이는 따옴표 사용`, '재구성 제시문은 인용 형식을 쓰지 않음');
    if (!p.basisFactIds.length) add('unsupported_key_evidence', 'major', `제시문 ${p.label}의 근거 사실 표시 없음`, '근거 사실 ID를 연결');
  }
  for (const r of recent) {
    const s = textSimilarity(question.prompt, r.prompt || '');
    if (s >= policy.topics.duplicateQuestionSimilarity) add('duplicate_of_recent', 'major', `최근 발행 문제(${r.id})와 발문 유사도 ${s.toFixed(2)}`, '논점을 실질적으로 달리할 것');
  }
  return issues;
}

/** 사실표 정합성: 존재하지 않는 출처 ID 제거, 출처 없는 확인 사실 제거, 독립 출처 수 계산 */
export function checkFacts({ facts, sourcePack, policy }) {
  const unrelated = new Set((facts.sourceNotes || []).filter((n) => n.independence === 'unrelated_to_event').map((n) => n.sourceId));
  const ids = new Set(sourcePack.map((s) => s.sid).filter((sid) => !unrelated.has(sid)));
  const problems = [];
  const cleaned = [];
  for (const f of facts.facts) {
    const valid = f.sourceIds.filter((id) => ids.has(id));
    if (valid.length !== f.sourceIds.length) problems.push(`${f.id}: 존재하지 않는 출처 ID 제거(${f.sourceIds.filter((i) => !ids.has(i)).join(',')})`);
    if (!valid.length) { problems.push(`${f.id}: 출처가 없어 사실표에서 제외`); continue; }
    if (f.kind === 'party_claim' && !f.attributedTo) problems.push(`${f.id}: 주장 주체 미표시`);
    cleaned.push({ ...f, sourceIds: valid });
  }
  const usedSids = new Set(cleaned.flatMap((f) => f.sourceIds));
  const sameOrigin = new Set((facts.sourceNotes || []).filter((n) => n.independence === 'same_origin_as_other').map((n) => n.sourceId));
  const groups = new Set(sourcePack.filter((s) => usedSids.has(s.sid) && s.sourceType !== 'aggregator' && !sameOrigin.has(s.sid)).map((s) => s.group));
  const hasOfficial = sourcePack.some((s) => usedSids.has(s.sid) && s.sourceType === 'official');
  const fullText = sourcePack.filter((s) => usedSids.has(s.sid) && s.accessLevel === 'full_text').length;
  const enough = (groups.size >= policy.quality.requireIndependentSources || hasOfficial) && fullText >= 1 && cleaned.filter((f) => f.kind === 'confirmed').length >= 3;
  return { facts: { ...facts, facts: cleaned }, problems, independence: { independentGroups: groups.size, hasOfficial, fullTextSources: fullText, enough } };
}

export function checkCompanion({ companion, answerParagraphs, facts }) {
  const issues = [];
  const add = (section, problem, severity) => issues.push({ source: 'code', section, problem, severity });
  const factIds = new Set(facts.facts.map((f) => f.id));
  const nc = companion.learning.concepts.length;
  if (nc < 3 || nc > 5) add('learning', `핵심 개념 ${nc}개(3~5개)`, 'minor');
  for (const p of companion.logic.paragraphs) {
    if (p.index < 1 || p.index > answerParagraphs) add('logic', `해설의 문단 번호 ${p.index}가 답안(${answerParagraphs}문단)에 없음`, 'major');
    for (const id of p.evidenceFactIds) if (!factIds.has(id)) add('logic', `존재하지 않는 사실 ID ${id}`, 'major');
  }
  for (const a of companion.alternatives) for (const id of a.keyFactIds) if (!factIds.has(id)) add('alternatives', `존재하지 않는 사실 ID ${id}`, 'major');
  if (!companion.alternatives.length && companion.alternativesNote.length < 20) add('alternatives', '다른 입장이 없는 이유 설명이 부족', 'minor');
  return issues;
}
