// 주제별 출처 묶음(source pack): 공식 원자료 우선, 서로 다른 언론사 우선으로 고르고 본문을 조회한다.
// 본문은 data/tmp(커밋 제외)에만 잠시 캐시하고 영구 기록에는 남기지 않는다.
import fs from 'node:fs';
import path from 'node:path';
import { fetchArticle } from '../collect/extract.js';
import { scratchDir } from '../lib/paths.js';
import { toKstIso, nowMs } from '../lib/time.js';
import { errorSummary } from '../lib/log.js';
import { truncate } from '../lib/text.js';

const ORDER = { official: 0, wire: 1, press: 1, international: 2, aggregator: 3 };

export function chooseArticles(articles, max = 10) {
  const sorted = articles.slice().sort((a, b) => (ORDER[a.sourceType] - ORDER[b.sourceType]) || (b.publishedAtMs - a.publishedAtMs));
  const picked = [];
  const groups = new Set();
  for (const a of sorted) if (!groups.has(a.group) && picked.length < max) { picked.push(a); groups.add(a.group); }
  for (const a of sorted) if (!picked.includes(a) && picked.length < max && a.sourceType !== 'aggregator') picked.push(a);
  return picked;
}

function cachePath(id) { return path.join(scratchDir(), 'bodies', `${id}.json`); }

export async function buildSourcePack(articles, { policy, allowHosts, fetcher = fetchArticle }) {
  const chosen = chooseArticles(articles);
  const pack = [];
  const queue = chosen.map((a, i) => ({ a, sid: `S${i + 1}` }));
  const worker = async () => {
    while (queue.length) {
      const { a, sid } = queue.shift();
      const entry = {
        sid, articleId: a.id, title: a.title, outlet: a.outlet, group: a.group, sourceType: a.sourceType, lang: a.lang, url: a.url,
        publishedAt: a.publishedAt, pageModifiedAt: null, checkedAt: null, accessLevel: 'headline_only', fetchError: null, body: '',
        summary: a.feedSummary || '',
      };
      if (a.fetchable) {
        try {
          const cp = cachePath(a.id);
          let r;
          if (fs.existsSync(cp)) r = JSON.parse(fs.readFileSync(cp, 'utf8'));
          else {
            r = await fetcher(a.url, { timeoutMs: policy.runtime.articleFetchTimeoutMs, maxBytes: policy.runtime.articleMaxBytes, allowHosts, defaultTz: a.lang === 'ko' ? '+09:00' : '+00:00' });
            r.checkedAt = toKstIso(nowMs());
            fs.mkdirSync(path.dirname(cp), { recursive: true });
            fs.writeFileSync(cp, JSON.stringify(r));
          }
          entry.checkedAt = r.checkedAt;
          entry.accessLevel = r.noArchive ? 'excerpt_only' : r.accessLevel;
          entry.body = r.noArchive ? truncate(r.body, 600) : r.body;
          entry.pageModifiedAt = r.pageModifiedMs ? toKstIso(r.pageModifiedMs) : null;
          entry.pagePublishedAt = r.pagePublishedMs ? toKstIso(r.pagePublishedMs) : null;
          if (entry.accessLevel === 'headline_only' && entry.summary) entry.accessLevel = 'excerpt_only';
        } catch (err) {
          entry.fetchError = errorSummary(err);
          entry.accessLevel = entry.summary ? 'excerpt_only' : 'headline_only';
        }
      } else {
        entry.accessLevel = entry.summary ? 'excerpt_only' : 'headline_only';
      }
      pack.push(entry);
    }
  };
  await Promise.all(Array.from({ length: policy.runtime.articleFetchConcurrency }, worker));
  pack.sort((x, y) => Number(x.sid.slice(1)) - Number(y.sid.slice(1)));
  return pack;
}

/** 영구 기록용(본문 제외, 발췌 300자) */
export function packForRecord(pack) {
  return pack.map(({ body, ...rest }) => ({ ...rest, excerpt: truncate(body || rest.summary || '', 300), bodyChars: (body || '').length }));
}

const esc = (s) => String(s ?? '').replace(/<\/?source/gi, '‹source').replace(/[<>]/g, (c) => (c === '<' ? '‹' : '›'));

export function renderSources(pack, { maxBodyChars = 3500 } = {}) {
  return pack.map((s) => [
    `<source id="${s.sid}" outlet="${esc(s.outlet)}" type="${s.sourceType}" published="${s.publishedAt || '불명'}" page_modified="${s.pageModifiedAt || '불명'}" access="${s.accessLevel}">`,
    `제목: ${esc(s.title)}`,
    s.body ? `본문(일부일 수 있음): ${esc(truncate(s.body, maxBodyChars))}` : `요약(피드 제공): ${esc(s.summary || '(없음)')}`,
    '</source>',
  ].join('\n')).join('\n\n');
}
