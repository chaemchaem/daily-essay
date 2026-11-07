import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function tempDataDir() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'nj-test-'));
  process.env.NJ_DATA_DIR = d;
  process.env.NJ_TEST_DATA = '1';
  process.env.NJ_LLM_PROVIDER_OVERRIDE = 'mock';
  delete process.env.NJ_INTERNAL_KEY;
  return d;
}
