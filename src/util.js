// 공통 도구: 오류, 응답, 날짜, 입력 검사

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export const nowIso = () => new Date().toISOString();

// 서울(UTC+9, 일광절약 없음) 기준 오늘 날짜
export function seoulToday() {
  return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

const BASE_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
};

export function json(data, status = 200, extra = {}) {
  const headers = new Headers(BASE_HEADERS);
  for (const [k, v] of Object.entries(extra)) {
    if (Array.isArray(v)) v.forEach((x) => headers.append(k, x));
    else headers.set(k, v);
  }
  return new Response(JSON.stringify(data), { status, headers });
}

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function text(v, name, { required = false, max = 2000 } = {}) {
  if (v === undefined || v === null) v = '';
  if (typeof v !== 'string') throw new HttpError(400, `${name}은(는) 글자여야 합니다.`);
  v = v.trim();
  if (required && !v) throw new HttpError(400, `${name}을(를) 적어 주세요.`);
  if (v.length > max) throw new HttpError(400, `${name}은(는) ${max}자 이하로 적어 주세요.`);
  return v;
}

export function date(v, name, { required = false } = {}) {
  if (v === undefined || v === null || v === '') {
    if (required) throw new HttpError(400, `${name}을(를) 골라 주세요.`);
    return null;
  }
  if (typeof v !== 'string' || !DATE_RE.test(v) || isNaN(Date.parse(v + 'T00:00:00Z'))) {
    throw new HttpError(400, `${name}은(는) YYYY-MM-DD 형식이어야 합니다.`);
  }
  return v;
}

export function instant(v, name) {
  if (typeof v !== 'string' || isNaN(Date.parse(v))) {
    throw new HttpError(400, `${name}이(가) 올바른 시각이 아닙니다.`);
  }
  return new Date(v).toISOString();
}

export function minutes(v, name, { required = false } = {}) {
  if (v === undefined || v === null || v === '') {
    if (required) throw new HttpError(400, `${name}을(를) 적어 주세요.`);
    return null;
  }
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0 || n > 100000) {
    throw new HttpError(400, `${name}은(는) 0 이상의 정수(분)여야 합니다.`);
  }
  return n;
}

export function priority(v) {
  const n = Number(v);
  if (![1, 2, 3].includes(n)) throw new HttpError(400, '우선순위는 높음·보통·낮음 중 하나여야 합니다.');
  return n;
}

export function tags(v) {
  if (v === undefined || v === null) return [];
  const list = Array.isArray(v) ? v : String(v).split(',');
  const out = [...new Set(list.map((t) => String(t).trim()).filter(Boolean))];
  if (out.length > 10) throw new HttpError(400, '태그는 10개까지 넣을 수 있습니다.');
  for (const t of out) if (t.length > 30) throw new HttpError(400, '태그 하나는 30자 이하로 적어 주세요.');
  return out;
}

export function id(v) {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new HttpError(404, '찾을 수 없습니다.');
  return n;
}

export async function body(request) {
  const raw = await request.text();
  if (raw.length > 20000) throw new HttpError(413, '보낸 내용이 너무 깁니다.');
  try {
    const out = raw ? JSON.parse(raw) : {};
    if (out === null || typeof out !== 'object' || Array.isArray(out)) throw new Error('not object');
    return out;
  } catch {
    throw new HttpError(400, 'JSON 객체 형식이 아닙니다.');
  }
}

export const likeEscape = (s) => s.replace(/[\\%_]/g, (c) => '\\' + c);
