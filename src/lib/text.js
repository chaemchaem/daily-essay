// 한국어 텍스트 처리: 글자 수 계산, 정규화, 유사도.

/** 공백 포함 글자 수(줄바꿈 제외). 결합 문자 대신 코드포인트 단위로 센다(한글 완성형은 1자). */
export function countChars(text) {
  const s = String(text ?? '').normalize('NFC').replace(/\r?\n/g, '');
  return [...s].length;
}

export function countCharsNoSpace(text) {
  return [...String(text ?? '').normalize('NFC').replace(/\s/g, '')].length;
}

export function splitParagraphs(text) {
  return String(text ?? '')
    .replace(/\r\n/g, '\n')
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
}

export function normalizeForCompare(s) {
  return String(s ?? '')
    .normalize('NFC')
    .toLowerCase()
    .replace(/<[^>]+>/g, ' ')
    .replace(/\[[^\]]*\]|\([^)]*\)/g, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** 문자 bigram 집합(공백 제거). 한국어 제목 유사도에 형태소 분석 없이 쓸 수 있는 근사치. */
export function bigrams(s) {
  const t = normalizeForCompare(s).replace(/\s+/g, '');
  const set = new Set();
  for (let i = 0; i < t.length - 1; i += 1) set.add(t.slice(i, i + 2));
  return set;
}

export function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter += 1;
  return inter / (a.size + b.size - inter);
}

/** 작은 쪽 집합 기준 포함도. 짧은 제목이 긴 제목에 포함될 때 jaccard보다 안정적이다. */
export function containment(a, b) {
  if (!a.size || !b.size) return 0;
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  let inter = 0;
  for (const x of small) if (large.has(x)) inter += 1;
  return inter / small.size;
}

export function textSimilarity(x, y) {
  return jaccard(bigrams(x), bigrams(y));
}

/** 본문 shingle(5글자) — 보도자료 복사 기사 판별용 */
export function shingles(s, k = 5) {
  const t = normalizeForCompare(s).replace(/\s+/g, '');
  const set = new Set();
  for (let i = 0; i + k <= t.length; i += 3) set.add(t.slice(i, i + k));
  return set;
}

export function truncate(s, n) {
  const arr = [...String(s ?? '')];
  return arr.length <= n ? arr.join('') : `${arr.slice(0, n - 1).join('')}…`;
}

export function slugify(s) {
  const base = normalizeForCompare(s).replace(/\s+/g, '-').slice(0, 40).replace(/-+$/, '');
  return base || 'topic';
}

export function stripHtml(html) {
  return decodeEntities(String(html ?? '').replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', middot: '·', hellip: '…', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”' };
export function decodeEntities(s) {
  return String(s ?? '').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const code = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      try { return String.fromCodePoint(code); } catch { return m; }
    }
    return NAMED[e.toLowerCase()] ?? m;
  });
}
