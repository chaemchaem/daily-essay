// 견본(테스트) 사이트 데이터 생성: 실제 파이프라인 코드를 가상 피드 + LLM 대역으로 실행한다.
// 결과는 data/fixtures/ 아래에만 쓰이며 모든 항목에 test=true가 붙는다. 화면에서는 ?data=fixtures 로 볼 수 있다.
import fs from 'node:fs';
import path from 'node:path';
import { PKG_ROOT } from '../lib/paths.js';

export async function buildFixtureSite({ dir = path.join(PKG_ROOT, 'data', 'fixtures'), quiet = false } = {}) {
  for (const sub of ['public', 'internal-local', 'state', 'tmp']) fs.rmSync(path.join(dir, sub), { recursive: true, force: true });
  process.env.NJ_DATA_DIR = dir;
  process.env.NJ_TEST_DATA = '1';
  process.env.NJ_LLM_PROVIDER_OVERRIDE = 'mock';
  process.env.NJ_MOCK_DEBATE = '1';
  delete process.env.NJ_INTERNAL_KEY;
  const { setMockHandler } = await import('../llm/index.js');
  const { mockHandler } = await import('./mock-llm.js');
  const { makeFeedFetcher, fixtureArticleFetcher } = await import('./fixture-feeds.js');
  const { runDaily, runPublish } = await import('../pipeline/daily.js');
  setMockHandler(mockHandler);
  const out = [];
  process.env.NJ_FAKE_NOW = '2026-11-08T06:10:00+09:00';
  out.push(await runDaily({ date: '2026-11-08', kind: 'scheduled', trigger: 'fixture', fetcher: makeFeedFetcher(1), articleFetcher: fixtureArticleFetcher }));
  process.env.NJ_FAKE_NOW = '2026-11-08T09:00:20+09:00';
  out.push(await runPublish({ date: '2026-11-08' }));
  process.env.NJ_FAKE_NOW = '2026-11-09T06:10:00+09:00';
  out.push(await runDaily({ date: '2026-11-09', kind: 'scheduled', trigger: 'fixture', fetcher: makeFeedFetcher(2), articleFetcher: fixtureArticleFetcher }));
  process.env.NJ_FAKE_NOW = '2026-11-09T09:00:20+09:00';
  out.push(await runPublish({ date: '2026-11-09' }));
  delete process.env.NJ_FAKE_NOW;
  if (!quiet) console.log(JSON.stringify(out.map((r) => r.outcome || r.state || r.reason), null, 1));
  return out;
}
