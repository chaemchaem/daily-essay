// 실행 로그. 콘솔에 남기되 비밀값처럼 보이는 문자열은 가린다.
const SECRET_RE = /(sk-[A-Za-z0-9_-]{8,}|sk-ant-[A-Za-z0-9_-]{8,}|Bearer\s+[A-Za-z0-9._-]{8,}|x-api-key[^,\n]*)/g;
export function redact(s) {
  return String(s).replace(SECRET_RE, '[REDACTED]');
}
export function log(...args) {
  console.log(redact(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')));
}
export function warn(...args) {
  console.warn(redact(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')));
}
export function errorSummary(err) {
  if (!err) return null;
  return redact(`${err.name || 'Error'}: ${err.message || String(err)}`).slice(0, 800);
}
