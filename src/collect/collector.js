// 수집: 설정된 RSS·공식 발표 피드를 읽어 수집 대상 기간(겹침 72시간 포함)의 기사 후보를 만든다.
// LLM은 이 단계에 관여하지 않는다. 최신 뉴스는 오직 실제 응답한 피드에서만 온다.
import { safeFetch } from '../lib/safe-fetch.js';
import { parseFeed } from './rss.js';
import { sha1 } from '../lib/crypto.js';
import { toKstIso } from '../lib/time.js';
import { normalizeForCompare } from '../lib/text.js';
import { errorSummary } from '../lib/log.js';

const EXCLUDE_RE = /(\[포토\]|\[사진\]|\[화보\]|\[인사\]|\[부고\]|\[날씨\]|\[오늘의 운세\]|\[게시판\]|\[표\]|\[속보\]\s*$|운세|부고|인사\]|프로야구|K리그|프리미어리그|챔피언스리그|골프|연예|열애|결별|컴백|뮤직비디오|드라마 시청률|박스오피스|코스피 마감|환율 마감|\bPHOTO\b|\bIN PICTURES\b|\bLive:|crossword|horoscope)/i;

export function canonicalUrl(raw) {
  try {
    const u = new URL(raw);
    u.hash = '';
    for (const k of [...u.searchParams.keys()]) {
      if (/^(utm_|fbclid|gclid|ref|from|cmpid|plink|rss|sns|ocid)/i.test(k)) u.searchParams.delete(k);
    }
    u.hostname = u.hostname.toLowerCase().replace(/^m\./, 'www.');
    return u.toString();
  } catch {
    return String(raw);
  }
}

function splitGoogleTitle(title, sourceName) {
  if (sourceName && title.endsWith(` - ${sourceName}`)) return title.slice(0, -(sourceName.length + 3)).trim();
  const m = title.match(/^(.*)\s-\s([^-]{2,30})$/);
  return m ? m[1].trim() : title;
}

export function normalizeItem(item, source, nowIso) {
  const isAgg = source.type === 'aggregator';
  const outlet = isAgg ? item.sourceName || '알 수 없음' : source.outlet;
  const title = isAgg ? splitGoogleTitle(item.title, item.sourceName) : item.title;
  const url = canonicalUrl(item.link);
  return {
    id: sha1(isAgg ? `${outlet}|${normalizeForCompare(title)}` : url).slice(0, 16),
    url,
    title,
    outlet,
    // 독립성 그룹: 집계 피드 기사는 실제 언론사 단위로 묶는다.
    group: isAgg ? `outlet:${normalizeForCompare(outlet).replace(/\s+/g, '')}` : source.group,
    sourceId: source.id,
    sourceType: source.type,
    lang: source.lang,
    hint: source.hint || null,
    publishedAtMs: item.publishedMs,
    publishedAt: item.publishedMs ? toKstIso(item.publishedMs) : null,
    feedUpdatedAt: item.updatedMs ? toKstIso(item.updatedMs) : null,
    feedSummary: item.description || '',
    feedCategories: item.categories || [],
    // 집계(Google 뉴스) 링크는 원문 리디렉션 해석이 불안정하므로 본문 조회 대상에서 제외하고 교차 확인용으로만 쓴다.
    fetchable: !isAgg,
    collectedAt: nowIso,
  };
}

export async function collectArticles({ window, cutoffMs, sources, policy, fetcher = safeFetch, nowIso }) {
  const health = [];
  const byId = new Map();
  let undated = 0;
  let excluded = 0;
  const allow = sources.fetchAllowHosts;
  const enabled = sources.sources.filter((s) => s.enabled !== false);
  const queue = [...enabled];
  const workers = Array.from({ length: Math.min(6, queue.length) }, async () => {
    while (queue.length) {
      const src = queue.shift();
      const started = Date.now();
      try {
        const res = await fetcher(src.url, { timeoutMs: policy.runtime.feedFetchTimeoutMs, maxBytes: 5_000_000, allowHosts: allow });
        if (res.status >= 400) throw new Error(`HTTP ${res.status}`);
        const items = parseFeed(res.text, { defaultTz: src.defaultTz || '+00:00' });
        let kept = 0;
        for (const it of items) {
          if (!it.publishedMs) { undated += 1; continue; }
          if (it.publishedMs < window.overlapStartMs || it.publishedMs > cutoffMs) continue;
          const a = normalizeItem(it, src, nowIso);
          if (EXCLUDE_RE.test(a.title)) { excluded += 1; continue; }
          if (!byId.has(a.id)) { byId.set(a.id, a); kept += 1; }
        }
        health.push({ sourceId: src.id, ok: true, items: items.length, kept, ms: Date.now() - started });
      } catch (err) {
        health.push({ sourceId: src.id, ok: false, error: errorSummary(err), ms: Date.now() - started });
      }
    }
  });
  await Promise.all(workers);
  health.sort((a, b) => a.sourceId.localeCompare(b.sourceId));
  return { articles: [...byId.values()], health, undated, excluded };
}
