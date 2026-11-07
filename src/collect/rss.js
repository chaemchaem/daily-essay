// RSS 2.0 / Atom 파서. 외부 피드 내용은 데이터로만 다루며 어떤 지시도 실행하지 않는다.
import { XMLParser } from 'fast-xml-parser';
import { stripHtml, decodeEntities, truncate } from '../lib/text.js';
import { parseFeedDate } from '../lib/time.js';

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  processEntities: false, // 엔티티 확장 공격 방지: 직접 제한적으로 디코딩
  htmlEntities: false,
  trimValues: true,
});

const asArray = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);
const textOf = (v) => {
  if (v == null) return '';
  if (typeof v === 'string' || typeof v === 'number') return String(v);
  if (typeof v === 'object') return String(v['#text'] ?? v.__cdata ?? '');
  return '';
};

export function parseFeed(xml, { defaultTz = '+00:00' } = {}) {
  if (typeof xml !== 'string' || xml.length > 5_000_000) throw new Error('피드 크기 비정상');
  if (/<!ENTITY/i.test(xml)) throw new Error('DTD 엔티티 선언이 있는 피드는 처리하지 않음');
  const doc = parser.parse(xml);
  const items = [];
  if (doc.rss || doc['rdf:RDF']) {
    const channel = doc.rss ? doc.rss.channel : doc['rdf:RDF'];
    const rawItems = asArray(doc.rss ? channel?.item : doc['rdf:RDF'].item);
    for (const it of rawItems) {
      const source = it.source;
      items.push({
        title: clean(textOf(it.title)),
        link: textOf(it.link) || textOf(it.guid),
        guid: textOf(it.guid),
        publishedMs: parseFeedDate(textOf(it.pubDate) || textOf(it['dc:date']), defaultTz),
        updatedMs: parseFeedDate(textOf(it['atom:updated']) || textOf(it.lastBuildDate), defaultTz),
        description: truncate(clean(stripHtml(decodeEntities(textOf(it.description)))), 400),
        sourceName: source ? clean(textOf(source)) : null,
        sourceUrl: source && typeof source === 'object' ? source['@_url'] || null : null,
        categories: asArray(it.category).map((c) => clean(textOf(c))).filter(Boolean),
      });
    }
  } else if (doc.feed) {
    for (const it of asArray(doc.feed.entry)) {
      const links = asArray(it.link);
      const alt = links.find((l) => !l['@_rel'] || l['@_rel'] === 'alternate') || links[0];
      items.push({
        title: clean(textOf(it.title)),
        link: alt ? alt['@_href'] : '',
        guid: textOf(it.id),
        publishedMs: parseFeedDate(textOf(it.published) || textOf(it.updated), defaultTz),
        updatedMs: parseFeedDate(textOf(it.updated), defaultTz),
        description: truncate(clean(stripHtml(decodeEntities(textOf(it.summary) || textOf(it.content)))), 400),
        sourceName: null,
        sourceUrl: null,
        categories: asArray(it.category).map((c) => c['@_term']).filter(Boolean),
      });
    }
  } else {
    throw new Error('RSS/Atom 형식이 아님');
  }
  return items.filter((i) => i.title && i.link);
}

function clean(s) {
  return decodeEntities(String(s || '')).replace(/\s+/g, ' ').trim();
}
