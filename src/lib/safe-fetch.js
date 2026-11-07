// 외부 페이지 조회 전용 HTTP 클라이언트.
// - http/https만 허용, URL 내 계정정보 금지, 표준 포트(80/443)만 허용
// - DNS 조회 결과를 연결 직전에 검사해 사설·루프백·링크로컬·메타데이터 주소 접근 차단(DNS 리바인딩 대응)
// - 리디렉션은 자동으로 따르지 않고 hop마다 같은 검증을 다시 수행(최대 5회)
// - 응답 크기·전체 시간 제한, gzip/deflate/br 해제
import http from 'node:http';
import https from 'node:https';
import dns from 'node:dns';
import net from 'node:net';
import zlib from 'node:zlib';

export class FetchBlockedError extends Error {
  constructor(message, code) { super(message); this.code = code; }
}

const USER_AGENT = 'NonjeomBot/0.1 (+news-essay study service; respects robots meta noarchive)';

export function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return (
      a === 0 || a === 10 || a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    );
  }
  if (net.isIPv6(ip)) {
    const v = ip.toLowerCase();
    if (v === '::' || v === '::1') return true;
    const mapped = v.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateIp(mapped[1]);
    return /^(fc|fd|fe8|fe9|fea|feb|ff)/.test(v) || v.startsWith('64:ff9b:') || v.startsWith('2001:db8');
  }
  return true;
}

export function validateUrl(raw, { allowHosts } = {}) {
  let u;
  try { u = new URL(raw); } catch { throw new FetchBlockedError(`URL 형식 오류: ${raw}`, 'bad_url'); }
  if (!['http:', 'https:'].includes(u.protocol)) throw new FetchBlockedError(`허용되지 않은 스킴: ${u.protocol}`, 'bad_scheme');
  if (u.username || u.password) throw new FetchBlockedError('URL에 계정정보 포함', 'credentials');
  if (u.port && !['80', '443'].includes(u.port)) throw new FetchBlockedError(`허용되지 않은 포트: ${u.port}`, 'bad_port');
  const host = u.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal') || host.endsWith('.local')) {
    throw new FetchBlockedError(`내부 호스트 차단: ${host}`, 'internal_host');
  }
  if (net.isIP(host) && isPrivateIp(host)) throw new FetchBlockedError(`사설 IP 차단: ${host}`, 'private_ip');
  if (allowHosts && allowHosts.length && !hostAllowed(host, allowHosts)) {
    throw new FetchBlockedError(`허용 목록 밖 호스트: ${host}`, 'host_not_allowed');
  }
  return u;
}

export function baseDomain(host) {
  return host.toLowerCase().replace(/^(www|rss|feeds|news|m|mobile)\./, '');
}

export function hostAllowed(host, allowHosts) {
  const h = host.toLowerCase();
  return allowHosts.some((a) => {
    const b = baseDomain(a);
    return h === a.toLowerCase() || h === b || h.endsWith(`.${b}`);
  });
}

function guardedLookup(hostname, options, callback) {
  dns.lookup(hostname, { all: true, verbatim: true }, (err, addresses) => {
    if (err) return callback(err);
    const bad = addresses.find((a) => isPrivateIp(a.address));
    if (bad) return callback(new FetchBlockedError(`사설 주소로 해석됨: ${hostname} → ${bad.address}`, 'private_ip'));
    if (options && options.all) return callback(null, addresses);
    return callback(null, addresses[0].address, addresses[0].family);
  });
}

function requestOnce(url, { timeoutMs, maxBytes, headers }) {
  return new Promise((resolve, reject) => {
    const mod = url.protocol === 'https:' ? https : http;
    const req = mod.request(url, {
      method: 'GET',
      lookup: guardedLookup,
      headers: { 'user-agent': USER_AGENT, accept: 'text/html,application/xhtml+xml,application/rss+xml,application/xml;q=0.9,*/*;q=0.5', 'accept-encoding': 'gzip, deflate, br', 'accept-language': 'ko,en;q=0.8', ...headers },
      timeout: timeoutMs,
    }, (res) => {
      const status = res.statusCode || 0;
      if (status >= 300 && status < 400 && res.headers.location) {
        res.resume();
        resolve({ redirect: res.headers.location, status });
        return;
      }
      const declared = Number(res.headers['content-length'] || 0);
      if (declared && declared > maxBytes) { res.destroy(); reject(new FetchBlockedError(`응답이 너무 큼(${declared}B)`, 'too_large')); return; }
      let stream = res;
      const enc = String(res.headers['content-encoding'] || '').toLowerCase();
      if (enc === 'gzip') stream = res.pipe(zlib.createGunzip());
      else if (enc === 'deflate') stream = res.pipe(zlib.createInflate());
      else if (enc === 'br') stream = res.pipe(zlib.createBrotliDecompress());
      const chunks = [];
      let size = 0;
      stream.on('data', (c) => {
        size += c.length;
        if (size > maxBytes) { req.destroy(); stream.destroy(); reject(new FetchBlockedError(`응답 크기 제한(${maxBytes}B) 초과`, 'too_large')); return; }
        chunks.push(c);
      });
      stream.on('end', () => resolve({ status, headers: res.headers, body: Buffer.concat(chunks) }));
      stream.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new FetchBlockedError(`시간 초과(${timeoutMs}ms)`, 'timeout')));
    req.on('error', reject);
    req.end();
  });
}

function decodeBody(buf, headers) {
  const ct = String(headers['content-type'] || '');
  let charset = (ct.match(/charset=([\w-]+)/i) || [])[1];
  if (!charset) {
    const head = buf.subarray(0, 2048).toString('latin1');
    charset = (head.match(/<meta[^>]+charset=["']?([\w-]+)/i) || head.match(/encoding=["']([\w-]+)["']/i) || [])[1];
  }
  charset = (charset || 'utf-8').toLowerCase();
  if (charset === 'ks_c_5601-1987' || charset === 'euc-kr' || charset === 'cp949') charset = 'euc-kr';
  try { return new TextDecoder(charset).decode(buf); } catch { return new TextDecoder('utf-8').decode(buf); }
}

/**
 * @returns {Promise<{url:string, finalUrl:string, status:number, contentType:string, text:string, redirects:string[]}>}
 */
export async function safeFetch(rawUrl, { timeoutMs = 10000, maxBytes = 2_500_000, maxRedirects = 5, allowHosts, headers } = {}) {
  const started = Date.now();
  let url = validateUrl(rawUrl, { allowHosts });
  const redirects = [];
  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    const remaining = timeoutMs - (Date.now() - started);
    if (remaining <= 0) throw new FetchBlockedError('전체 시간 초과', 'timeout');
    const res = await requestOnce(url, { timeoutMs: remaining, maxBytes, headers });
    if (res.redirect) {
      const next = new URL(res.redirect, url).toString();
      redirects.push(next);
      url = validateUrl(next, { allowHosts });
      continue;
    }
    return { url: rawUrl, finalUrl: url.toString(), status: res.status, contentType: String(res.headers['content-type'] || ''), text: decodeBody(res.body, res.headers), redirects };
  }
  throw new FetchBlockedError(`리디렉션 ${maxRedirects}회 초과`, 'too_many_redirects');
}
