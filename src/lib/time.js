// 한국시간(Asia/Seoul, UTC+09:00, 서머타임 없음) 기준 날짜 계산.
// 호스트 시간대와 무관하게 동작하도록 Intl이나 로컬 Date 메서드를 쓰지 않고 고정 오프셋으로 계산한다.
export const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function assertDate(date) {
  if (typeof date !== 'string' || !DATE_RE.test(date)) throw new Error(`잘못된 날짜 형식: ${date}`);
  const t = Date.parse(`${date}T00:00:00Z`);
  if (Number.isNaN(t) || new Date(t).toISOString().slice(0, 10) !== date) throw new Error(`존재하지 않는 날짜: ${date}`);
  return date;
}

/** UTC 시각(ms 또는 Date/ISO) → 한국 날짜 문자열 YYYY-MM-DD */
export function kstDateOf(input) {
  const ms = toMs(input);
  return new Date(ms + KST_OFFSET_MS).toISOString().slice(0, 10);
}

/** 한국 날짜의 00:00 KST에 해당하는 UTC ms */
export function kstMidnightMs(date) {
  assertDate(date);
  return Date.parse(`${date}T00:00:00Z`) - KST_OFFSET_MS;
}

/** 한국 날짜 + "HH:MM" → UTC ms */
export function kstTimeMs(date, hhmm) {
  const [h, m] = String(hhmm).split(':').map(Number);
  if (!(h >= 0 && h < 24 && m >= 0 && m < 60)) throw new Error(`잘못된 시각: ${hhmm}`);
  return kstMidnightMs(date) + (h * 60 + m) * 60 * 1000;
}

export function addDays(date, n) {
  assertDate(date);
  return new Date(Date.parse(`${date}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
}

export function dateRange(from, to) {
  const out = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

/** UTC ms → "2026-11-07T09:00:00+09:00" */
export function toKstIso(input) {
  const ms = toMs(input);
  return new Date(ms + KST_OFFSET_MS).toISOString().replace(/\.\d{3}Z$/, '+09:00');
}

export function toMs(input) {
  if (typeof input === 'number') return input;
  if (input instanceof Date) return input.getTime();
  const ms = Date.parse(input);
  if (Number.isNaN(ms)) throw new Error(`시각을 해석할 수 없음: ${input}`);
  return ms;
}

/**
 * 발행호(issueDate)의 수집 대상 기간.
 * primary: 전날 00:00 KST 이상 ~ 당일 00:00 KST 미만 (반열린 구간)
 * overlap: 지연 보도 보완용으로 당일 00:00에서 overlapHours만큼 거슬러 올라간 시점부터
 */
export function issueWindow(issueDate, { primaryHours = 24, overlapHours = 72 } = {}) {
  const end = kstMidnightMs(issueDate);
  return {
    issueDate,
    primaryStartMs: end - primaryHours * 3600 * 1000,
    primaryEndMs: end,
    overlapStartMs: end - overlapHours * 3600 * 1000,
    primaryStart: toKstIso(end - primaryHours * 3600 * 1000),
    primaryEnd: toKstIso(end),
    overlapStart: toKstIso(end - overlapHours * 3600 * 1000),
    eventDates: [addDays(issueDate, -1)],
  };
}

export function inPrimaryWindow(ms, win) {
  return ms >= win.primaryStartMs && ms < win.primaryEndMs;
}

/**
 * RSS/Atom/HTML 메타에서 오는 다양한 시각 문자열을 UTC ms로 변환한다.
 * - RFC 822 ("Fri, 06 Nov 2026 14:03:00 +0900", "GMT", "KST")
 * - ISO 8601 (시간대 없으면 defaultTz 적용)
 * - "2026-11-06 14:03:00", "2026.11.06 14:03" (시간대 없으면 defaultTz 적용)
 * 해석할 수 없으면 null.
 */
export function parseFeedDate(value, defaultTz = '+00:00') {
  if (value == null) return null;
  let s = String(value).trim();
  if (!s) return null;
  s = s.replace(/\bKST\b/i, '+0900').replace(/\bUTC\b/i, '+0000').replace(/\bGMT\b/i, '+0000');
  // RFC 822
  if ((/^[A-Za-z]{3},?\s/.test(s) || /^\d{1,2}\s[A-Za-z]{3}\s\d{4}/.test(s)) && /\d{4}/.test(s)) {
    const hasTz = /[+-]\d{4}\s*$/.test(s);
    const ms = Date.parse(hasTz ? s : `${s} ${defaultTz.replace(':', '')}`);
    return Number.isNaN(ms) ? null : ms;
  }
  const m = s.match(/^(\d{4})[-./](\d{1,2})[-./](\d{1,2})(?:[T\s]+(\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?)?\s*(Z|[+-]\d{2}:?\d{2})?$/i);
  if (m) {
    const [, y, mo, d, h = '00', mi = '00', se = '00', tzRaw] = m;
    let tz = tzRaw || defaultTz;
    if (/^[+-]\d{4}$/.test(tz)) tz = `${tz.slice(0, 3)}:${tz.slice(3)}`;
    const iso = `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}T${h.padStart(2, '0')}:${mi}:${se}${tz.toUpperCase() === 'Z' ? 'Z' : tz}`;
    const ms = Date.parse(iso);
    return Number.isNaN(ms) ? null : ms;
  }
  // 그 밖의 형식은 연도가 분명히 있을 때만 엔진 파서에 맡긴다("not a date"가 2000년으로 해석되는 등의 오작동 방지)
  if (!/\b(19|20)\d{2}\b/.test(s)) return null;
  const ms = Date.parse(s);
  return Number.isNaN(ms) ? null : ms;
}

export function nowMs() {
  const fake = process.env.NJ_FAKE_NOW;
  return fake ? toMs(fake) : Date.now();
}
