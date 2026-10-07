// 통과 기준 점검 스크립트 — 로컬 서버(wrangler dev)에만 돌린다. 배포 DB에 돌리면 테스트 자료가 섞인다.
// 사용: BASE=http://127.0.0.1:8787 node tests/check.mjs
const B = process.env.BASE || 'http://127.0.0.1:8787';
if (!/^http:\/\/(127\.0\.0\.1|localhost)/.test(B)) { console.error('로컬 서버에만 돌리세요.'); process.exit(1); }
let fails = 0;
const ok = (cond, name, extra = '') => { console.log(`${cond ? 'PASS' : 'FAIL'} ${name} ${extra}`); if (!cond) fails++; };
async function api(m, p, body, headers = {}) {
  const r = await fetch(B + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...headers }, body: body && JSON.stringify(body) });
  const t = await r.text();
  let j; try { j = JSON.parse(t); } catch { j = t; }
  return { s: r.status, j, h: r.headers };
}
const day = (n) => new Date(Date.now() + 9 * 3600e3 + n * 86400e3).toISOString().slice(0, 10);
const today = day(0), yest = day(-1), soon = day(5);

const plan = { title: 'TEST 계획', start_date: yest, end_date: '2026-12-31', priority: 1, success_criteria: '기준A', estimated_minutes: 600 };
const pid = (await api('POST', '/plans', plan)).j.id;
let d = (await api('GET', `/plans/${pid}`)).j;
ok(d.plan.start_date === yest && d.plan.end_date === '2026-12-31', 'C04 기간');
ok(d.plan.priority === 1, 'C05 우선순위');
ok(d.plan.success_criteria === '기준A', 'C06 성공 기준');
ok(d.plan.estimated_minutes === 600, 'C07 예상 시간');
await api('PUT', `/plans/${pid}`, { ...plan, success_criteria: '기준B', estimated_minutes: 480, change_note: '줄임' });
d = (await api('GET', `/plans/${pid}`)).j;
const r1 = d.revisions.find((r) => r.rev_no === 1);
ok(d.plan.id === pid && d.plan.success_criteria === '기준B' && r1.success_criteria === '기준A' && r1.estimated_minutes === 600 && d.revisions.length === 2, 'C08 고치기 전 계획 보존');

const mk = (t) => api('POST', `/plans/${pid}/tasks`, t).then((r) => r.j.id);
const t1 = await mk({ title: '스쿼트', due_date: yest, priority: 1, tags: '하체, 헬스장', estimated_minutes: 60 });
const t2 = await mk({ title: '런닝', due_date: today, priority: 2, tags: ['유산소'], estimated_minutes: 30 });
const t3 = await mk({ title: '데드리프트', due_date: yest, priority: 1, tags: '하체', estimated_minutes: 45 });
const t4 = await mk({ title: '스트레칭', priority: 3, estimated_minutes: 15 });
const t5 = await mk({ title: '<script>alert(1)</script>', due_date: soon, priority: 2, estimated_minutes: 20, memo: '<img src=x onerror=alert(1)>' });
const t6 = await mk({ title: '지울 것', priority: 2, estimated_minutes: 999 });
ok([t1, t2, t3, t4, t5, t6].every(Boolean), 'C09 할 일 만들기');
let t = (await api('GET', `/tasks/${t1}`)).j.task;
ok(t.due_date === yest, 'C14 마감일'); ok(t.priority === 1, 'C15 우선순위');
ok(JSON.stringify(t.tags) === JSON.stringify(['하체', '헬스장']), 'C16 태그');
ok(t.estimated_minutes === 60, 'C17 예상 시간');
await api('PUT', `/tasks/${t4}`, { title: '스트레칭 10분', priority: 3, estimated_minutes: 10, tags: '회복' });
t = (await api('GET', `/tasks/${t4}`)).j.task;
ok(t.title === '스트레칭 10분' && t.estimated_minutes === 10 && t.tags[0] === '회복', 'C10 고치기');
await api('DELETE', `/tasks/${t6}`);
ok((await api('GET', `/tasks/${t6}`)).s === 404, 'C13 지우기');
let L = (await api('GET', `/plans/${pid}/tasks?q=${encodeURIComponent('리프트')}`)).j;
ok(L.tasks.length === 1 && L.tasks[0].id === t3, 'C18 검색');
L = (await api('GET', `/plans/${pid}/tasks?tag=${encodeURIComponent('하체')}&priority=1`)).j;
ok(L.tasks.map((x) => x.id).join() === [t1, t3].join(), 'C19 거르기(태그+우선순위)');
L = (await api('GET', `/plans/${pid}/tasks?q=%25`)).j;
ok(L.tasks.length === 0, 'C18 % 문자 이스케이프');
L = (await api('GET', `/plans/${pid}/tasks?sort=due`)).j;
ok(L.tasks.map((x) => x.id).join() === [t1, t3, t2, t5, t4].join() && L.sort.label.includes('ID'), 'C20 정렬(마감→우선순위→ID)');

const before = (await api('GET', `/plans/${pid}/review`)).j.counts.done;
const [a, b] = await Promise.all([
  api('POST', `/tasks/${t2}/complete`, undefined, { 'Idempotency-Key': `key-a-${pid}-${t2}` }),
  api('POST', `/tasks/${t2}/complete`, undefined, { 'Idempotency-Key': `key-b-${pid}-${t2}` }),
]);
const same = await api('POST', `/tasks/${t2}/complete`, undefined, { 'Idempotency-Key': `key-a-${pid}-${t2}` });
let td = (await api('GET', `/tasks/${t2}`)).j;
ok(td.task.status === 'done', 'C11 완료로 바꾸기');
ok(td.completions.length === 1 && [a, b, same].filter((x) => x.j.duplicate).length === 2, 'C21 완료 기록 한 건');
ok((await api('GET', `/plans/${pid}/review`)).j.counts.done - before === 1, 'C22 완료 수 +1');
await api('POST', `/tasks/${t2}/reopen`);
await api('POST', `/tasks/${t2}/reopen`);
td = (await api('GET', `/tasks/${t2}`)).j;
ok(td.task.status === 'todo' && td.completions[0].reverted_at, 'C12 되돌리기');
await api('POST', `/tasks/${t2}/complete`, undefined, { 'Idempotency-Key': `key-c-${pid}-${t2}` });
td = (await api('GET', `/tasks/${t2}`)).j;
ok(td.completions.length === 2 && td.task.status === 'done', '되돌린 뒤 다시 완료 → 새 완료 기록');

const planBefore = (await api('GET', `/plans/${pid}`)).j.plan;
const taskBefore = (await api('GET', `/tasks/${t1}`)).j.task;
await api('POST', `/tasks/${t1}/executions`, { started_at: '2026-09-29T10:00:00.000Z', ended_at: '2026-09-29T11:15:00.000Z', blocker: '무릎 통증' });
await api('POST', `/tasks/${t1}/executions`, { started_at: '2026-09-30T10:00:00.000Z', ended_at: '2026-09-30T10:40:00.000Z', actual_minutes: 35 });
await api('POST', `/tasks/${t2}/executions`, { started_at: '2026-09-30T00:00:00+09:00', ended_at: '2026-09-30T00:25:00+09:00' });
const ex = (await api('GET', `/tasks/${t1}`)).j.executions;
const e1 = ex.find((e) => e.blocker);
ok(e1.started_at === '2026-09-29T10:00:00.000Z', 'C23 시작 시각');
ok(e1.ended_at === '2026-09-29T11:15:00.000Z', 'C24 끝난 시각');
ok(e1.actual_minutes === 75 && ex.find((e) => !e.blocker).actual_minutes === 35, 'C25 실제 시간');
ok(e1.blocker === '무릎 통증', 'C26 막힌 이유');
const planAfter = (await api('GET', `/plans/${pid}`)).j.plan;
const taskAfter = (await api('GET', `/tasks/${t1}`)).j.task;
ok(JSON.stringify(planBefore) === JSON.stringify(planAfter) && taskBefore.updated_at === taskAfter.updated_at, 'C27 계획 값 안 덮어씀');
ok((await api('POST', `/tasks/${t1}/executions`, { started_at: '2026-09-30T10:00:00Z', ended_at: '2026-09-30T09:00:00Z' })).s === 400, '끝<시작 거부');

const rv = (await api('GET', `/plans/${pid}/review`)).j;
const c = rv.counts;
ok(c.planned === 5, 'C28 계획 수', c.planned);
ok(c.done === 1, 'C29 완료 수', c.done);
ok(c.late === 2 && !rv.ids.late.includes(t2), 'C30 지연 수', JSON.stringify(rv.ids.late));
ok(c.blocked === 1 && rv.ids.blocked[0] === t1, 'C31 막힘 수');
ok(c.estimated_minutes === 165 && c.actual_minutes === 135 && c.diff_minutes === -30, 'C32 시간', JSON.stringify(c));
const card = (await api('GET', '/plans')).j.plans.find((p) => p.id === pid);
ok(card.late_count === c.late && card.blocked_count === c.blocked && card.task_estimated_minutes === c.estimated_minutes && card.task_actual_minutes === c.actual_minutes, '첫 화면 카드 숫자 = 돌아보기 숫자');
await api('POST', `/tasks/${t3}/complete`, undefined, { 'Idempotency-Key': `key-d-${pid}-${t3}` });
const rv2 = (await api('GET', `/plans/${pid}/review`)).j.counts;
ok(rv2.late === 1 && rv2.done === 2, 'C30 완료하면 지연에서 빠짐');
const emptyId = (await api('POST', '/plans', { ...plan, title: 'EMPTY' })).j.id;
ok(Object.values((await api('GET', `/plans/${emptyId}/review`)).j.counts).every((v) => v === 0), 'C32 아무것도 없으면 0');
ok((await api('GET', `/plans/${pid}/review?from=${today}&to=2026-12-31`)).j.counts.planned === 2, '기간별 집계');

const sr = (await api('POST', `/plans/${pid}/reviews`, { improvement: '마감을 주말 오전으로' })).j;
const np = (await api('POST', '/plans', { ...plan, title: '다음 계획', carried_from_review_id: sr.id })).j;
const npd = (await api('GET', `/plans/${np.id}`)).j;
ok(npd.plan.carried_note === '마감을 주말 오전으로' && npd.carried_from.id === sr.id, 'C33 고칠 점 넘어감');
ok((await api('POST', '/plans', { ...plan, carried_from_review_id: sr.id })).s === 409, 'C33 한 건은 한 번만');

const exp = await fetch(B + '/api/export');
const ej = await exp.json();
ok(exp.headers.get('content-disposition').includes('attachment') && ej.tables.executions.length >= 3, 'C36 내보내기');
const xs = (await api('GET', `/tasks/${t5}`)).j.task;
ok(xs.title === '<script>alert(1)</script>' && xs.memo === '<img src=x onerror=alert(1)>', 'C57 스크립트 글자 원문 저장');
ok((await api('POST', '/plans', 'not-json')).s === 400, '잘못된 입력 400');
const home = await fetch(B + '/');
const html = await home.text();
ok(html.includes('지금은 로그인이 없어 링크를 아는 사람은 누구나 볼 수 있습니다. 남이 봐도 괜찮은 내용만 넣으세요'), 'C82 공개 안내');
ok((home.headers.get('content-security-policy') || '').includes("script-src 'self'"), 'CSP 헤더');

console.log(fails ? `\n${fails} FAIL` : '\nALL PASS');
