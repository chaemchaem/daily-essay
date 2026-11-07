import test from 'node:test';
import assert from 'node:assert/strict';
import { validateUrl, isPrivateIp, hostAllowed } from '../src/lib/safe-fetch.js';

test('사설·루프백·메타데이터 주소 차단', () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1']) assert.equal(isPrivateIp(ip), true, ip);
  for (const ip of ['8.8.8.8', '1.1.1.1', '2606:4700::1111']) assert.equal(isPrivateIp(ip), false, ip);
});

test('URL 검증: 스킴·계정정보·포트·내부 호스트', () => {
  assert.throws(() => validateUrl('file:///etc/passwd'), /스킴/);
  assert.throws(() => validateUrl('http://user:pw@example.com/'), /계정정보/);
  assert.throws(() => validateUrl('http://example.com:8080/'), /포트/);
  assert.throws(() => validateUrl('http://localhost/'), /내부/);
  assert.throws(() => validateUrl('http://169.254.169.254/latest/meta-data'), /사설/);
  assert.throws(() => validateUrl('http://[::1]/'), /사설/);
  assert.ok(validateUrl('https://www.yna.co.kr/rss/news.xml'));
});

test('허용 호스트 목록(하위 도메인 포함)', () => {
  const allow = ['www.yna.co.kr', 'rss.donga.com'];
  assert.equal(hostAllowed('www.yna.co.kr', allow), true);
  assert.equal(hostAllowed('m.yna.co.kr', allow), true);
  assert.equal(hostAllowed('www.donga.com', allow), true);
  assert.equal(hostAllowed('evil-yna.co.kr', allow), false);
  assert.throws(() => validateUrl('https://attacker.example/', { allowHosts: allow }), /허용 목록/);
});
