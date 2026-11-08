// 운영 진단 요약. 내부 기록(암호화)을 읽어 공개해도 되는 수준의 숫자·사유만 뽑는다.
// 초안·검토 원문·기사 본문은 출력하지 않는다. Actions 로그에 남겨 원인을 파악하는 용도.
import { readInternal } from '../lib/store.js';
import { truncate } from '../lib/text.js';

function hostOf(u) {
  try { return new URL(u).hostname; } catch { return '?'; }
}

export function diagnoseIssue(date) {
  const issue = readInternal(`issues/${date}.json`);
  if (!issue) return [`[진단] ${date}: 발행호 기록 없음`];
  const lines = [];
  const c = issue.steps?.collect;
  lines.push(`[진단] ${date} 상태=${issue.state} 정보기준=${issue.infoCutoff}`);
  if (c) {
    const bad = (c.health || []).filter((h) => !h.ok).map((h) => `${h.sourceId}(${truncate(h.error || '', 50)})`);
    lines.push(`[진단] 수집: 수집원 ${c.sourcesOk}/${c.sourcesTotal} 응답, 기사 ${c.articles}건, 시각 없음 ${c.undated}, 제외 ${c.excluded}`);
    if (bad.length) lines.push(`[진단] 응답 실패 수집원: ${bad.join(', ')}`);
  }
  if (issue.steps?.select) lines.push(`[진단] 선정: 후보 ${issue.steps.select.counts.candidates}, 선정 ${issue.steps.select.counts.selected}, 예비 ${issue.steps.select.counts.standby}`);
  for (const id of issue.topicIds || []) {
    const t = readInternal(`topics/${id}.json`);
    if (!t) continue;
    const pack = t.sourcePack || [];
    const access = pack.reduce((a, s) => { a[s.accessLevel] = (a[s.accessLevel] || 0) + 1; return a; }, {});
    const byType = pack.reduce((a, s) => { a[s.sourceType] = (a[s.sourceType] || 0) + 1; return a; }, {});
    const errs = pack.filter((s) => s.fetchError).map((s) => `${hostOf(s.url)}: ${truncate(s.fetchError, 70)}`);
    const shortBodies = pack.filter((s) => !s.fetchError && s.sourceType !== 'aggregator').map((s) => `${hostOf(s.url)}=${s.bodyChars ?? 0}자`);
    lines.push(`[진단] 주제 ${id} (${t.role}) 상태=${t.status} 단계=${t.currentStage || '-'} | ${truncate(t.selection?.eventSummary || '', 60)}`);
    lines.push(`         출처 ${pack.length}건 유형=${JSON.stringify(byType)} 확인범위=${JSON.stringify(access)}`);
    if (t.factsCheck) lines.push(`         독립성=${JSON.stringify(t.factsCheck.independence)} 사실표 문제 ${t.factsCheck.problems.length}건`);
    if (t.stages?.facts?.output?.suitability) lines.push(`         자료 충분 판단=${t.stages.facts.output.suitability.enoughEvidence} (${truncate(t.stages.facts.output.suitability.reason, 90)})`);
    if (shortBodies.length) lines.push(`         본문 길이: ${shortBodies.join(', ')}`);
    if (errs.length) lines.push(`         조회 오류: ${errs.slice(0, 5).join(' / ')}`);
    if (t.holdReasons?.length) lines.push(`         보류 사유: ${t.holdReasons.slice(0, 4).map((r) => truncate(r, 120)).join(' / ')}`);
    if (t.error) lines.push(`         오류: ${t.error.stage}: ${truncate(t.error.message, 160)}`);
    const models = [...new Set((t.calls || []).map((x) => x.servedModel))];
    if (models.length) lines.push(`         사용 모델: ${models.join(', ')} / 호출 ${t.calls.length}회`);
  }
  return lines;
}
