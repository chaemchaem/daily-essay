// 기사 페이지에서 메타데이터와 본문 텍스트를 추출한다.
// 본문 전문은 저장하지 않는다: LLM 입력용으로 실행 중에만 쓰고, 영구 기록에는 짧은 발췌·해시만 남긴다.
import { safeFetch } from '../lib/safe-fetch.js';
import { decodeEntities, stripHtml } from '../lib/text.js';
import { parseFeedDate } from '../lib/time.js';
import { sha256 } from '../lib/crypto.js';

function meta(html, names) {
  for (const n of names) {
    const re = new RegExp(`<meta[^>]+(?:property|name|itemprop)=["']${n}["'][^>]*>`, 'i');
    const tag = html.match(re);
    if (tag) {
      const c = tag[0].match(/content=["']([^"']*)["']/i);
      if (c) return decodeEntities(c[1]).trim();
    }
  }
  return null;
}

const BOILERPLATE = /(무단\s*전재|재배포\s*금지|저작권자|Copyright|구독|기자\s*=|▶|☞|관련\s*기사|많이\s*본\s*뉴스|광고|All rights reserved|Sign up|newsletter)/i;

export function extractFromHtml(html, { defaultTz = '+09:00' } = {}) {
  const robots = (meta(html, ['robots']) || '').toLowerCase();
  const publishedMs = parseFeedDate(meta(html, ['article:published_time', 'og:article:published_time', 'datePublished', 'pubdate', 'publishdate']), defaultTz);
  const modifiedMs = parseFeedDate(meta(html, ['article:modified_time', 'og:updated_time', 'dateModified', 'lastmod']), defaultTz);
  const title = meta(html, ['og:title', 'twitter:title']);
  const canonical = (html.match(/<link[^>]+rel=["']canonical["'][^>]*href=["']([^"']+)["']/i) || [])[1] || null;

  let region = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<noscript[\s\S]*?<\/noscript>|<!--[\s\S]*?-->/gi, ' ');
  const candidates = [
    /<article[^>]*>([\s\S]*?)<\/article>/i,
    /<div[^>]+itemprop=["']articleBody["'][^>]*>([\s\S]*?)<\/div>\s*<\/div>/i,
    /<div[^>]+(?:id|class)=["'][^"']*(?:article[-_]?body|articleBody|news[-_]?body|article[-_]?txt|story[-_]?news|article-view-content|newsct_article|dic_area)[^"']*["'][^>]*>([\s\S]*)/i,
  ];
  for (const re of candidates) {
    const m = region.match(re);
    if (m && stripHtml(m[1]).length > 300) { region = m[1]; break; }
  }
  const paras = [];
  const pRe = /<p[^>]*>([\s\S]*?)<\/p>/gi;
  let m;
  while ((m = pRe.exec(region))) {
    const t = stripHtml(m[1]);
    if (t.length >= 25 && !BOILERPLATE.test(t)) paras.push(t);
  }
  let body = paras.join('\n');
  if (body.length < 300) {
    // <p>를 쓰지 않고 <br>로 문단을 나누는 국내 언론사 대응
    body = stripHtml(region.replace(/<br\s*\/?>/gi, '\n')).split(/(?<=[.다])\s+/).filter((l) => !BOILERPLATE.test(l)).join(' ');
  }
  body = body.replace(/\s{3,}/g, '\n').trim();
  return {
    title, canonical, publishedMs, modifiedMs,
    description: meta(html, ['og:description', 'description']),
    noArchive: /noarchive|noai|noimageai/.test(robots),
    body,
  };
}

export async function fetchArticle(url, { timeoutMs, maxBytes, allowHosts, defaultTz }) {
  const res = await safeFetch(url, { timeoutMs, maxBytes, allowHosts });
  if (res.status >= 400) throw new Error(`HTTP ${res.status}`);
  const ex = extractFromHtml(res.text, { defaultTz });
  const bodyLen = ex.body.length;
  return {
    finalUrl: res.finalUrl,
    canonical: ex.canonical,
    pageTitle: ex.title,
    pagePublishedMs: ex.publishedMs,
    pageModifiedMs: ex.modifiedMs,
    description: ex.description,
    // 접근 수준: 본문 확인(full_text) / 일부만 확인(excerpt_only)
    accessLevel: bodyLen >= 600 ? 'full_text' : bodyLen >= 150 ? 'excerpt_only' : 'headline_only',
    body: ex.body.slice(0, 7000),
    bodyChars: bodyLen,
    bodyHash: bodyLen ? sha256(ex.body) : null,
    noArchive: ex.noArchive,
  };
}
