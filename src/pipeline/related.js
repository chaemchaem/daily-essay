// 같은 사건을 다룬 다른 언론사 기사 찾기.
// 1차 묶기(제목 유사도)는 언론사마다 제목이 달라 같은 사건을 놓치기 쉽다. 그래서 주제를 처리할 때
// 선별 단계의 사건 요약과 묶음 제목을 기준으로, 그날 수집한 전체 기사에서 핵심어가 충분히 겹치는 기사를 더 찾아
// 사실 정리 단계에 함께 넘긴다. 실제로 같은 사건인지는 사실 정리 단계가 다시 판단하고(무관하면 unrelated_to_event),
// 독립 출처 수는 사실표가 실제로 인용한 출처만으로 센다.
import { wordTokens } from '../lib/text.js';

const TYPE_ORDER = { official: 0, wire: 1, press: 1, international: 2, aggregator: 3 };

export function findRelated({ seedArticles, eventSummary, all, max = 6, minShared = 3, minRatio = 0.34, perGroup = 1 }) {
  const seedIds = new Set(seedArticles.map((a) => a.id));
  const query = wordTokens([eventSummary || '', ...seedArticles.map((a) => `${a.title} ${a.feedSummary || ''}`)].join(' '));
  if (query.size < 3) return [];
  const scored = [];
  for (const a of all) {
    if (seedIds.has(a.id)) continue;
    const words = wordTokens(a.title);
    if (!words.size) continue;
    let shared = 0;
    for (const w of words) if (query.has(w)) shared += 1;
    const ratio = shared / words.size;
    // 제목만으로 부족하면 피드 요약문까지 합쳐 핵심어가 충분히(5개 이상, 30% 이상) 겹치는지 본다.
    const wide = wordTokens(`${a.title} ${a.feedSummary || ''}`);
    let sharedWide = 0;
    for (const w of wide) if (query.has(w)) sharedWide += 1;
    const ratioWide = wide.size ? sharedWide / wide.size : 0;
    if (shared >= minShared && ratio >= minRatio) scored.push({ a, shared, ratio });
    else if (sharedWide >= 5 && ratioWide >= 0.3) scored.push({ a, shared: sharedWide - 2, ratio: ratioWide });
  }
  scored.sort((x, y) => (y.shared - x.shared) || (y.ratio - x.ratio) || (TYPE_ORDER[x.a.sourceType] - TYPE_ORDER[y.a.sourceType]) || (Number(y.a.fetchable) - Number(x.a.fetchable)));
  const seedGroups = new Set(seedArticles.map((a) => a.group));
  const count = {};
  const picked = [];
  // 1순위: 아직 없는 언론사의 본문 조회 가능한 기사
  for (const s of scored) {
    if (picked.length >= max) break;
    const g = s.a.group;
    if (!s.a.fetchable || seedGroups.has(g) || (count[g] || 0) >= perGroup) continue;
    picked.push(s.a);
    count[g] = (count[g] || 0) + 1;
  }
  // 2순위: 남은 자리에 나머지(집계 제목 포함)
  for (const s of scored) {
    if (picked.length >= max) break;
    if (picked.includes(s.a) || (count[s.a.group] || 0) >= perGroup) continue;
    picked.push(s.a);
    count[s.a.group] = (count[s.a.group] || 0) + 1;
  }
  return picked;
}
