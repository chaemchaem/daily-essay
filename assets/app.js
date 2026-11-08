// 논점 — 읽기·연습 화면. 정적 JSON(data/public)만 읽는다. 서버 저장 기능은 없고, 내 답안·북마크는 이 기기(브라우저)에만 저장한다.
const params = new URLSearchParams(location.search);
const MODE = params.get('data') === 'fixtures' ? 'fixtures' : 'live';
const DATA = MODE === 'fixtures' ? 'data/fixtures/public' : 'data/public';
const $main = document.getElementById('main');
const cache = new Map();

// ── 유틸 ──
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const safeUrl = (u) => (/^https?:\/\//i.test(String(u || '')) ? esc(u) : '#');
const num = (n) => Number(n || 0).toLocaleString('ko-KR');
const DOW = ['일', '월', '화', '수', '목', '금', '토'];
function kstNow() { const d = new Date(Date.now() + 9 * 3600 * 1000); return { date: d.toISOString().slice(0, 10), iso: d.toISOString() }; }
function dow(date) { return DOW[new Date(`${date}T00:00:00Z`).getUTCDay()]; }
function longDate(date) { const [y, m, d] = date.split('-').map(Number); return `${y}년 ${m}월 ${d}일 ${dow(date)}요일`; }
function shortDate(date) { const [, m, d] = date.split('-').map(Number); return `${m}.${d}(${dow(date)})`; }
/** 서버가 +09:00 형식으로 저장한 시각을 그대로 읽어 표시(브라우저 시간대와 무관) */
function kst(iso, { date = true } = {}) {
  if (!iso) return '—';
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!m) return esc(iso);
  return date ? `${Number(m[2])}.${Number(m[3])}(${dow(`${m[1]}-${m[2]}-${m[3]}`)}) ${m[4]}:${m[5]}` : `${m[4]}:${m[5]}`;
}
function addDays(date, n) { return new Date(Date.parse(`${date}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10); }

const store = {
  key: (k) => `nj:${MODE}:${k}`,
  get(k, d) { try { const v = localStorage.getItem(this.key(k)); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(this.key(k), JSON.stringify(v)); return true; } catch { return false; } },
  del(k) { try { localStorage.removeItem(this.key(k)); } catch { /* 저장소 사용 불가 */ } },
  keys(prefix) { const out = []; try { for (let i = 0; i < localStorage.length; i += 1) { const k = localStorage.key(i); if (k && k.startsWith(this.key(prefix))) out.push(k.slice(this.key('').length)); } } catch { /* 저장소 사용 불가 */ } return out; },
};

async function getJSON(path, { fresh = false } = {}) {
  if (!fresh && cache.has(path)) return cache.get(path);
  const p = fetch(`${DATA}/${path}`, { cache: fresh ? 'no-cache' : 'default' }).then((r) => {
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  }).then((j) => { if (j && j.test) document.getElementById('test-banner').hidden = false; return j; });
  cache.set(path, p);
  p.catch(() => cache.delete(path));
  return p;
}
const topicPath = (id) => `topics/${encodeURIComponent(id)}.json`;

function setTitle(t) { document.title = t ? `${t} — ${SITE.name}` : SITE.name; }
let SITE = { name: '논점', tagline: '어제의 사건을 오늘의 논술로' };

// ── 라우터 ──
function route() {
  const raw = location.hash.replace(/^#/, '') || '/';
  const [pathPart, query = ''] = raw.split('?');
  const parts = pathPart.split('/').filter(Boolean).map(decodeURIComponent);
  return { parts, q: new URLSearchParams(query) };
}
async function render() {
  const { parts, q } = route();
  const top = parts[0] || '';
  document.querySelectorAll('[data-nav]').forEach((a) => a.removeAttribute('aria-current'));
  const navKey = { '': 'home', issue: 'home', topic: 'home', archive: 'archive', week: 'week', search: 'search', me: 'me', about: 'about', status: null, print: null }[top];
  if (navKey) document.querySelector(`[data-nav="${navKey}"]`)?.setAttribute('aria-current', 'page');
  try {
    if (top === '') await viewHome();
    else if (top === 'issue') await viewIssue(parts[1]);
    else if (top === 'topic') await viewTopic(parts[1], parts[2] || 'brief', q);
    else if (top === 'print') await viewPrint(parts[1], q.get('mode') || 'question');
    else if (top === 'archive') await viewArchive(parts[1]);
    else if (top === 'week') await viewWeek();
    else if (top === 'search') await viewSearch(q);
    else if (top === 'me') viewMe();
    else if (top === 'status') await viewStatus();
    else if (top === 'about') viewAbout();
    else $main.innerHTML = `<div class="empty"><h1 class="h2">페이지를 찾을 수 없습니다</h1><p><a href="#/">오늘 호로 가기</a></p></div>`;
  } catch (err) {
    console.error(err);
    $main.innerHTML = `<div class="notice"><p><strong>데이터를 불러오지 못했습니다.</strong></p><p class="small muted">${esc(err.message)} — 잠시 뒤 새로고침해 주세요.</p></div>`;
  }
}

// ── 제호 상태 ──
const STATE_TONE = { published: 'ok', partial: 'ok', ready: 'warn', generating: 'warn', scheduled: 'warn', delayed: 'bad', failed_collect: 'bad', failed_generation: 'bad', no_qualifying_topics: 'warn', all_held: 'warn', budget_deferred: 'bad', paused: 'warn' };
async function hydrateMast() {
  const [index, status] = await Promise.all([getJSON('index.json', { fresh: true }), getJSON('status.json', { fresh: true })]);
  if (index?.site) {
    SITE = { ...SITE, ...index.site };
    document.querySelectorAll('[data-site-name]').forEach((el) => { el.textContent = SITE.name; });
    document.querySelectorAll('[data-site-tagline]').forEach((el) => { el.textContent = SITE.tagline; });
  }
  const now = todayOf(status);
  document.getElementById('mast-date').innerHTML = `${longDate(now)}<span class="hide-sm"> · 한국시간</span>`;
  const el = document.getElementById('mast-status');
  if (status) {
    const s = todayState(status);
    const text = s.state === 'published' || s.state === 'partial' ? `오늘 ${status.schedule.publishAtKst} 발행 · ${s.published}편` : s.state === 'scheduled' || s.state === 'generating' || s.state === 'ready' ? `오늘 호 준비 중 · ${status.schedule.publishAtKst} 예정` : s.stateLabel;
    el.textContent = text;
    el.dataset.state = STATE_TONE[s.state] || '';
  } else {
    el.textContent = '운영 현황';
  }
  return { index, status };
}

/** 견본 데이터는 견본 생성 시점의 '오늘'을 기준으로 보여준다. 실데이터는 이 기기의 현재 한국 시각 기준. */
function todayOf(status) { return MODE === 'fixtures' && status?.today?.date ? status.today.date : kstNow().date; }
/** status.json이 오늘 것이 아니면(예약 작업이 아직 돌지 않음) 시각으로 예정/지연을 판단한다. */
function todayState(status) {
  const today = todayOf(status);
  if (status.today?.date === today) return status.today;
  const [h, m] = String(status.schedule?.publishAtKst || '09:00').split(':').map(Number);
  const nowIso = kstNow().iso;
  const minutes = Number(nowIso.slice(11, 13)) * 60 + Number(nowIso.slice(14, 16));
  const late = minutes >= h * 60 + m + 10;
  return { date: today, state: late ? 'delayed' : 'scheduled', stateLabel: late ? '발행 지연' : '예정', published: 0, held: 0, failedStage: null };
}

// ── 오늘 호 ──
async function viewHome() {
  const { index, status } = await hydrateMast();
  setTitle(null);
  const today = todayOf(status);
  if (!index || !index.issues.length) {
    $main.innerHTML = `<div class="empty"><p class="kicker">첫 발행 전</p><h1 class="h1">아직 발행된 호가 없습니다</h1>
      <p class="lede">${status ? `다음 발행 예정 시각은 ${kst(status.nextScheduledPublish)}입니다.` : '예약 작업이 아직 한 번도 실행되지 않았습니다.'} 실행 상태는 <a href="#/status">운영 현황</a>에서 확인할 수 있습니다.</p>
      <p class="muted small">화면 견본은 <a href="?data=fixtures#/">테스트 데이터 보기</a>에서 확인할 수 있습니다(가상의 사례).</p></div>`;
    return;
  }
  const todayEntry = index.issues.find((i) => i.date === today);
  const latest = index.issues.find((i) => i.count > 0);
  let notice = '';
  let show = todayEntry && todayEntry.count ? todayEntry : latest;
  if (!todayEntry || !todayEntry.count) {
    const st = status ? todayState(status).state : null;
    const reason = {
      scheduled: `오늘 호는 ${status?.schedule?.publishAtKst ?? '09:00'}에 발행됩니다.`,
      generating: '오늘 호를 작성·검토하고 있습니다. 검토가 끝나기 전에는 발행하지 않습니다.',
      ready: `오늘 호는 검토를 마쳤고 ${status?.schedule?.publishAtKst ?? '09:00'}에 공개됩니다.`,
      delayed: '오늘 호 발행이 지연되고 있습니다. 검토가 끝나지 않은 글은 정시에 맞추기 위해 발행하지 않습니다.',
      failed_collect: '오늘 호의 뉴스 수집 작업이 실패했습니다. 이슈가 없는 날이 아니라 작업 오류이며, 재시도 중이거나 재시도가 필요합니다.',
      failed_generation: '오늘 호의 생성 작업 중 오류가 발생했습니다. 이슈가 없는 날이 아니라 작업 오류입니다.',
      no_qualifying_topics: '오늘은 선정 기준을 통과한 새 주제가 없어 발행하지 않았습니다. (작업 오류가 아닙니다)',
      all_held: '오늘 후보 주제가 있었지만 모두 검토를 통과하지 못해 보류했습니다. 기준 미달 글은 발행하지 않습니다.',
      budget_deferred: '일일 비용 상한에 도달해 오늘 주제 작성을 보류했습니다. 검토 절차는 생략하지 않습니다.',
      paused: '관리자가 예약 발행을 일시 중지했습니다.',
    }[st] || '오늘 호는 아직 발행되지 않았습니다.';
    notice = `<div class="notice ${['scheduled', 'ready', 'generating'].includes(st) ? 'notice-quiet' : ''}"><p><strong>${shortDate(today)} 호</strong> — ${esc(reason)}</p>${latest ? `<p class="small muted">아래는 직전 정상 발행호(${shortDate(latest.date)})입니다.</p>` : ''}</div>`;
  }
  if (!show) { $main.innerHTML = notice; return; }
  const issue = await getJSON(`issues/${show.date}.json`);
  $main.innerHTML = notice + (await issueBlock(issue));
}

async function viewIssue(date) {
  await hydrateMast();
  const issue = await getJSON(`issues/${date}.json`);
  if (!issue) { $main.innerHTML = `<div class="empty"><h1 class="h2">${esc(date)} 발행 기록이 없습니다</h1><p><a href="#/archive">지난 호 보기</a></p></div>`; return; }
  setTitle(`제${issue.number}호`);
  $main.innerHTML = await issueBlock(issue);
}

const STATE_EXPLAIN = {
  no_qualifying_topics: '선정 기준을 통과한 새 주제가 없어 이날은 발행하지 않았습니다.',
  all_held: '후보 주제가 모두 검토를 통과하지 못해 보류되었습니다.',
  failed_collect: '수집 작업이 실패했습니다(이슈가 없는 날과 다릅니다).',
  failed_generation: '생성 작업 중 오류가 있었습니다(이슈가 없는 날과 다릅니다).',
  budget_deferred: '비용 상한으로 작성을 보류했습니다.',
};

async function issueBlock(issue) {
  const w = issue.window || {};
  const held = issue.counts?.held || 0;
  const head = `<header class="issue-head"><p class="issue-no">제 <b>${issue.number}</b>호</p><p class="issue-date">${longDate(issue.date)}</p></header>
  <dl class="meta-grid">
    <div><dt>수집 대상 기간</dt><dd>${kst(w.primaryStart)} – ${kst(w.primaryEnd)}</dd></div>
    <div><dt>정보 기준 시점</dt><dd>${kst(issue.infoCutoff)}</dd></div>
    <div><dt>발행</dt><dd>${issue.publishedAt ? kst(issue.publishedAt) : '—'}</dd></div>
    <div><dt>수록 · 보류</dt><dd>${issue.topics.length}편 · ${held}편</dd></div>
  </dl>`;
  const notes = [];
  if (issue.recovered) notes.push(`<div class="notice notice-quiet"><p><strong>복구 발행</strong> — 누락된 날짜를 ${kst(issue.recovered.generatedAt)}에 나중에 생성했습니다. 정보 기준 시점(${kst(issue.infoCutoff)}) 이후 보도는 쓰지 않았습니다.</p></div>`);
  if (held && issue.topics.length) notes.push(`<p class="small muted" style="margin:10px 0 0">검토를 통과하지 못한 주제 ${held}편은 발행하지 않았습니다 (${(issue.heldSummary || []).map((h) => `${esc(h.reason)} ${h.count}`).join(', ')}).</p>`);
  if (!issue.topics.length) notes.push(`<div class="empty"><p class="lede">${esc(STATE_EXPLAIN[issue.state] || issue.stateLabel)}</p>${(issue.heldSummary || []).length ? `<p class="small muted">보류 사유: ${issue.heldSummary.map((h) => `${esc(h.reason)} ${h.count}건`).join(', ')}</p>` : ''}${issue.noTopicReason ? `<p class="small muted">${esc(issue.noTopicReason)}</p>` : ''}</div>`);
  const toc = issue.topics.length ? `<ol class="toc">${issue.topics.map((t, i) => tocItem(t, i)).join('')}</ol>` : '';
  let fu = '';
  if (issue.followUpNews?.length) {
    const items = await Promise.all(issue.followUpNews.map(async (u) => {
      const th = await getJSON(`threads/${encodeURIComponent(u.threadId)}.json`).catch(() => null);
      const last = th?.topics?.[th.topics.length - 1];
      return `<li><span class="d">${esc(th?.title || '이어지는 이슈')}</span><div><p class="small" style="margin:0 0 4px;font-family:var(--serif);font-size:15px">${esc(u.summary)}</p>${last ? `<p class="small muted" style="margin:0">이전 문제: <a href="#/topic/${encodeURIComponent(last.id)}">${esc(last.title)}</a> (${shortDate(last.issueDate)})</p>` : ''}</div></li>`;
    }));
    fu = `<h2 class="h2">이어지는 소식</h2><p class="small muted" style="margin-top:-6px">새 문제를 낼 만큼 논점이 달라지지 않은 변화는 기존 이슈의 후속 소식으로만 연결합니다.</p><ul class="day-list">${items.join('')}</ul>`;
  }
  const versions = issue.versions?.length > 1 ? `<details class="fold" style="margin-top:36px"><summary>이 호의 변경 기록</summary><div><ul class="list small">${issue.versions.map((v) => `<li class="mono">v${v.version} · ${kst(v.at)} · ${esc(v.change)}</li>`).join('')}</ul></div></details>` : '';
  return head + notes.join('') + toc + fu + versions;
}

function tocItem(t, i) {
  const flags = [t.kind === 'follow_up' ? '<span class="tag tag-red">후속 주제</span>' : '', t.lateEntry ? `<span class="tag">늦게 발견 · 발생 ${shortDate(t.lateEntry.eventDate)}</span>` : '', t.hasCorrections ? `<span class="tag tag-ink">정정 v${t.version}</span>` : '', t.stances?.length ? `<span class="tag">입장별 답안: ${t.stances.map((s) => esc(s.split(' — ')[0])).join('·')}</span>` : ''].join('');
  return `<li class="toc-item"><span class="toc-num" aria-hidden="true">${String(i + 1).padStart(2, '0')}</span><div>
    <div class="toc-top"><span class="cat" data-cat="${esc(t.category)}">${esc(t.categoryLabel)}</span><span class="toc-type">${esc(t.questionType)}</span>${flags}</div>
    <h2 class="toc-title"><a href="#/topic/${encodeURIComponent(t.id)}">${esc(t.title)}</a></h2>
    <p class="toc-headline">${esc(t.headline)}</p>
    <p class="toc-prompt">${esc(t.prompt)}</p>
    <p class="toc-meta"><span>모범답안 ${num(t.chars)}자</span><a href="#/topic/${encodeURIComponent(t.id)}/question">문제 풀기 →</a></p>
  </div></li>`;
}

// ── 주제 상세 ──
const TABS = [['brief', '브리핑'], ['question', '문제'], ['answer', '모범답안'], ['logic', '논리 해설'], ['alt', '다른 입장'], ['learn', '학습 포인트'], ['sources', '출처·검토']];

async function viewTopic(id, tab, q) {
  await hydrateMast();
  const t = await getJSON(topicPath(id));
  if (!t) { $main.innerHTML = `<div class="empty"><h1 class="h2">주제를 찾을 수 없습니다</h1><p><a href="#/">오늘 호로</a></p></div>`; return; }
  setTitle(t.title);
  const answers = t.answers?.length ? t.answers : null;
  const sKey = (answers && answers.find((a) => a.key === q.get('s'))?.key) || answers?.[0]?.key || null;
  const cur = answers?.find((a) => a.key === sKey);
  const view = cur ? { ...t, answer: cur.answer, logic: cur.logic, alternatives: cur.alternatives, alternativesNote: cur.alternativesNote, learning: cur.learning, claims: cur.claims, review: { ...t.review, ...cur.review } } : t;
  const sq = t.debate && sKey ? `?s=${encodeURIComponent(sKey)}` : '';
  const issue = await getJSON(`issues/${t.issueDate}.json`);
  const bookmarks = store.get('bookmarks', {});
  const draft = store.get(`draft:${id}`, null);
  const tabs = [...TABS, ...(draft?.text ? [['compare', '나란히 보기']] : [])];
  const head = `<header class="topic-head">
    <p class="kicker"><a href="#/issue/${t.issueDate}">제${issue?.number ?? '?'}호 · ${shortDate(t.issueDate)}</a><span class="cat" data-cat="${esc(t.category)}">${esc(t.categoryLabel)}</span><span>${esc(t.question.typeLabel)}</span>${t.kind === 'follow_up' ? '<span class="tag tag-red">후속 주제</span>' : ''}${t.version > 1 ? `<span class="tag tag-ink">정정 v${t.version}</span>` : ''}</p>
    <h1 class="h1">${esc(t.title)}</h1>
    <p class="lede">${esc(t.headline)}</p>
    <p class="kicker" style="margin:0">사건 발생 ${t.dates.eventDate ? shortDate(t.dates.eventDate) : '미상'} · 정보 기준 ${kst(t.dates.infoCutoff)} · 발행 ${kst(t.dates.publishedAt)}${t.lateEntry ? ` · 늦게 발견된 사건` : ''}</p>
    <div class="topic-actions no-print">
      <button class="btn btn-quiet" data-act="bookmark" aria-pressed="${bookmarks[id] ? 'true' : 'false'}">${bookmarks[id] ? '북마크됨' : '북마크'}</button>
      <a class="btn btn-quiet" href="#/print/${encodeURIComponent(id)}?mode=question">인쇄용 보기</a>
      <button class="btn btn-quiet" data-act="hide-pref" aria-pressed="${prefHide() ? 'true' : 'false'}" title="켜 두면 모범답안을 바로 보여주지 않고 먼저 풀어 보도록 권합니다">${prefHide() ? '✓ ' : ''}답안 먼저 가리기</button>
    </div>
  </header>
  <nav class="tabs" aria-label="주제 보기 전환">${tabs.map(([k, l]) => `<a href="#/topic/${encodeURIComponent(id)}/${k}${sq}" ${k === tab ? 'aria-current="page"' : ''}>${l}</a>`).join('')}</nav>`;
  let body = '';
  const bar = ['answer', 'logic', 'alt', 'learn', 'sources', 'compare'].includes(tab) ? stanceBar(t, tab, sKey) : '';
  if (tab === 'brief') body = await tabBrief(t);
  else if (tab === 'question') body = tabQuestion(t);
  else if (tab === 'answer') body = tabAnswer(view);
  else if (tab === 'logic') body = tabLogic(view);
  else if (tab === 'alt') body = tabAlt(view);
  else if (tab === 'learn') body = tabLearn(view);
  else if (tab === 'sources') body = tabSources(view);
  else if (tab === 'compare') body = tabCompare(view);
  body = bar + body;
  $main.innerHTML = head + `<div class="tab-body">${body}</div>`;
  bindTopic(view, tab);
  const focus = q.get('f');
  if (focus) document.getElementById(focus)?.scrollIntoView({ block: 'center' });
  else if (window.scrollY > 400) document.querySelector('.tabs')?.scrollIntoView();
}

/** 찬반형 주제의 입장 선택 막대 */
function stanceBar(t, tab, sKey) {
  if (!t.debate) return '';
  const btns = (t.answers || []).map((a) => `<a class="btn ${a.key === sKey ? 'btn-solid' : 'btn-quiet'}" href="#/topic/${encodeURIComponent(t.id)}/${tab}?s=${encodeURIComponent(a.key)}" ${a.key === sKey ? 'aria-current="true"' : ''}>${esc(a.label)}</a>`).join('');
  const omitted = (t.debate.omitted || []).map((o) => `<p class="small muted" style="margin:6px 0 0">${esc(o.label)} 답안: ${esc(o.reason)}</p>`).join('');
  return `<section class="stance-bar no-print" aria-label="입장 선택"><p class="kicker" style="margin:0 0 8px">명제 — ${esc(t.debate.proposition)}</p><div class="btn-row">${btns}</div>${omitted}</section>`;
}

function prefHide() { return store.get('pref:hideAnswers', true); }

function factChips(t, ids) {
  if (!ids?.length) return '';
  return `<span class="chips">${ids.map((f) => `<a class="chip" href="#/topic/${encodeURIComponent(t.id)}/brief?f=fact-${esc(f)}" title="${esc(t.briefing.facts.find((x) => x.id === f)?.statement || '')}">${esc(f)}</a>`).join('')}</span>`;
}

async function tabBrief(t) {
  const b = t.briefing;
  const th = t.threadId ? await getJSON(`threads/${encodeURIComponent(t.threadId)}.json`).catch(() => null) : null;
  const fu = t.followUp ? `<section class="followup"><h2>후속 주제 — 이전 논의에서 무엇이 달라졌나</h2><dl>
    <div><dt>이전에 다룬 내용</dt><dd>${esc(t.followUp.previouslyCovered)}</dd></div>
    <div><dt>이번에 달라진 사실</dt><dd>${esc(t.followUp.whatChanged)}</dd></div>
    <div><dt>새로 논할 이유</dt><dd>${esc(t.followUp.whyNewDiscussion)}</dd></div>
    <div><dt>달라진 발문</dt><dd>${esc(t.followUp.questionDifference)}</dd></div>
    ${t.followUp.previous?.length ? `<div><dt>이전 문제</dt><dd>${t.followUp.previous.map((p) => `<a href="#/topic/${encodeURIComponent(p.id)}">${esc(p.title)}</a> (${shortDate(p.issueDate)})`).join('<br>')}</dd></div>` : ''}
  </dl></section>` : '';
  const late = t.lateEntry ? `<div class="notice notice-quiet"><p><strong>늦게 발견된 사건</strong> — 실제 발생일 ${shortDate(t.lateEntry.eventDate)}. ${esc(t.lateEntry.reason)}</p></div>` : '';
  const notices = (t.notices || []).map((n) => `<div class="notice"><p><strong>알림 ${kst(n.at)}</strong> — ${esc(n.text)}</p></div>`).join('');
  const others = th ? [...(th.topics || []).filter((x) => x.id !== t.id), ...[]] : [];
  const aside = `<aside class="aside">
    <div class="aside-block"><h3>진행 단계</h3><p><span class="tag tag-ink">${esc(b.stage.label)}</span></p><p>${esc(b.stage.note)}</p>${b.legalStatusNote ? `<p class="muted">${esc(b.legalStatusNote)}</p>` : ''}</div>
    <div class="aside-block"><h3>날짜</h3><p class="mono small">사건 ${t.dates.eventDate ? shortDate(t.dates.eventDate) : '미상'}<br>수집 ${kst(t.dates.window.start)} – ${kst(t.dates.window.end)}<br>정보 기준 ${kst(t.dates.infoCutoff)}</p><p class="small muted">${esc(t.dates.eventDateBasis || '')}</p></div>
    ${b.uncertainties?.length ? `<div class="aside-block"><h3>아직 확인되지 않은 것</h3><ul>${b.uncertainties.map((u) => `<li>${esc(u)}</li>`).join('')}</ul></div>` : ''}
    ${others.length || th?.updates?.length ? `<div class="aside-block"><h3>같은 이슈의 다른 글·후속 소식</h3><ul>${others.map((x) => `<li><a href="#/topic/${encodeURIComponent(x.id)}">${esc(x.title)}</a> <span class="mono small muted">${shortDate(x.issueDate)}</span></li>`).join('')}${(th?.updates || []).map((u) => `<li><span class="mono small muted">${shortDate(u.date)}</span> ${esc(u.summary)}${u.articles?.length ? ` <span class="small muted">— ${u.articles.slice(0, 2).map((a) => `<a href="${safeUrl(a.url)}" rel="noopener noreferrer" target="_blank">${esc(a.outlet)}</a>`).join(', ')}</span>` : ''}</li>`).join('')}</ul></div>` : ''}
  </aside>`;
  const main = `<div>
    ${fu}${late}${notices}
    <h2 class="h2" style="margin-top:0"><span class="label-fact">사실</span>무슨 일이 있었나</h2>
    <div class="prose"><p>${esc(b.whatHappened)}</p></div>
    <h3 class="h3">이번 수집 기간에 달라진 점</h3>
    <div class="prose"><p>${esc(b.whatChanged)}</p></div>
    <h3 class="h3">이해관계자와 입장</h3>
    <div class="table-wrap"><table class="table"><thead><tr><th>주체</th><th>입장</th><th>이해관계</th></tr></thead><tbody>${b.stakeholders.map((s) => `<tr><td><strong>${esc(s.name)}</strong></td><td>${esc(s.position)}</td><td>${esc(s.interest)}</td></tr>`).join('')}</tbody></table></div>
    <h3 class="h3">사실표 — 답안이 근거로 쓸 수 있는 진술</h3>
    <ul class="facts">${b.facts.map((f) => `<li id="fact-${esc(f.id)}"><span class="fid">${esc(f.id)}</span><div><p class="ftext">${esc(f.statement)}</p><p class="fmeta"><span class="tag ${f.kind === 'confirmed' ? 'tag-ink' : f.kind === 'party_claim' ? 'tag-red' : ''}">${esc(f.kindLabel)}</span>${f.attributedTo ? `<span>주체: ${esc(f.attributedTo)}</span>` : ''}<span>${esc(f.accessLabel)}</span>${f.sourceIds.map((s) => `<a class="chip" href="#/topic/${encodeURIComponent(t.id)}/sources?f=src-${esc(s)}">${esc(s)}</a>`).join('')}</p></div></li>`).join('')}</ul>
    ${b.discrepancies?.length ? `<h3 class="h3">출처 간 차이</h3><ul class="list">${b.discrepancies.map((d) => `<li>${esc(d.description)} ${d.resolved ? `<span class="tag tag-ok">해소</span> ${esc(d.resolution || '')}` : '<span class="tag tag-warn">미해소 — 답안의 확정 근거로 쓰지 않음</span>'}</li>`).join('')}</ul>` : ''}
    <section class="interp">
      <h2 class="h2"><span class="label-interp">해석</span>충돌하는 가치와 핵심 쟁점</h2>
      <p class="small muted" style="margin-top:-6px">아래는 편집 판단이며 사실 설명과 구분됩니다.</p>
      ${b.interpretation.valueConflicts.map((v) => `<div class="versus" style="grid-template-columns:1fr"><div><h3>${v.values.map(esc).join(' ↔ ')}</h3><p>${esc(v.description)}</p></div></div>`).join('')}
      <h3 class="h3">핵심 쟁점</h3><ul class="list">${b.interpretation.coreIssues.map((c) => `<li>${esc(c)}</li>`).join('')}</ul>
      <h3 class="h3">이해관계 정리</h3><div class="prose"><p>${esc(b.interpretation.stakeholderSummary)}</p></div>
      <h3 class="h3">논술 주제로 고른 이유</h3><div class="prose"><p>${esc(b.interpretation.whySelected)}</p></div>
    </section>
  </div>`;
  return `<div class="two-col">${main}${aside}</div>`;
}

function sheet(t) {
  const q = t.question;
  return `<section class="sheet" aria-label="논술 문제">
    <div class="sheet-label"><span>[문제] ${esc(q.typeLabel)}</span><span>${esc(t.categoryLabel)} · ${shortDate(t.issueDate)}</span></div>
    <p class="sheet-bg">${esc(q.background)}</p>
    ${q.passages.map((p) => `<div class="passage"><p><span class="passage-label">(${esc(p.label)})</span>${esc(p.text)}</p><span class="passage-note">출처를 바탕으로 재구성한 제시문 · 근거 ${p.basisFactIds.map(esc).join(', ')}</span></div>`).join('')}
    <p class="prompt">${esc(q.prompt)}</p>
    <ol class="reqs">${q.requirements.map((r) => `<li>${esc(r.text)}</li>`).join('')}</ol>
    <div class="sheet-foot"><span>분량 ${num(q.length.minChars)}~${num(q.length.maxChars)}자 (${esc(q.length.countMode)})</span><span>권장 시간 ${q.timeMinutes}분</span></div>
  </section>`;
}

function tabQuestion(t) {
  const q = t.question;
  const draft = store.get(`draft:${t.id}`, { text: '', savedAt: null });
  const deb = t.debate ? `<div class="notice notice-quiet"><p><strong>찬반형 문제</strong> — 명제: ${esc(t.debate.proposition)}</p><p class="small">찬성·반대 중 한 입장을 택해 쓰면 됩니다. 모범답안은 입장별로 따로 실었습니다${t.debate.omitted?.length ? ` (${t.debate.omitted.map((o) => `${esc(o.label)}: ${esc(o.reason)}`).join(' / ')})` : ''}.</p></div>` : '';
  return `${deb}${sheet(t)}
  <details class="fold"><summary>출제 의도</summary><div class="prose"><p>${esc(q.intent)}</p></div></details>
  <details class="fold"><summary>평가 기준</summary><div><div class="table-wrap"><table class="table"><thead><tr><th>기준</th><th>설명</th><th style="text-align:right">비중</th></tr></thead><tbody>${q.rubric.map((r) => `<tr><td><strong>${esc(r.criterion)}</strong></td><td>${esc(r.description)}</td><td class="num">${r.weight}</td></tr>`).join('')}</tbody></table></div><p class="small muted">평가는 특정 입장과의 일치가 아니라 요구사항 충족, 근거, 논리적 정합성, 반론 처리, 대안의 타당성을 봅니다.</p></div></details>
  <section class="writer no-print" aria-label="직접 써 보기">
    <div class="writer-head"><h2 class="h2" style="margin:36px 0 0">직접 써 보기</h2><span class="device-note" id="save-state">${draft.savedAt ? `이 기기에 저장됨 · ${esc(draft.savedAt)}` : '이 기기(브라우저)에만 저장됩니다'}</span></div>
    <textarea class="paper" id="draft" spellcheck="false" placeholder="서론부터 결론까지 완성된 글로 써 보세요. 쓰는 동안 이 기기에 자동 저장됩니다." aria-describedby="counter">${esc(draft.text)}</textarea>
    <div class="counter" id="counter" aria-live="polite"></div>
    <div class="meter" aria-hidden="true"><i id="meter-fill"></i><span class="band" id="meter-band"></span></div>
    <div class="btn-row" style="margin-top:16px">
      <a class="btn btn-solid" href="#/topic/${encodeURIComponent(t.id)}/compare" id="go-compare">모범답안과 나란히 보기</a>
      <button class="btn btn-quiet" data-act="clear-draft">내 답안 지우기</button>
    </div>
    <p class="small muted" style="margin-top:12px">작성한 글은 서버로 전송되지 않으며 이 브라우저의 저장소에만 남습니다. 다른 기기와 동기화되지 않고, 브라우저 데이터를 지우면 함께 사라집니다.</p>
  </section>`;
}

function answerParas(t, { notes = true } = {}) {
  const roles = t.answer.paragraphRoles || [];
  const logic = t.logic?.paragraphs || [];
  return `<div class="answer ${notes ? '' : 'plain'}">${t.answer.paragraphs.map((p, i) => {
    const lr = logic.find((x) => x.index === i + 1);
    const role = lr?.role || roles[i]?.role || '';
    return `<div class="para"><p>${esc(p)}</p><span class="para-note"><b>¶${i + 1}</b>${esc(role)}</span></div>`;
  }).join('')}</div>`;
}

function tabAnswer(t) {
  const revealed = !prefHide() || store.get(`revealed:${t.id}`, false);
  if (!revealed) {
    return `<section class="cover"><h2 class="h2">먼저 풀어 보세요</h2><p>답안을 먼저 보면 스스로 논증을 세우는 연습이 줄어듭니다. 문제 탭에서 직접 써 본 뒤 비교하는 것을 권합니다.</p>
      <div class="btn-row"><a class="btn btn-solid" href="#/topic/${encodeURIComponent(t.id)}/question">문제로 가서 써 보기</a><button class="btn" data-act="reveal">그래도 답안 보기</button></div></section>`;
  }
  const a = t.answer;
  return `<p class="answer-meta"><span>${num(a.chars)}자 (${esc(a.countMode)})</span><span>공백 제외 ${num(a.charsNoSpace)}자</span><span>${a.paragraphs.length}문단</span><span>검토 ${t.review.rounds}회 · 수정 ${t.review.revisions.length}회</span>${t.version > 1 ? `<span>v${t.version} (정정 이력 있음)</span>` : ''}</p>
  ${answerParas(t)}
  <p class="small muted" style="max-width:var(--measure);margin-top:24px">오른쪽(모바일은 문단 아래) 붉은 메모는 문단의 역할입니다. 각 문단의 근거와 추론은 <a href="#/topic/${encodeURIComponent(t.id)}/logic">논리 해설</a>에서, 사실 확인 결과는 <a href="#/topic/${encodeURIComponent(t.id)}/sources">출처·검토</a>에서 볼 수 있습니다. 이 답안은 하나의 모범 예시이며 유일한 정답이 아닙니다.</p>`;
}

function tabLogic(t) {
  const L = t.logic;
  return `<p class="kicker">중심 논제</p><p class="thesis">${esc(L.centralQuestion)}</p>
  <p class="kicker">최종 입장</p><div class="prose"><p><strong>${esc(L.finalPosition)}</strong></p></div>
  ${L.definitions?.length ? `<h2 class="h2">개념과 논의 범위</h2><dl class="deflist">${L.definitions.map((d) => `<div><dt>${esc(d.term)}</dt><dd>${esc(d.meaning)}<br><span class="small muted">${esc(d.whyNeeded)}</span></dd></div>`).join('')}</dl>` : ''}
  ${L.judgmentCriteria ? `<h3 class="h3">사실에서 가치판단으로 넘어가는 기준</h3><div class="prose"><p>${esc(L.judgmentCriteria)}</p></div>` : ''}
  <h2 class="h2">문단별 주장과 역할</h2>
  <ol class="flow">${L.paragraphs.map((p) => `<li><span class="flow-n">¶${p.index}</span><div><span class="flow-role">${esc(p.role)}</span><p class="flow-claim">${esc(p.mainClaim)}</p><p class="flow-inf">${esc(p.inference)}</p>${factChips(t, p.evidenceFactIds)}</div></li>`).join('')}</ol>
  <h2 class="h2">논증이 성립하기 위한 전제</h2><ul class="list">${L.premises.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>
  <h2 class="h2">가장 강한 반론과 재반박</h2>
  <div class="versus"><div><h3>반론</h3><p>${esc(L.strongestObjection)}</p></div><div><h3>재반박</h3><p>${esc(L.rebuttal)}</p></div></div>
  ${L.proposalConditions ? `<h2 class="h2">대안의 실행 조건</h2><div class="prose"><p>${esc(L.proposalConditions)}</p></div>` : ''}
  <h2 class="h2">결론이 성립하지 않을 수 있는 조건</h2><ul class="list">${L.failureConditions.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>
  <p class="small muted" style="margin-top:28px;max-width:44rem">이 해설은 답안에 실제로 있는 논증을 정리한 것입니다. 생성 모델의 내부 사고과정이 아닙니다.</p>`;
}

function tabAlt(t) {
  const alts = t.alternatives || [];
  return `<div class="prose" style="margin-bottom:22px"><p>${esc(t.alternativesNote)}</p></div>
  ${alts.length ? alts.map((a, i) => `<section class="alt"><p class="kicker">다른 입장 ${i + 1}</p><h3>${esc(a.position)}</h3><dl>
    <div><dt>가치 우선순위</dt><dd>${esc(a.valuePriority)}</dd></div>
    <div><dt>사실적 전제</dt><dd>${esc(a.factualPremise)}</dd></div>
    <div><dt>논증 개요</dt><dd><ol class="list" style="padding-left:1.2em">${a.outline.map((o) => `<li>${esc(o)}</li>`).join('')}</ol></dd></div>
    <div><dt>핵심 근거</dt><dd>${factChips(t, a.keyFactIds) || '—'}</dd></div>
    <div><dt>약점</dt><dd>${esc(a.weakPoint)}</dd></div>
  </dl></section>`).join('') : '<p class="muted">합리적인 대립 입장이 확인되지 않아 별도 개요를 싣지 않았습니다.</p>'}`;
}

function tabLearn(t) {
  const L = t.learning;
  return `<h2 class="h2" style="margin-top:0">핵심 개념</h2><dl class="deflist">${L.concepts.map((c) => `<div><dt>${esc(c.term)}</dt><dd>${esc(c.explanation)}</dd></div>`).join('')}</dl>
  <h2 class="h2">이 문제에서 흔한 논리적 오류</h2><dl class="deflist">${L.commonErrors.map((c) => `<div><dt>${esc(c.name)}</dt><dd>${esc(c.howItAppears)}</dd></div>`).join('')}</dl>
  <h2 class="h2">다른 문제에도 쓸 수 있는 사고 방법</h2><ul class="list">${L.transferableMethods.map((m) => `<li>${esc(m)}</li>`).join('')}</ul>
  <h2 class="h2">더 생각해 볼 질문</h2><ul class="list">${L.furtherQuestions.map((m) => `<li>${esc(m)}</li>`).join('')}</ul>`;
}

const VERDICT_MARK = { supported: ['✓', 'pass'], partially_supported: ['△', 'na'], unsupported: ['✕', 'fail'], contradicted: ['✕', 'fail'], not_a_factual_claim: ['·', 'na'] };
function tabSources(t) {
  const r = t.review;
  const issues = Object.entries(r.issuesByType || {});
  return `<h2 class="h2" style="margin-top:0">검토 요약</h2>
  <p class="review-summary">${esc(r.summary)}</p>
  <div class="notice notice-quiet"><p><strong>검토 구성</strong> — ${esc(r.independence.label)}</p><p class="small">${esc(r.limits)}</p></div>
  <dl class="kv">
    <div><dt>검토 회차</dt><dd>${r.rounds}회 (수정 ${r.revisions.length}회)</dd></div>
    <div><dt>지적된 문제</dt><dd>${Object.entries(r.issuesFound || {}).map(([k, v]) => `${{ critical: '중대', major: '주요', minor: '경미' }[k] || k} ${v}`).join(' · ') || '없음'}</dd></div>
    <div><dt>독립 출처</dt><dd>${r.factsCheck?.independence ? `${r.factsCheck.independence.independentGroups}곳${r.factsCheck.independence.hasOfficial ? ' + 공식 자료' : ''}` : '—'}</dd></div>
  </dl>
  ${r.revisions.length ? `<h3 class="h3">실제 수정한 내용</h3><ul class="list">${r.revisions.flatMap((v) => v.changes.map((c) => `<li>${esc(c)}</li>`)).join('')}</ul>` : ''}
  ${issues.length ? `<h3 class="h3">검토 중 지적된 문제 유형</h3><p class="small">${issues.map(([k, v]) => `<span class="tag" style="margin:0 4px 4px 0">${esc(k)} ${v}</span>`).join('')}</p>` : ''}
  ${r.remainingMinor?.length ? `<h3 class="h3">남아 있는 경미한 문제</h3><ul class="list small">${r.remainingMinor.map((m) => `<li>${esc(m.type)}${m.paragraph ? ` (¶${m.paragraph})` : ''}: ${esc(m.note)}</li>`).join('')}</ul>` : ''}
  <h3 class="h3">남은 불확실성</h3><ul class="list">${(r.remainingUncertainties || []).map((u) => `<li>${esc(u)}</li>`).join('') || '<li>보고된 항목 없음</li>'}</ul>
  ${r.accessCaveat?.length ? `<h3 class="h3">원문 확인 범위</h3><ul class="list small">${r.accessCaveat.map((c) => `<li>${esc(c)}</li>`).join('')}</ul>` : ''}
  <h3 class="h3">논리 점검 항목</h3>
  <ul class="check">${r.checklist.map((c) => `<li><span class="mark mark-${c.verdict === 'pass' ? 'pass' : c.verdict === 'fail' ? 'fail' : 'na'}">${c.verdict === 'pass' ? '✓' : c.verdict === 'fail' ? '✕' : '–'}</span><span>${esc(c.label)}${c.note ? ` <span class="muted">— ${esc(c.note)}</span>` : ''}</span></li>`).join('')}</ul>
  <p class="small muted">최종 원고 기준 판정입니다. ✕ 항목은 이전 회차에서 지적되어 수정된 경우 위 '실제 수정한 내용'에 기록됩니다.</p>

  <h2 class="h2">주장과 출처의 연결</h2>
  <div class="table-wrap"><table class="table"><thead><tr><th>¶</th><th>답안의 진술</th><th>판정</th><th>근거</th></tr></thead><tbody>${t.claims.map((c) => { const [m, k] = VERDICT_MARK[c.verdict] || ['?', 'na']; return `<tr><td class="num">${c.paragraph}</td><td style="font-family:var(--serif)">${esc(c.quote)}${c.note ? `<br><span class="small muted">${esc(c.note)}</span>` : ''}</td><td><span class="mark mark-${k}">${m}</span> ${esc(c.verdictLabel)}</td><td>${factChips(t, c.factIds)} ${c.sourceIds.map((s) => `<a class="chip" href="#/topic/${encodeURIComponent(t.id)}/sources?f=src-${esc(s)}">${esc(s)}</a>`).join(' ')}</td></tr>`; }).join('')}</tbody></table></div>

  <h2 class="h2">출처</h2>
  <div class="table-wrap"><table class="table"><thead><tr><th>ID</th><th>제목 · 발행기관</th><th>게시</th><th>확인</th><th>확인 범위 · 독립성</th><th>뒷받침</th></tr></thead><tbody>${t.sources.map((s) => `<tr id="src-${esc(s.id)}"><td class="mono">${esc(s.id)}</td><td><a href="${safeUrl(s.url)}" rel="noopener noreferrer" target="_blank">${esc(s.title)}</a><br><span class="small muted">${esc(s.outlet)}</span></td><td class="mono small">${kst(s.publishedAt)}${s.pageModifiedAt ? `<br>수정 ${kst(s.pageModifiedAt)}` : ''}</td><td class="mono small">${kst(s.checkedAt)}</td><td class="small">${esc(s.accessLabel)}${s.independenceLabel ? `<br><span class="muted">${esc(s.independenceLabel)}</span>` : ''}</td><td>${factChips(t, s.supportsFacts)}</td></tr>`).join('')}</tbody></table></div>
  <p class="small muted">기사 전문은 저장하지 않으며 필요한 사실만 요약했습니다. 같은 원문을 옮긴 기사는 독립 근거로 세지 않습니다.</p>

  <h2 class="h2">정정 이력</h2>
  ${t.corrections?.length ? `<ul class="list">${t.corrections.map((c) => `<li><span class="mono small">v${c.version} · ${kst(c.at)}</span> ${esc(c.reason)}${c.answerChanged ? ` <span class="small muted">(답안 ${num(c.charsBefore)}자 → ${num(c.charsAfter)}자)</span>` : ''}</li>`).join('')}</ul>` : '<p class="muted">정정 이력이 없습니다. 정정이 생기면 이전 버전을 보관한 채 새 버전을 발행하고 여기에 기록합니다.</p>'}

  <details class="fold" style="margin-top:28px"><summary>생성·검토 기록</summary><div class="small">
    <p class="mono">모델: ${r.models.map(esc).join(', ')}</p>
    <p class="mono">프롬프트: ${r.promptVersions.map(esc).join(', ')}</p>
    <p class="mono">정책: ${esc(r.policyVersion)} · 호출 ${t.usage.calls}회 · 입력 ${num(t.usage.inputTokens)} / 출력 ${num(t.usage.outputTokens)} 토큰${t.usage.costUsd ? ` · 추정 $${t.usage.costUsd}` : ''}</p>
    <p class="mono">단계: ${r.stages.map(esc).join(' → ')}</p>
  </div></details>`;
}

function textCount(s) { const t = String(s || '').normalize('NFC'); return { withSpace: [...t.replace(/\r?\n/g, '')].length, noSpace: [...t.replace(/\s/g, '')].length }; }

function tabCompare(t) {
  const draft = store.get(`draft:${t.id}`, { text: '' });
  const mine = String(draft.text || '').split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const c = textCount(draft.text);
  return `<div class="compare-switch no-print"><button class="btn btn-quiet" data-show="mine" aria-pressed="true">내 답안</button><button class="btn btn-quiet" data-show="model" aria-pressed="false">모범답안</button></div>
  <div class="compare" data-show="mine">
    <section data-col="mine"><h2><span>내 답안</span><span class="mono">${num(c.withSpace)}자</span></h2><div class="col-text">${mine.map((p) => `<p>${esc(p)}</p>`).join('') || '<p class="muted">작성한 답안이 없습니다.</p>'}</div><p class="device-note">이 기기에 저장된 글 · ${esc(draft.savedAt || '')}</p></section>
    <section data-col="model"><h2><span>모범답안</span><span class="mono">${num(t.answer.chars)}자</span></h2><div class="col-text">${t.answer.paragraphs.map((p, i) => `<p><span class="mono small muted">¶${i + 1} ${esc(t.logic.paragraphs.find((x) => x.index === i + 1)?.role || '')}</span><br>${esc(p)}</p>`).join('')}</div></section>
  </div>
  <h2 class="h2">스스로 점검해 보기</h2>
  <ul class="list">${t.question.requirements.map((r) => `<li>요구사항 — ${esc(r.text)}: 내 답안의 어느 문단이 이 요구에 답하는가?</li>`).join('')}<li>내 답안의 반론은 상대 입장의 가장 강한 형태인가? (모범답안: ${esc(t.logic.strongestObjection)})</li><li>결론이 본론에서 입증한 범위를 넘지 않는가?</li></ul>`;
}

function bindTopic(t, tab) {
  $main.querySelector('[data-act="bookmark"]')?.addEventListener('click', (e) => {
    const b = store.get('bookmarks', {});
    if (b[t.id]) delete b[t.id]; else b[t.id] = { title: t.title, issueDate: t.issueDate, category: t.categoryLabel, savedAt: kst(kstNow().iso.replace('Z', '+09:00')) };
    store.set('bookmarks', b);
    e.currentTarget.setAttribute('aria-pressed', b[t.id] ? 'true' : 'false');
    e.currentTarget.textContent = b[t.id] ? '북마크됨' : '북마크';
  });
  $main.querySelector('[data-act="hide-pref"]')?.addEventListener('click', () => { store.set('pref:hideAnswers', !prefHide()); render(); });
  $main.querySelector('[data-act="reveal"]')?.addEventListener('click', () => { store.set(`revealed:${t.id}`, true); render(); });
  if (tab === 'question') bindWriter(t);
  if (tab === 'compare') {
    $main.querySelectorAll('[data-show]').forEach((b) => b.addEventListener('click', () => {
      if (!b.matches('button')) return;
      $main.querySelector('.compare').dataset.show = b.dataset.show;
      $main.querySelectorAll('button[data-show]').forEach((x) => x.setAttribute('aria-pressed', x === b ? 'true' : 'false'));
    }));
  }
}

function bindWriter(t) {
  const ta = document.getElementById('draft');
  const counter = document.getElementById('counter');
  const state = document.getElementById('save-state');
  const { minChars: min, maxChars: max } = t.question.length;
  const fill = document.getElementById('meter-fill');
  const band = document.getElementById('meter-band');
  const scale = max * 1.25;
  band.style.left = `${(min / scale) * 100}%`;
  band.style.width = `${((max - min) / scale) * 100}%`;
  const update = () => {
    const c = textCount(ta.value);
    const st = c.withSpace < min ? 'under' : c.withSpace > max ? 'over' : 'ok';
    const paras = ta.value.split(/\n\s*\n/).filter((p) => p.trim()).length;
    counter.innerHTML = `<span data-state="${st}">공백 포함 ${num(c.withSpace)}자 / 기준 ${num(min)}~${num(max)}자</span><span>공백 제외 ${num(c.noSpace)}자 · ${paras}문단</span>`;
    fill.style.width = `${Math.min(100, (c.withSpace / scale) * 100)}%`;
  };
  let timer = null;
  ta.addEventListener('input', () => {
    update();
    clearTimeout(timer);
    state.textContent = '저장 중…';
    timer = setTimeout(() => {
      const savedAt = kst(new Date(Date.now() + 9 * 3600e3).toISOString().replace('Z', '+09:00'));
      const ok = ta.value.trim() ? store.set(`draft:${t.id}`, { text: ta.value, savedAt, title: t.title, issueDate: t.issueDate }) : (store.del(`draft:${t.id}`), true);
      state.textContent = ok ? (ta.value.trim() ? `이 기기에 저장됨 · ${savedAt}` : '이 기기(브라우저)에만 저장됩니다') : '이 브라우저에서는 저장할 수 없습니다(사생활 보호 모드 등)';
    }, 600);
  });
  $main.querySelector('[data-act="clear-draft"]')?.addEventListener('click', () => {
    if (!ta.value.trim() || confirm('이 기기에 저장된 내 답안을 지울까요? 되돌릴 수 없습니다.')) { ta.value = ''; store.del(`draft:${t.id}`); update(); state.textContent = '지웠습니다'; }
  });
  document.getElementById('go-compare')?.addEventListener('click', (e) => {
    if (!ta.value.trim()) { e.preventDefault(); state.textContent = '먼저 답안을 작성해 주세요'; ta.focus(); }
    else store.set(`draft:${t.id}`, { ...store.get(`draft:${t.id}`, {}), text: ta.value, title: t.title, issueDate: t.issueDate });
  });
  update();
}

// ── 인쇄용 ──
async function viewPrint(id, mode) {
  await hydrateMast();
  const t = await getJSON(topicPath(id));
  if (!t) { $main.innerHTML = '<p>주제를 찾을 수 없습니다.</p>'; return; }
  setTitle(`${t.title} (인쇄)`);
  document.body.dataset.print = mode;
  const opt = (m, l) => `<a class="btn ${mode === m ? 'btn-solid' : 'btn-quiet'}" href="#/print/${encodeURIComponent(id)}?mode=${m}">${l}</a>`;
  $main.innerHTML = `<div class="btn-row no-print" style="margin-bottom:24px">${opt('question', '문제만')}${opt('answer', '문제 + 모범답안')}${opt('full', '전체(해설 포함)')}<button class="btn" data-act="print">인쇄하기</button><a class="btn btn-quiet" href="#/topic/${encodeURIComponent(id)}">돌아가기</a></div>
  <p class="kicker">${shortDate(t.issueDate)} · ${esc(t.categoryLabel)} · ${esc(t.question.typeLabel)}</p><h1 class="h1">${esc(t.title)}</h1>
  ${sheet(t)}
  ${mode === 'question' ? `<div class="print-only"><p class="small">답안 작성란 — 분량 ${num(t.question.length.minChars)}~${num(t.question.length.maxChars)}자</p></div>` : ''}
  ${mode !== 'question' ? `<section class="print-answer print-break"><h2 class="h2">모범답안 <span class="mono small muted">${num(t.answer.chars)}자</span></h2>${answerParas(t, { notes: false })}</section>` : ''}
  ${mode === 'full' ? `<section class="print-break"><h2 class="h2">논리 해설</h2>${tabLogic(t)}<h2 class="h2">학습 포인트</h2>${tabLearn(t)}</section>` : ''}
  <p class="small muted" style="margin-top:24px">출처: ${t.sources.map((s) => `${esc(s.outlet)} 「${esc(s.title)}」(${kst(s.publishedAt)})`).join('; ')}</p>`;
  $main.querySelector('[data-act="print"]').addEventListener('click', () => window.print());
}

// ── 지난 호 ──
async function viewArchive(month) {
  const { index } = await hydrateMast();
  setTitle('지난 호');
  const issues = index?.issues || [];
  const byDate = Object.fromEntries(issues.map((i) => [i.date, i]));
  const ref = month && /^\d{4}-\d{2}$/.test(month) ? month : (issues[0]?.date || kstNow().date).slice(0, 7);
  const [y, m] = ref.split('-').map(Number);
  const first = `${ref}-01`;
  const startDow = new Date(`${first}T00:00:00Z`).getUTCDay();
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const prev = new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 7);
  const next = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 7);
  const cells = [];
  for (let i = 0; i < startDow; i += 1) cells.push('<span></span>');
  for (let d = 1; d <= days; d += 1) {
    const date = `${ref}-${String(d).padStart(2, '0')}`;
    const it = byDate[date];
    if (!it) { cells.push(`<span class="cal-day">${d}</span>`); continue; }
    const dots = `${'<i></i>'.repeat(Math.min(it.count, 5))}${'<i class="held"></i>'.repeat(Math.min(it.held || 0, 3))}`;
    const flag = ['failed_collect', 'failed_generation', 'budget_deferred'].includes(it.state) ? '<span class="cal-flag" title="작업 실패"></span>' : '';
    cells.push(`<a class="cal-day" href="#/issue/${date}" title="${esc(it.stateLabel)} · ${it.count}편">${d}<span class="cal-dots">${dots}</span>${flag}</a>`);
  }
  const months = {};
  for (const i of issues) (months[i.date.slice(0, 7)] ||= []).push(i);
  const list = Object.entries(months).map(([mo, arr]) => `<h2 class="h3">${mo.replace('-', '년 ')}월</h2><ul class="day-list">${arr.map((i) => `<li><span class="d"><a href="#/issue/${i.date}">${shortDate(i.date)}</a><br><span class="muted">제${i.number}호</span></span><div>${i.topics.length ? `<ul>${i.topics.map((tp) => `<li><span class="cat" data-cat="${esc(tp.category)}">${esc(tp.categoryLabel)}</span><a href="#/topic/${encodeURIComponent(tp.id)}">${esc(tp.title)}</a></li>`).join('')}</ul>` : `<span class="muted small">${esc(i.stateLabel)}</span>`}</div></li>`).join('')}</ul>`).join('');
  $main.innerHTML = `<p class="kicker">아카이브</p><h1 class="h1">지난 호</h1>
  <div class="archive"><div class="cal"><div class="cal-head"><button aria-label="이전 달" onclick="location.hash='#/archive/${prev}'">‹</button><strong>${y}년 ${m}월</strong><button aria-label="다음 달" onclick="location.hash='#/archive/${next}'">›</button></div>
    <div class="cal-grid">${DOW.map((d) => `<span class="cal-dow">${d}</span>`).join('')}${cells.join('')}</div>
    <div class="cal-legend"><span><i style="width:6px;height:6px;border-radius:50%;background:var(--ink);display:inline-block"></i>발행 주제</span><span><i style="width:6px;height:6px;border-radius:50%;border:1px solid var(--ink-3);display:inline-block"></i>보류</span><span><i style="width:6px;height:6px;background:var(--red);display:inline-block"></i>작업 실패</span></div></div>
    <div>${list || '<p class="muted">발행 기록이 없습니다.</p>'}</div></div>`;
}

// ── 최근 7일 ──
async function viewWeek() {
  const { index } = await hydrateMast();
  setTitle('최근 7일');
  const end = index?.issues?.[0]?.date || kstNow().date;
  const dates = Array.from({ length: 7 }, (_, i) => addDays(end, -i));
  const issues = (await Promise.all(dates.map((d) => (index?.issues?.some((x) => x.date === d) ? getJSON(`issues/${d}.json`) : null)))).filter(Boolean);
  const all = issues.flatMap((i) => i.topics.map((t) => ({ ...t, issueDate: i.date })));
  const cats = {};
  for (const t of all) cats[t.categoryLabel] = (cats[t.categoryLabel] || 0) + 1;
  $main.innerHTML = `<p class="kicker">${shortDate(dates[6])} – ${shortDate(dates[0])}</p><h1 class="h1">최근 7일 모아보기</h1>
  <p class="lede">이미 발행한 주제를 날짜순으로 묶었습니다. 새로 생성한 글은 없습니다.</p>
  <p class="small muted">${all.length}편 · ${Object.entries(cats).map(([k, v]) => `${esc(k)} ${v}`).join(' · ') || '발행 없음'}</p>
  ${dates.map((d) => { const i = issues.find((x) => x.date === d); return `<h2 class="h3" style="border-top:1px solid var(--ink);padding-top:10px">${longDate(d)}${i ? ` · 제${i.number}호` : ''}</h2>${i?.topics?.length ? `<ol class="toc">${i.topics.map((t, n) => tocItem(t, n)).join('')}</ol>` : `<p class="muted small">${i ? esc(i.stateLabel) : '발행 기록 없음'}</p>`}`; }).join('')}`;
}

// ── 검색 ──
async function viewSearch(q) {
  const { index } = await hydrateMast();
  setTitle('검색');
  const items = (await getJSON('search.json')) || [];
  const query = q.get('q') || '';
  const cat = q.get('cat') || '';
  const cats = index?.categories || [];
  const norm = (s) => String(s).normalize('NFC').toLowerCase();
  const terms = norm(query).split(/\s+/).filter(Boolean);
  const hits = items.filter((it) => (!cat || it.category === cat) && terms.every((tm) => norm(`${it.title} ${it.headline} ${it.prompt} ${it.text}`).includes(tm)));
  const hl = (s) => { let out = esc(s); for (const tm of terms) out = out.replace(new RegExp(esc(tm).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), (m) => `<mark>${m}</mark>`); return out; };
  $main.innerHTML = `<p class="kicker">검색</p><h1 class="h1">주제 찾기</h1>
  <form class="search-bar" role="search" id="sform"><label class="visually-hidden" for="sq">검색어</label><input id="sq" name="q" type="search" value="${esc(query)}" placeholder="예: 최저임금, 판결, 기후" autocomplete="off" /><button class="btn btn-solid" type="submit">검색</button></form>
  <div class="filters" role="group" aria-label="분야">${[{ id: '', label: '전체' }, ...cats].map((c) => `<button type="button" data-cat="${esc(c.id)}" aria-pressed="${c.id === cat ? 'true' : 'false'}">${esc(c.label)}</button>`).join('')}</div>
  <p class="small muted">${query || cat ? `${hits.length}건` : `발행된 주제 ${items.length}건`}</p>
  <ul class="day-list">${(query || cat ? hits : items).slice(0, 100).map((it) => `<li><span class="d">${shortDate(it.date)}<br><span class="cat" data-cat="${esc(it.category)}">${esc(it.categoryLabel)}</span></span><div><a href="#/topic/${encodeURIComponent(it.id)}" style="font-family:var(--serif-display);font-weight:700;font-size:17px;text-decoration:none">${hl(it.title)}</a><p class="small muted" style="margin:4px 0 0;font-family:var(--serif)">${hl(it.prompt)}</p></div></li>`).join('')}</ul>`;
  const go = (nq, nc) => { const p = new URLSearchParams(); if (nq) p.set('q', nq); if (nc) p.set('cat', nc); location.hash = `#/search${p.toString() ? `?${p}` : ''}`; };
  document.getElementById('sform').addEventListener('submit', (e) => { e.preventDefault(); go(document.getElementById('sq').value.trim(), cat); });
  $main.querySelectorAll('.filters button').forEach((b) => b.addEventListener('click', () => go(query, b.dataset.cat)));
}

// ── 내 공부 ──
function viewMe() {
  setTitle('내 공부');
  hydrateMast();
  const bm = store.get('bookmarks', {});
  const drafts = store.keys('draft:').map((k) => ({ id: k.slice(6), ...store.get(k, {}) })).filter((d) => d.text);
  $main.innerHTML = `<p class="kicker">이 기기에 저장</p><h1 class="h1">내 공부</h1>
  <div class="notice notice-quiet"><p>북마크와 내 답안은 <strong>이 기기(브라우저)에만</strong> 저장됩니다. 서버로 보내지 않으며 다른 기기와 동기화되지 않습니다. 브라우저 데이터를 지우면 사라지므로 필요하면 아래에서 파일로 내려받으세요.</p></div>
  <h2 class="h2">내 답안 <span class="mono small muted">${drafts.length}</span></h2>
  ${drafts.length ? `<ul class="day-list">${drafts.map((d) => `<li><span class="d">${d.issueDate ? shortDate(d.issueDate) : ''}<br><span class="muted">${esc(d.savedAt || '')}</span></span><div><a href="#/topic/${encodeURIComponent(d.id)}/question" style="font-family:var(--serif-display);font-weight:700;font-size:17px;text-decoration:none">${esc(d.title || d.id)}</a><p class="small muted mono" style="margin:4px 0 0">${num(textCount(d.text).withSpace)}자 · <a href="#/topic/${encodeURIComponent(d.id)}/compare">모범답안과 비교</a></p></div></li>`).join('')}</ul>` : '<p class="muted">아직 작성한 답안이 없습니다. 주제의 문제 탭에서 직접 써 볼 수 있습니다.</p>'}
  <h2 class="h2">북마크 <span class="mono small muted">${Object.keys(bm).length}</span></h2>
  ${Object.keys(bm).length ? `<ul class="day-list">${Object.entries(bm).map(([id, b]) => `<li><span class="d">${b.issueDate ? shortDate(b.issueDate) : ''}<br><span class="muted">${esc(b.category || '')}</span></span><div><a href="#/topic/${encodeURIComponent(id)}" style="font-family:var(--serif-display);font-weight:700;font-size:17px;text-decoration:none">${esc(b.title)}</a></div></li>`).join('')}</ul>` : '<p class="muted">북마크한 주제가 없습니다.</p>'}
  <div class="btn-row" style="margin-top:28px"><button class="btn" data-act="export">내 데이터 내려받기(JSON)</button><button class="btn btn-quiet" data-act="wipe">이 기기의 내 데이터 모두 지우기</button></div>`;
  $main.querySelector('[data-act="export"]').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), bookmarks: bm, drafts }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `daily-essay-my-data-${kstNow().date}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });
  $main.querySelector('[data-act="wipe"]').addEventListener('click', () => {
    if (!confirm('이 기기에 저장된 북마크와 답안을 모두 지울까요? 되돌릴 수 없습니다.')) return;
    for (const k of [...store.keys('draft:'), ...store.keys('revealed:'), 'bookmarks']) store.del(k);
    viewMe();
  });
}

// ── 운영 현황 ──
async function viewStatus() {
  const { status } = await hydrateMast();
  setTitle('운영 현황');
  if (!status) { $main.innerHTML = `<p class="kicker">운영 현황</p><h1 class="h1">아직 실행 기록이 없습니다</h1><p class="lede">예약 작업이 한 번도 실행되지 않았습니다. 예약 등록 여부와 실제 성공 여부는 별개이며, 첫 실행 뒤 이곳에 기록됩니다.</p>`; return; }
  const s = todayState(status);
  const tone = STATE_TONE[s.state] || '';
  const setup = status.setupMissing?.length ? `<div class="notice"><p><strong>설정 필요</strong> — 다음 설정이 없어 자동 생성이 실행되지 않았습니다: ${status.setupMissing.map(esc).join(', ')}</p></div>` : '';
  $main.innerHTML = `${setup}<p class="kicker">운영 현황 · ${kst(status.generatedAt)} 기준</p>
  <h1 class="status-big" data-state="${tone}">${esc(s.stateLabel)}</h1>
  <p class="lede">${shortDate(s.date)} 호 — 발행 ${s.published}편, 보류 ${s.held}편${s.failedStage ? ` · 실패 단계: ${esc(s.failedStage)}` : ''}${status.paused ? ` · 예약 일시 중지됨(${esc(status.pausedReason || '')})` : ''}</p>
  <dl class="kv">
    <div><dt>마지막 정상 발행</dt><dd>${status.lastSuccessfulPublish ? `${shortDate(status.lastSuccessfulPublish.date)} · ${kst(status.lastSuccessfulPublish.publishedAt, { date: false })} · ${status.lastSuccessfulPublish.count}편` : '없음'}</dd></div>
    <div><dt>다음 예정 발행</dt><dd>${kst(status.nextScheduledPublish)}</dd></div>
    <div><dt>발행 일정</dt><dd>매일 ${esc(status.schedule.publishAtKst)} KST (주말·공휴일 포함)</dd></div>
    <div><dt>실행 중 작업</dt><dd>${status.lock ? `${esc(status.lock.purpose)} · ${kst(status.lock.since)}부터` : '없음'}</dd></div>
    <div><dt>예약 실행</dt><dd>${status.paused ? '일시 중지' : '동작 중'}</dd></div>
    <div><dt>정책 버전</dt><dd>${esc(status.policyVersion)}</dd></div>
  </dl>
  <h2 class="h2">최근 실행 기록</h2>
  <div class="table-wrap"><table class="table"><thead><tr><th>시작</th><th>종료</th><th>종류</th><th>대상 호</th><th>결과</th></tr></thead><tbody>${(status.recentRuns || []).map((r) => `<tr><td class="mono small">${kst(r.startedAt)}</td><td class="mono small">${kst(r.finishedAt)}</td><td class="small">${esc({ scheduled: '예약', manual: '수동', retry: '재시도', recover: '누락 복구' }[r.kind] || r.kind)}</td><td class="mono small">${esc(r.targetDate)}</td><td class="small">${esc(r.outcomeLabel || r.outcome)}${r.failedStep ? ` <span class="muted">@${esc(r.failedStep)}</span>` : ''}</td></tr>`).join('') || '<tr><td colspan="5" class="muted">기록 없음</td></tr>'}</tbody></table></div>
  <h2 class="h2">상태의 뜻</h2>
  <dl class="deflist">
    <div><dt>기준 통과 주제 없음</dt><dd>수집과 선별은 정상이었지만 논술 주제로 다룰 만한 새 사건이 없었던 날입니다.</dd></div>
    <div><dt>검토 통과 주제 없음</dt><dd>후보는 있었으나 사실 검증·논리 비판·최종 검토를 통과하지 못해 보류된 날입니다.</dd></div>
    <div><dt>수집 실패 · 생성 실패</dt><dd>작업 오류입니다. 이슈가 없는 날로 표시하지 않으며, 직전 정상 발행호를 유지하고 재시도합니다.</dd></div>
    <div><dt>발행 지연</dt><dd>발행 시각이 지났지만 검토가 끝나지 않은 상태입니다. 미완성 글은 정시에 맞추려고 발행하지 않습니다.</dd></div>
  </dl>`;
}

// ── 발행 원칙 ──
function viewAbout() {
  setTitle('발행 원칙');
  hydrateMast();
  $main.innerHTML = `<p class="kicker">발행 원칙과 검토 방식</p><h1 class="h1">어떻게 만들고, 무엇을 확인하나</h1>
  <div class="two-col"><div class="prose">
    <p>${esc(SITE.name)}은 매일 한국시간 오전 9시, 전날 00:00부터 당일 00:00 사이에 새로 일어났거나 중요한 변화가 있었던 사건 가운데 논술 주제로 다룰 가치가 있는 것을 골라 문제와 모범답안을 발행합니다. 늦게 보도된 사건을 놓치지 않도록 최근 72시간을 겹쳐 확인하고, 늦게 발견된 사건은 실제 발생일과 추가 수록 이유를 함께 적습니다.</p>
    <p>뉴스는 정부 정책브리핑, 통신사, 신문·방송사, 해외 언론의 공개 피드에서만 가져옵니다. 생성 모델의 기억으로 최신 뉴스를 만들지 않습니다.</p>
    <h2 class="h2">주제 선정</h2>
    <p>기사 수나 화제성보다 공공성과 파급력, 충돌하는 가치와 이해관계, 원인·제도·대안을 논증할 여지, 신뢰할 수 있는 근거, 다른 문제에도 적용할 수 있는 개념적 중요성, 최근 발행물과의 차이를 봅니다. 기준을 통과한 주제가 적으면 적게 발행합니다.</p>
    <p>같은 사건은 하나의 이슈 묶음으로 관리합니다. 정책 단계 변화, 새 판결·통계, 이해관계를 바꾸는 행동, 전제를 바꾸는 새 사실, 새로운 가치 충돌이 있을 때만 후속 문제를 내고, 그렇지 않은 변화는 후속 소식으로만 연결합니다.</p>
    <h2 class="h2">여덟 단계 검토</h2>
    <p>① 자료 수집과 사실 정리 ② 문제·평가 기준 작성 ③ 논증 설계 ④ 답안 초안 ⑤ 사실 검증 ⑥ 논리 비판 ⑦ 수정 ⑧ 최종 검토와 발행 판단. 각 단계는 별도 호출·별도 역할로 수행하고, 검토자는 작성자의 자기평가를 근거로 삼지 않습니다.</p>
    <p>분량, 사실표에 없는 수치·인용, 요구사항 대응, 최근 문제와의 중복처럼 코드로 확인할 수 있는 항목은 코드로 검사합니다. 중대한 사실 오류, 주요 근거 부재, 핵심 논리 모순, 발문 미충족이 남으면 점수와 관계없이 발행하지 않습니다. 정해진 수정 횟수 안에 해결되지 않은 글은 보류합니다.</p>
    <h2 class="h2">정직하게 밝히는 한계</h2>
    <p>검토는 제공된 출처 범위 안에서 이루어집니다. 출처 자체의 오류나 원문을 볼 수 없는 자료는 확인 범위를 따로 표시합니다. 같은 모델이 쓰고 검토하는 경우 독립 검증이 아니라 '같은 모델의 별도 호출'이라고 표시합니다. 검토를 거쳤다는 사실이 오류가 없다는 보증은 아닙니다.</p>
    <p>발행 후 사실관계가 틀린 것으로 밝혀지면 이전 버전을 보관한 채 새 버전을 내고 정정 이력을 남깁니다. 과거 답안을 몰래 덮어쓰지 않습니다.</p>
  </div>
  <aside class="aside"><div class="aside-block"><h3>저장되는 것</h3><ul><li>발행된 문제·답안·해설·출처 메타데이터</li><li>검토 요약과 정정 이력</li></ul></div><div class="aside-block"><h3>저장하지 않는 것</h3><ul><li>기사 전문</li><li>내 답안·북마크(이 기기에만 저장)</li></ul></div><div class="aside-block"><h3>공개하지 않는 것</h3><ul><li>미발행 초안과 내부 검토 원문(암호화 보관)</li></ul></div></aside></div>`;
}

window.addEventListener('hashchange', () => { delete document.body.dataset.print; render(); });
render();
