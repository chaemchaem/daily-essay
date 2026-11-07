// 이슈 묶음(thread): 날짜를 넘어 같은 사건을 하나로 관리한다.
// 기사 중복(같은 기사·같은 사건)과 논술 문제 중복(같은 논점)은 별개로 판단한다.
import { readInternal, writeInternal } from '../lib/store.js';
import { addDays } from '../lib/time.js';

const FILE = 'threads/index.json';

export function loadThreads() { return readInternal(FILE, { threads: [] }); }
export function saveThreads(t) { writeInternal(FILE, t); }

export function recentThreads(threads, issueDate, days = 45) {
  const from = addDays(issueDate, -days);
  return threads.threads.filter((t) => t.lastDate >= from && t.lastDate <= issueDate);
}

export function threadBrief(t) {
  return {
    threadId: t.id, title: t.title, category: t.category, firstDate: t.firstDate, lastDate: t.lastDate,
    topics: t.topics.slice(-3).map((x) => ({ issueDate: x.issueDate, prompt: x.prompt, thesis: x.thesis, keyFacts: x.keyFacts?.slice(0, 5) })),
    lastUpdates: t.updates.slice(-3).map((u) => ({ date: u.date, summary: u.summary })),
  };
}

export function ensureThread(threads, { id, title, category, issueDate }) {
  let t = threads.threads.find((x) => x.id === id);
  if (!t) {
    t = { id, title, category, firstDate: issueDate, lastDate: issueDate, topics: [], updates: [], articleIds: [] };
    threads.threads.push(t);
  }
  if (issueDate > t.lastDate) t.lastDate = issueDate;
  return t;
}

/** 새 문제를 낼 필요가 없는 변화는 후속 소식으로만 연결한다. */
export function addUpdate(threads, threadId, update) {
  const t = threads.threads.find((x) => x.id === threadId);
  if (!t) return;
  if (t.updates.some((u) => u.date === update.date && u.summary === update.summary)) return;
  t.updates.push(update);
  if (update.date > t.lastDate) t.lastDate = update.date;
}
