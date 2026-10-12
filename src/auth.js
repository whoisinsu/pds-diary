// 인증: 가입·로그인·로그아웃·비밀번호 변경·계정 삭제, 세션 확인
//
// 비밀번호  PBKDF2-SHA256(Web Crypto, Workers 내장) · 계정마다 16바이트 무작위 소금값 · 100,000회
//          (Workers의 PBKDF2 반복 횟수 상한이 100,000이다)
// 세션      무작위 32바이트 값을 쿠키(__Host-pds_session, HttpOnly·Secure·SameSite=Lax)로 준다.
//          DB에는 그 값의 SHA-256만 둔다. 서명용 비밀키는 쓰지 않는다.
// 만료      로그인 뒤 7일. 로그아웃·비밀번호 변경·계정 삭제 때 서버에서 행을 지운다.

import { HttpError, json, nowIso, text, body } from './util.js';

const ITERATIONS = 100000;
const SESSION_DAYS = 7;
export const COOKIE = '__Host-pds_session';
const USERNAME_RE = /^[a-z0-9_]{3,20}$/;
const LOGIN_FAIL = '아이디 또는 비밀번호가 올바르지 않습니다.'; // 아이디가 없을 때와 비밀번호가 틀릴 때 같은 문구

const enc = new TextEncoder();
const b64 = (u8) => btoa(String.fromCharCode(...u8));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const b64url = (u8) => b64(u8).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

async function pbkdf2(password, salt, iterations) {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256);
  return new Uint8Array(bits);
}

export async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const out = await pbkdf2(password, salt, ITERATIONS);
  return `pbkdf2_sha256$${ITERATIONS}$${b64(salt)}$${b64(out)}`;
}

function sameBytes(a, b) {
  if (a.length !== b.length) return false;
  if (crypto.subtle.timingSafeEqual) return crypto.subtle.timingSafeEqual(a, b);
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i];
  return d === 0;
}

export async function verifyPassword(password, stored) {
  const [algo, iter, salt, hash] = String(stored).split('$');
  if (algo !== 'pbkdf2_sha256') return false;
  const out = await pbkdf2(password, unb64(salt), Number(iter));
  return sameBytes(out, unb64(hash));
}

// 아이디가 없을 때도 같은 계산을 한 번 해서, 응답 시간으로 아이디 존재 여부가 드러나지 않게 한다.
const DUMMY_HASH = `pbkdf2_sha256$${ITERATIONS}$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=`;

async function sha256hex(s) {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(s)));
  return [...d].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function readCookie(request) {
  const raw = request.headers.get('cookie') || '';
  for (const part of raw.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === COOKIE) return v.join('=');
  }
  return null;
}

function setCookie(token, maxAge) {
  return `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}
const clearCookie = () => `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;

async function createSession(db, userId) {
  const token = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const now = new Date();
  const expires = new Date(now.getTime() + SESSION_DAYS * 86400e3);
  await db
    .prepare('INSERT INTO sessions (user_id, token_hash, created_at, expires_at) VALUES (?, ?, ?, ?)')
    .bind(userId, await sha256hex(token), now.toISOString(), expires.toISOString())
    .run();
  return { cookie: setCookie(token, SESSION_DAYS * 86400), expires_at: expires.toISOString() };
}

// 요청의 쿠키로 사용자를 찾는다. 없거나 만료·폐기된 값이면 null.
export async function currentUser(db, request) {
  const token = readCookie(request);
  if (!token || token.length > 100) return null;
  const row = await db
    .prepare(
      `SELECT s.id AS session_id, s.expires_at, u.id, u.username
       FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?`
    )
    .bind(await sha256hex(token))
    .first();
  if (!row) return null;
  if (row.expires_at <= nowIso()) {
    await db.prepare('DELETE FROM sessions WHERE id = ?').bind(row.session_id).run();
    return null;
  }
  return { id: row.id, username: row.username, session_id: row.session_id, expires_at: row.expires_at };
}

export function requireUser(user) {
  if (!user) throw new HttpError(401, '로그인이 필요합니다.');
  return user;
}

function readCredentials(b) {
  const username = text(b.username, '아이디', { required: true, max: 20 }).toLowerCase();
  if (!USERNAME_RE.test(username)) throw new HttpError(400, '아이디는 영문 소문자·숫자·밑줄(_)로 3~20자입니다.');
  if (typeof b.password !== 'string') throw new HttpError(400, '비밀번호를 적어 주세요.');
  return { username, password: b.password };
}

function checkNewPassword(pw, username) {
  if (typeof pw !== 'string' || pw.length < 10) throw new HttpError(400, '비밀번호는 10자 이상이어야 합니다.');
  if (pw.length > 128) throw new HttpError(400, '비밀번호는 128자 이하여야 합니다.');
  if (username && pw.toLowerCase().includes(username)) throw new HttpError(400, '비밀번호에 아이디를 넣지 마세요.');
}

export async function signup(db, request) {
  const { username, password } = readCredentials(await body(request));
  checkNewPassword(password, username);
  const exists = await db.prepare('SELECT 1 FROM users WHERE username = ?').bind(username).first();
  if (exists) throw new HttpError(409, '이미 쓰는 아이디입니다. 다른 아이디를 골라 주세요.');
  const now = nowIso();
  let user;
  try {
    user = await db
      .prepare('INSERT INTO users (username, password_hash, password_changed_at, created_at) VALUES (?, ?, ?, ?) RETURNING id, username')
      .bind(username, await hashPassword(password), now, now)
      .first();
  } catch (e) {
    // 동시에 같은 아이디로 가입한 경우: UNIQUE 제약이 두 번째를 막는다.
    if (String(e && e.message).includes('UNIQUE')) throw new HttpError(409, '이미 쓰는 아이디입니다. 다른 아이디를 골라 주세요.');
    throw e;
  }
  const s = await createSession(db, user.id);
  return json({ user, expires_at: s.expires_at }, 201, { 'set-cookie': s.cookie });
}

export async function login(db, request) {
  const { username, password } = readCredentials(await body(request));
  const user = await db.prepare('SELECT id, username, password_hash FROM users WHERE username = ?').bind(username).first();
  const ok = await verifyPassword(password, user ? user.password_hash : DUMMY_HASH);
  if (!user || !ok) throw new HttpError(401, LOGIN_FAIL);
  const s = await createSession(db, user.id);
  return json({ user: { id: user.id, username: user.username }, expires_at: s.expires_at }, 200, { 'set-cookie': s.cookie });
}

export async function logout(db, user) {
  if (user) await db.prepare('DELETE FROM sessions WHERE id = ?').bind(user.session_id).run();
  return json({ ok: true }, 200, { 'set-cookie': clearCookie() });
}

export async function changePassword(db, user, request) {
  const b = await body(request);
  const row = await db.prepare('SELECT password_hash FROM users WHERE id = ?').bind(user.id).first();
  if (typeof b.current_password !== 'string' || !(await verifyPassword(b.current_password, row.password_hash))) {
    throw new HttpError(403, '지금 비밀번호가 올바르지 않습니다.');
  }
  checkNewPassword(b.new_password, user.username);
  const now = nowIso();
  // 비밀번호를 바꾸면 이 계정의 모든 세션을 끊고, 지금 브라우저에만 새 세션을 준다.
  await db.batch([
    db.prepare('UPDATE users SET password_hash = ?, password_changed_at = ? WHERE id = ?').bind(await hashPassword(b.new_password), now, user.id),
    db.prepare('DELETE FROM sessions WHERE user_id = ?').bind(user.id),
  ]);
  const s = await createSession(db, user.id);
  return json({ ok: true, expires_at: s.expires_at }, 200, { 'set-cookie': s.cookie });
}

// 계정 삭제: 이 계정의 모든 자료를 한 트랜잭션으로 지운다.
export async function deleteAccount(db, user, request) {
  const b = await body(request);
  const row = await db.prepare('SELECT password_hash FROM users WHERE id = ?').bind(user.id).first();
  if (typeof b.password !== 'string' || !(await verifyPassword(b.password, row.password_hash))) {
    throw new HttpError(403, '비밀번호가 올바르지 않습니다.');
  }
  const u = user.id;
  const myTasks = 'SELECT t.id FROM tasks t JOIN plans p ON p.id = t.plan_id WHERE p.user_id = ?';
  const myExp = 'SELECT id FROM experiments WHERE user_id = ?';
  await db.batch([
    db.prepare(`DELETE FROM task_tags WHERE task_id IN (${myTasks})`).bind(u),
    db.prepare(`DELETE FROM completions WHERE task_id IN (${myTasks})`).bind(u),
    db.prepare(`DELETE FROM executions WHERE task_id IN (${myTasks})`).bind(u),
    db.prepare('DELETE FROM tasks WHERE plan_id IN (SELECT id FROM plans WHERE user_id = ?)').bind(u),
    db.prepare('DELETE FROM plan_revisions WHERE plan_id IN (SELECT id FROM plans WHERE user_id = ?)').bind(u),
    db.prepare('UPDATE plans SET carried_from_review_id = NULL WHERE user_id = ?').bind(u),
    db.prepare('DELETE FROM reviews WHERE plan_id IN (SELECT id FROM plans WHERE user_id = ?)').bind(u),
    db.prepare('DELETE FROM plans WHERE user_id = ?').bind(u),
    db.prepare(`DELETE FROM rule_changes WHERE experiment_id IN (${myExp})`).bind(u),
    db.prepare(`DELETE FROM daily_logs WHERE experiment_id IN (${myExp})`).bind(u),
    db.prepare('DELETE FROM experiments WHERE user_id = ?').bind(u),
    db.prepare('DELETE FROM sessions WHERE user_id = ?').bind(u),
    db.prepare('DELETE FROM users WHERE id = ?').bind(u),
  ]);
  return json({ ok: true, deleted: true }, 200, { 'set-cookie': clearCookie() });
}
