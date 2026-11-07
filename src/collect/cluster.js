// 같은 사건을 다룬 기사 묶기(1차, 규칙 기반). 제목 문자 bigram 유사도로 묶고,
// 의미상 같은 사건인지의 최종 판단과 기존 이슈 묶음(thread) 연결은 LLM 선별 단계가 한다.
import { bigrams, jaccard, containment } from '../lib/text.js';
import { sha1 } from '../lib/crypto.js';

export function clusterArticles(articles, { threshold = 0.34, containThreshold = 0.62 } = {}) {
  const items = articles
    .slice()
    .sort((a, b) => (a.publishedAtMs || 0) - (b.publishedAtMs || 0))
    .map((a) => ({ a, g: bigrams(a.title) }));
  const clusters = [];
  for (const it of items) {
    let best = null;
    let bestScore = 0;
    for (const c of clusters) {
      if (c.lang !== it.a.lang) continue;
      let s = 0;
      for (const m of c.members.slice(-6)) {
        const j = jaccard(it.g, m.g);
        const k = containment(it.g, m.g);
        s = Math.max(s, j >= threshold ? j : k >= containThreshold && Math.min(it.g.size, m.g.size) >= 8 ? k * 0.9 : 0);
      }
      if (s > bestScore) { bestScore = s; best = c; }
    }
    if (best) best.members.push(it);
    else clusters.push({ lang: it.a.lang, members: [it] });
  }
  return clusters.map((c) => summarize(c.members.map((m) => m.a)));
}

export function summarize(arts) {
  const groups = [...new Set(arts.map((a) => a.group))];
  const firstMs = Math.min(...arts.map((a) => a.publishedAtMs));
  const lastMs = Math.max(...arts.map((a) => a.publishedAtMs));
  const rep = arts.find((a) => a.sourceType === 'official') || arts.find((a) => a.sourceType !== 'aggregator') || arts[0];
  return {
    id: `c_${sha1(arts.map((a) => a.id).sort().join(',')).slice(0, 12)}`,
    title: rep.title,
    articleIds: arts.map((a) => a.id),
    groups,
    independentGroups: groups.filter((g) => g !== 'aggregator').length,
    hasOfficial: arts.some((a) => a.sourceType === 'official'),
    hasFetchable: arts.some((a) => a.fetchable),
    firstPublishedAtMs: firstMs,
    lastPublishedAtMs: lastMs,
    hints: [...new Set(arts.map((a) => a.hint).filter(Boolean))],
    lang: rep.lang,
  };
}

/** 선별 LLM에 보낼 후보 우선순위: 독립 출처 수, 공식 자료 여부, 1차 기간 포함 여부 */
export function rankClusters(clusters, win, seenArticleIds = new Set()) {
  return clusters
    .map((c) => {
      const newIds = c.articleIds.filter((id) => !seenArticleIds.has(id));
      const inPrimary = c.lastPublishedAtMs >= win.primaryStartMs;
      const score = Math.min(c.independentGroups, 6) * 1.0 + (c.hasOfficial ? 1.5 : 0) + (inPrimary ? 1.0 : 0) + (newIds.length ? 0 : -5);
      return { ...c, newArticleCount: newIds.length, allSeenBefore: newIds.length === 0, rankScore: score };
    })
    .filter((c) => !c.allSeenBefore)
    .sort((a, b) => b.rankScore - a.rankScore);
}
