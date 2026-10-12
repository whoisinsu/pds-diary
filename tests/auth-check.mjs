// 7번 인증 점검 + 증거 기록 만들기
//   로컬:  BASE=http://127.0.0.1:8787 node tests/auth-check.mjs            (5일 기록 점검까지, TEST_CLOCK 필요)
//   배포본: BASE=https://… node tests/auth-check.mjs --evidence evidence.md  (점검용 계정 A·B를 만들고 증거를 파일로 남김)
// 비밀번호는 실행할 때마다 무작위로 만들고 어디에도 출력하지 않는다. 세션 값은 앞 6글자만 남기고 가린다.
import { writeFileSync } from 'node:fs';

const B = process.env.BASE || 'http://127.0.0.1:8787';
const LOCAL = /^http:\/\/(127\.0\.0\.1|localhost)/.test(B);
const evIdx = process.argv.indexOf('--evidence');
const EVIDENCE = evIdx > 0 ? process.argv[evIdx + 1] : null;
const RUN = Date.now().toString(36).slice(-5);

let fails = 0;
const ok = (cond, name, extra = '') => { console.log(`${cond ? 'PASS' : 'FAIL'} ${name} ${extra}`); if (!cond) fails++; };

const SECRETS = []; // 응답·기록 어디에도 나오면 안 되는 값(비밀번호·세션 원문)
const mask = (s) => (s ? `${s.slice(0, 6)}…생략` : '(없음)');
const ev = [];
const section = (t) => ev.push('', `### ${t}`, '');

function client(label) {
  return { label, cookie: '' };
}

async function call(c, method, path, { body, headers = {}, note, origin = B, keepCookie = true } = {}) {
  const h = { 'content-type': 'application/json', ...headers };
  if (origin) h.origin = origin;
  if (c && c.cookie) h.cookie = c.cookie;
  const r = await fetch(B + '/api' + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual' });
  const sc = r.headers.get('set-cookie');
  const text = await r.text();
  let j; try { j = JSON.parse(text); } catch { j = text; }
  if (sc && keepCookie && c) {
    const v = sc.split(';')[0];
    c.cookie = v.endsWith('=') ? '' : v;
    if (!v.endsWith('=')) SECRETS.push(v.split('=')[1]);
  }
  for (const s of SECRETS) if (s && text.includes(s)) { ok(false, `응답 본문에 비밀값이 섞임: ${method} ${path}`); }
  const shownBody = body === undefined ? '' : ' ' + JSON.stringify(body, (k, v) => (/password/.test(k) ? '••••(가림)' : v));
  const who = c && h.cookie ? `${c.label} 세션 ${mask(h.cookie.split('=')[1])}` : '세션 없음';
  const hdrs = Object.entries(headers).map(([k, v]) => `${k}: ${v}`).join(', ');
  ev.push(`- ${note ? note + ' — ' : ''}\`${method} /api${path}\`${shownBody} · ${who}${hdrs ? ' · ' + hdrs : ''}${origin && origin !== B ? ' · origin: ' + origin : ''}`);
  const shownRes = typeof j === 'string' ? j.slice(0, 120) : JSON.stringify(j).slice(0, 220);
  ev.push(`  → **${r.status}** ${shownRes}${sc ? ` · set-cookie: ${sc.split('=')[0]}=${mask(sc.split(';')[0].split('=')[1])}; ${sc.split(';').slice(1).map((x) => x.trim()).join('; ')}` : ''}`);
  return { s: r.status, j, sc, text };
}

const pw = () => `Pw-${crypto.randomUUID()}`; // 무작위, 출력하지 않음
const A = client('A'); const Bc = client('B');
const userA = `rev_a_${RUN}`; const userB = `rev_b_${RUN}`;
const pwA = pw(); SECRETS.push(pwA);
const sharedPw = pwA; // 같은 비밀번호로 B를 만들어 저장값이 다른지 본다

// ---------- 카드 1: 가입·로그인·로그아웃 ----------
section('가입·로그인·로그아웃 (카드 1)');
let r = await call(A, 'POST', '/auth/signup', { body: { username: userA, password: pwA }, note: 'A 가입' });
ok(r.s === 201, 'C94 가입');
r = await call(Bc, 'POST', '/auth/signup', { body: { username: userB, password: sharedPw }, note: 'B 가입(A와 같은 비밀번호)' });
ok(r.s === 201, 'C94 두 번째 계정 가입');
// D는 B와 같은 비밀번호로 만들고 끝까지 건드리지 않는다(저장값 비교용: B와 D의 password_hash가 달라야 한다).
r = await call(client('D'), 'POST', '/auth/signup', { body: { username: `rev_d_${RUN}`, password: sharedPw }, note: 'D 가입(B와 같은 비밀번호, 저장값 비교용)' });
ok(r.s === 201, 'C104 비교용 계정 D 가입');
r = await call(null, 'POST', '/auth/signup', { body: { username: userA, password: pw() }, note: '같은 아이디로 다시 가입' });
ok(r.s === 409, 'C98 같은 아이디 두 번 가입 안 됨');
r = await call(null, 'POST', '/auth/signup', { body: { username: userA.toUpperCase(), password: pw() }, note: '대문자로 바꿔 다시 가입' });
ok(r.s === 409 || r.s === 400, 'C98 대소문자만 바꾼 아이디도 막힘', r.s);
const wrongPw = await call(null, 'POST', '/auth/login', { body: { username: userA, password: 'wrong-password-123' }, note: '아이디는 맞고 비밀번호가 틀림' });
const noUser = await call(null, 'POST', '/auth/login', { body: { username: `nobody_${RUN}`, password: 'wrong-password-123' }, note: '없는 아이디' });
ok(wrongPw.s === 401 && noUser.s === 401 && wrongPw.j.error === noUser.j.error, 'C99 두 경우 안내 문구가 같음', wrongPw.j.error);
r = await call(null, 'GET', '/plans', { note: '로그인 없이 자료 목록 직접 요청' });
ok(r.s === 401, 'C124 로그인 없이 목록 요청 거절');
const L1 = client('A'); // 로그인으로 새 세션
r = await call(L1, 'POST', '/auth/login', { body: { username: userA, password: pwA }, note: 'A 로그인' });
ok(r.s === 200 && /HttpOnly/i.test(r.sc) && /Secure/i.test(r.sc) && /SameSite=Lax/i.test(r.sc), 'C95 로그인 + 쿠키 HttpOnly·Secure·SameSite');
ok(!/token|session/i.test(JSON.stringify(r.j)), 'C112 세션 값은 응답 본문·주소에 싣지 않음(쿠키로만)');
const exp = r.j.expires_at;
ok(exp && Math.abs(Date.parse(exp) - Date.now() - 7 * 86400e3) < 120e3, 'C111 만료 시각 = 로그인 뒤 7일', exp);

// ---------- 카드 3: 로그아웃 전후 같은 요청 ----------
section('같은 주소·같은 방식: 로그아웃 전 성공 / 뒤 거절 (카드 3)');
const before = L1.cookie;
r = await call(L1, 'GET', '/plans', { note: '로그아웃 전' });
ok(r.s === 200, 'C109 로그인 상태 성공');
await call(L1, 'POST', '/auth/logout', { note: '로그아웃' });
const after = client('A(로그아웃한 값)'); after.cookie = before;
r = await call(after, 'GET', '/plans', { note: '로그아웃 뒤 같은 값으로 같은 요청', keepCookie: false });
ok(r.s === 401, 'C109/C110 로그아웃 뒤 같은 값 거절');

section('비밀번호를 바꾸면 이전 값이 끊김 (카드 3)');
const S1 = client('A-1'); const S2 = client('A-2');
await call(S1, 'POST', '/auth/login', { body: { username: userA, password: pwA }, note: 'A 브라우저 1 로그인' });
await call(S2, 'POST', '/auth/login', { body: { username: userA, password: pwA }, note: 'A 브라우저 2 로그인' });
const oldS1 = S1.cookie;
const pwA2 = pw(); SECRETS.push(pwA2);
r = await call(S1, 'POST', '/auth/password', { body: { current_password: pwA, new_password: pwA2 }, note: '브라우저 1에서 비밀번호 변경' });
ok(r.s === 200, '비밀번호 변경');
r = await call(S2, 'GET', '/plans', { note: '브라우저 2(예전 값)로 요청', keepCookie: false });
const old1 = client('A-1(바꾸기 전 값)'); old1.cookie = oldS1;
const r2 = await call(old1, 'GET', '/plans', { note: '브라우저 1의 바꾸기 전 값으로 요청', keepCookie: false });
ok(r.s === 401 && r2.s === 401, 'C114 비밀번호 변경 뒤 이전 값 거절');
r = await call(S1, 'GET', '/plans', { note: '브라우저 1의 새 값' });
ok(r.s === 200, '비밀번호 변경 뒤 새 값은 통함');
r = await call(null, 'POST', '/auth/login', { body: { username: userA, password: pwA }, note: '예전 비밀번호로 로그인' });
ok(r.s === 401, '예전 비밀번호로 로그인 안 됨');
A.cookie = S1.cookie;

// ---------- 카드 4: 남의 자료 ----------
section('계정 두 개에 자료 넣기 (카드 4)');
const mk = async (c, who) => {
  const p = await call(c, 'POST', '/plans', { body: { title: `${who}의 계획`, start_date: '2026-10-12', end_date: '2026-10-31', priority: 2, success_criteria: `${who} 기준`, estimated_minutes: 300 }, note: `${who} 계획 만들기` });
  const t = await call(c, 'POST', `/plans/${p.j.id}/tasks`, { body: { title: `${who}의 할 일`, priority: 2, estimated_minutes: 30, tags: 'test' }, note: `${who} 할 일 만들기` });
  const e = await call(c, 'POST', `/tasks/${t.j.id}/executions`, { body: { started_at: '2026-10-12T10:00:00Z', ended_at: '2026-10-12T10:30:00Z' }, note: `${who} 실행 기록 만들기` });
  return { plan: p.j.id, task: t.j.id, exec: e.j.id };
};
const dA = await mk(A, 'A');
const dB = await mk(Bc, 'B');
ok(dA.plan && dA.task && dA.exec && dB.plan && dB.task && dB.exec, 'C116 두 계정에 자료 넣음');

const count = async (c) => {
  const e = await fetch(B + '/api/export', { headers: { cookie: c.cookie } }).then((x) => x.json());
  const t = e.tables;
  return { plans: t.plans.length, tasks: t.tasks.filter((x) => !x.deleted_at).length, executions: t.executions.length, completions: t.completions.length,
    snapshot: JSON.stringify([t.plans, t.tasks, t.executions, t.completions, t.plan_revisions]) };
};

async function attack(from, to, dTo, dir) {
  section(`${dir}: 읽기·수정·삭제 (카드 4)`);
  const pre = await count(to);
  ev.push(`- 거절 전 ${to.label}의 자료: 계획 ${pre.plans} · 할 일 ${pre.tasks} · 실행 기록 ${pre.executions} · 완료 기록 ${pre.completions}`);
  const tries = [
    ['읽기', 'GET', `/plans/${dTo.plan}`], ['읽기', 'GET', `/tasks/${dTo.task}`], ['읽기', 'GET', `/plans/${dTo.plan}/review`], ['읽기', 'GET', `/plans/${dTo.plan}/tasks`],
    ['수정', 'PUT', `/plans/${dTo.plan}`, { title: '덮어쓰기', start_date: '2026-10-12', end_date: '2026-10-31', priority: 1, success_criteria: 'x', estimated_minutes: 1 }],
    ['수정', 'PUT', `/tasks/${dTo.task}`, { title: '덮어쓰기', priority: 1 }],
    ['수정', 'POST', `/tasks/${dTo.task}/complete`, undefined, { 'Idempotency-Key': `atk-${RUN}-${dir.length}` }],
    ['수정', 'POST', `/plans/${dTo.plan}/tasks`, { title: '끼워 넣기', priority: 1 }],
    ['수정', 'POST', `/tasks/${dTo.task}/executions`, { started_at: '2026-10-12T10:00:00Z', ended_at: '2026-10-12T11:00:00Z' }],
    ['삭제', 'DELETE', `/tasks/${dTo.task}`], ['삭제', 'DELETE', `/executions/${dTo.exec}`],
  ];
  const got = {};
  for (const [kind, m, p, b, hd] of tries) {
    const x = await call(from, m, p, { body: b, headers: hd || {}, note: `${from.label}가 ${to.label}의 자료 ${kind}` });
    (got[kind] ||= []).push(x.s);
  }
  const post = await count(to);
  ev.push(`- 거절 뒤 ${to.label}의 자료: 계획 ${post.plans} · 할 일 ${post.tasks} · 실행 기록 ${post.executions} · 완료 기록 ${post.completions} · 내용 비교: ${pre.snapshot === post.snapshot ? '거절 전과 같음' : '달라짐!'}`);
  ok(got['읽기'].every((s) => s === 404), `C117 ${dir} 읽기 거절(404)`, got['읽기']);
  ok(got['수정'].every((s) => s === 404), `C118 ${dir} 수정 거절(404)`, got['수정']);
  ok(got['삭제'].every((s) => s === 404), `C119 ${dir} 삭제 거절(404)`, got['삭제']);
  ok(pre.snapshot === post.snapshot, `C122 ${dir} 거절 앞뒤 ${to.label} 자료 그대로`);
}
await attack(Bc, A, dA, 'B → A');
await attack(A, Bc, dB, 'A → B (반대 방향)');

section('주소·헤더·본문에 다른 계정을 적어 보내기 (카드 4)');
const aId = (await call(A, 'GET', '/auth/me', { note: 'A의 사용자 ID 확인' })).j.user.id;
r = await call(Bc, 'GET', `/plans?user_id=${aId}`, { headers: { 'X-User-Id': String(aId) }, note: 'B가 주소와 헤더에 A의 ID를 적어 목록 요청' });
ok(r.s === 200 && r.j.plans.every((p) => p.user_id !== aId) && r.j.plans.some((p) => p.id === dB.plan), 'C123 주소·헤더에 남의 ID → 내 자료만');
r = await call(Bc, 'POST', '/plans', { body: { user_id: aId, title: 'B가 A 이름으로', start_date: '2026-10-12', end_date: '2026-10-31', priority: 2, success_criteria: 'x', estimated_minutes: 10 }, note: 'B가 본문에 A의 ID를 적어 계획 만들기' });
const spoofId = r.j.id;
const listA = await call(A, 'GET', '/plans', { note: 'A의 목록' });
const listB = await call(Bc, 'GET', '/plans', { note: 'B의 목록' });
ok(!listA.j.plans.some((p) => p.id === spoofId) && listB.j.plans.some((p) => p.id === spoofId), 'C123 본문에 남의 ID → 내 계정에 저장');
ok(listA.j.plans.every((p) => p.user_id === aId) && listB.j.plans.every((p) => p.user_id !== aId), 'C125 목록에 남의 자료 없음');

section('로그인 없이 직접 요청, 다른 사이트에서 보낸 쓰기 요청 (카드 4)');
r = await call(null, 'GET', `/plans/${dA.plan}`, { note: '로그인 없이 A의 계획 읽기' });
const r3 = await call(null, 'DELETE', `/tasks/${dA.task}`, { note: '로그인 없이 A의 할 일 지우기' });
const r4 = await call(null, 'GET', '/export', { note: '로그인 없이 내보내기' });
ok(r.s === 401 && r3.s === 401 && r4.s === 401, 'C124 로그인 없이 직접 요청 거절');
r = await call(A, 'POST', '/plans', { body: { title: 'x', start_date: '2026-10-12', end_date: '2026-10-31', priority: 2, success_criteria: 'x', estimated_minutes: 1 }, origin: 'https://evil.example', note: 'A의 쿠키를 실은 채 다른 사이트(Origin)에서 쓰기' });
ok(r.s === 403, 'CSRF: 다른 Origin의 쓰기 거절');

// ---------- 계정 삭제 ----------
section('계정 삭제 (카드 5)');
const C = client('C'); const pwC = pw(); SECRETS.push(pwC);
await call(C, 'POST', '/auth/signup', { body: { username: `rev_c_${RUN}`, password: pwC }, note: 'C 가입' });
const dC = await mk(C, 'C');
const cCookie = C.cookie;
r = await call(C, 'DELETE', '/auth/account', { body: { password: pwC }, note: 'C 계정 삭제' });
const gone = client('C(삭제 전 값)'); gone.cookie = cCookie;
const r5 = await call(gone, 'GET', `/plans/${dC.plan}`, { note: '삭제 전 세션 값으로 C의 계획 읽기', keepCookie: false });
const r6 = await call(null, 'POST', '/auth/login', { body: { username: `rev_c_${RUN}`, password: pwC }, note: '지운 계정으로 로그인' });
ok(r.s === 200 && r5.s === 401 && r6.s === 401, 'C134 계정 삭제 → 세션·로그인 모두 끊김');

// ---------- 5일 기록(로컬, TEST_CLOCK) ----------
if (LOCAL) {
  const D = (n) => ({ 'X-Test-Today': `2026-10-${String(12 + n).padStart(2, '0')}` });
  const st = (n) => call(A, 'GET', '/experiment', { headers: D(n) });
  await call(A, 'POST', '/experiment', { body: { question: 'q', metric: '운동 시간', unit: '분', calc_rule: '그날 합', plan_rule: '저녁 8시' }, headers: D(0) });
  r = await call(A, 'POST', '/experiment', { body: { question: 'q2', metric: 'm', unit: 'u', calc_rule: 'c', plan_rule: 'p' }, headers: D(0) });
  ok(r.s === 409, 'C04~06 1일차 고정(두 번째 만들기 거절)');
  ok((await call(A, 'POST', '/experiment/logs', { body: { value: 30 }, headers: D(0) })).s === 200, '1일차 기록');
  ok((await call(A, 'POST', '/experiment/logs', { body: { value: 40 }, headers: D(0) })).s === 409, 'C24 같은 날 두 번 기록 거절');
  ok((await call(A, 'POST', '/experiment/logs', { body: { value: 20.25 }, headers: D(1) })).s === 200, '2일차 기록');
  ok((await call(A, 'POST', '/experiment/logs', { body: { value: 50 }, headers: D(2) })).s === 409, 'C09 규칙 변경 없이 3일차 거절');
  r = await call(A, 'POST', '/experiment/rule-change', { body: { new_rule: '아침 7시', reason: '저녁엔 피곤' }, headers: D(1) });
  ok(r.s === 200, 'C10/C11 규칙 변경(2일차 뒤)');
  ok((await call(A, 'POST', '/experiment/rule-change', { body: { new_rule: '또', reason: 'x' }, headers: D(2) })).s === 409, '규칙 변경은 한 번만');
  ok((await call(A, 'POST', '/experiment/logs', { body: { value: 45 }, headers: D(2) })).s === 200, '3일차 기록');
  ok((await call(A, 'POST', '/experiment/logs', { body: { missing: true }, headers: D(3) })).s === 200, '4일차 빠짐');
  ok((await call(A, 'POST', '/experiment/logs', { body: { value: 120 }, headers: D(5) })).s === 200, '5일차(하루 건너뜀, 튀는 값)');
  ok((await call(A, 'POST', '/experiment/logs', { body: { value: 1 }, headers: D(6) })).s === 409, '6일차 거절');
  ok((await call(A, 'PUT', `/experiment/logs/${(await st(6)).j.logs[0].id}`, { body: { value: 1 }, headers: D(6) })).s === 409, '지난 기록 고치기 거절');
  const s = (await st(6)).j;
  const sm = s.summary;
  ok(s.logs.map((l) => l.log_date).join() === '2026-10-12,2026-10-13,2026-10-14,2026-10-15,2026-10-17', 'C07 서로 다른 5일');
  ok(s.rule_change.day1_log_id === s.logs[0].id && s.rule_change.day2_log_id === s.logs[1].id && s.rule_change.changed_at > s.logs[1].created_at && s.rule_change.changed_at < s.logs[2].created_at, 'C09/C12 규칙 변경이 2일차 뒤·3일차 앞, 1·2일차를 가리킴');
  ok(s.logs[2].plan_rule === '아침 7시' && s.logs[1].plan_rule === '저녁 8시', '일차별 따른 규칙 기록');
  // 손으로: 전 30 + 20.3(20.25 반올림) = 50.3, 평균 25.15 → 25.2 / 뒤 45 + 120 = 165, 2일, 평균 82.5 / 전체 215.3 ÷ 4 = 53.825 → 53.8
  ok(sm.before.sum === 50.3 && sm.before.average === 25.2, 'C132/C26 전 합계·평균(반올림)', JSON.stringify(sm.before));
  ok(sm.after.sum === 165 && sm.after.average === 82.5 && sm.after.missing === 1, 'C23 빠진 날은 평균에서 뺌', JSON.stringify(sm.after));
  ok(sm.all.sum === 215.3 && sm.all.average === 53.8 && sm.change_of_average === 57.3, 'C132 전체 합계·평균, 변화', JSON.stringify(sm.all));
}

// ---------- 비밀값 노출 ----------
const exA = await fetch(B + '/api/export', { headers: { cookie: A.cookie } }).then((x) => x.text());
ok(!/password_hash|pbkdf2|token_hash/.test(exA) && !SECRETS.some((s) => exA.includes(s)), 'C106 내보내기에 비밀번호·해시·세션 없음');
for (const f of ['/', '/app.js', '/pages.js', '/style.css']) {
  const t = await fetch(B + f).then((x) => x.text());
  ok(!SECRETS.some((s) => t.includes(s)) && !/CLOUDFLARE_API_TOKEN|api[_-]?key\s*[:=]/i.test(t), `C113 배포 파일 ${f}에 비밀값 없음`);
}

console.log(fails ? `\n${fails} FAIL` : '\nALL PASS');
if (EVIDENCE) {
  const head = [`# 확인 기록 (${new Date().toISOString()} · ${B})`, '', '비밀번호는 실행할 때 무작위로 만들고 적지 않았습니다(••••). 세션 값은 앞 6글자만 남기고 가렸습니다.',
    `점검용 계정: A = \`${userA}\`, B = \`${userB}\`, D = \`rev_d_${RUN}\` (B와 D는 같은 비밀번호로 만듦, A는 중간에 비밀번호를 바꿈). C는 계정 삭제 확인용으로 만들고 지웠습니다.`];
  writeFileSync(EVIDENCE, head.concat(ev).join('\n') + '\n');
  console.log('증거 기록:', EVIDENCE);
}
process.exit(fails ? 1 : 0);
