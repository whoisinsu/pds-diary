// 플랜두씨 다이어리 API — Cloudflare Worker + D1
// 정적 화면은 public/ 에서 Workers Assets가 내보내고, /api/* 만 여기로 온다.
//
// 요청 흐름: fetch() → 쓰기 요청이면 Origin 확인 → currentUser()로 세션 확인
//          → /api/auth/* 외에는 requireUser()로 401 → 각 함수에 uid(세션의 사용자)만 넘긴다.

import { HttpError, json, nowIso, seoulToday, id, body } from './util.js';
import * as auth from './auth.js';
import * as diary from './diary.js';
import * as exp from './experiment.js';

const SCHEMA_VERSION = 'pds-schema-v3';

// 내 자료 전체 내보내기(비밀번호 해시·세션은 넣지 않는다)
async function exportMine(db, user) {
  const u = user.id;
  const myPlans = 'SELECT id FROM plans WHERE user_id = ?';
  const myTasks = 'SELECT t.id FROM tasks t JOIN plans p ON p.id = t.plan_id WHERE p.user_id = ?';
  const myExp = 'SELECT id FROM experiments WHERE user_id = ?';
  const q = {
    account: db.prepare('SELECT id, username, created_at, password_changed_at FROM users WHERE id = ?').bind(u),
    plans: db.prepare('SELECT * FROM plans WHERE user_id = ? ORDER BY id').bind(u),
    plan_revisions: db.prepare(`SELECT * FROM plan_revisions WHERE plan_id IN (${myPlans}) ORDER BY id`).bind(u),
    tasks: db.prepare(`SELECT * FROM tasks WHERE id IN (${myTasks}) ORDER BY id`).bind(u),
    task_tags: db.prepare(`SELECT * FROM task_tags WHERE task_id IN (${myTasks}) ORDER BY task_id, tag`).bind(u),
    completions: db.prepare(`SELECT * FROM completions WHERE task_id IN (${myTasks}) ORDER BY id`).bind(u),
    executions: db.prepare(`SELECT * FROM executions WHERE task_id IN (${myTasks}) ORDER BY id`).bind(u),
    reviews: db.prepare(`SELECT * FROM reviews WHERE plan_id IN (${myPlans}) ORDER BY id`).bind(u),
    experiments: db.prepare('SELECT * FROM experiments WHERE user_id = ?').bind(u),
    daily_logs: db.prepare(`SELECT * FROM daily_logs WHERE experiment_id IN (${myExp}) ORDER BY day_no`).bind(u),
    rule_changes: db.prepare(`SELECT * FROM rule_changes WHERE experiment_id IN (${myExp})`).bind(u),
  };
  const names = Object.keys(q);
  const results = await db.batch(Object.values(q));
  const tables = Object.fromEntries(names.map((n, i) => [n, results[i].results]));
  const data = {
    schema: SCHEMA_VERSION,
    exported_at: nowIso(),
    account: tables.account[0],
    rules: {
      instants: 'UTC ISO-8601 (…_at)',
      dates: 'YYYY-MM-DD, Asia/Seoul 달력 기준',
      durations: '정수, 분(minute)',
      priority: diary.PRIORITY_LABEL,
    },
    tables: Object.fromEntries(names.filter((n) => n !== 'account').map((n) => [n, tables[n]])),
  };
  const stamp = seoulToday().replace(/-/g, '');
  return new Response(JSON.stringify(data, null, 2), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'content-disposition': `attachment; filename="pds-diary-${user.username}-${stamp}.json"`,
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    },
  });
}

// 로컬 점검용 시계: wrangler dev --var TEST_CLOCK:1 로 띄웠을 때만 X-Test-Today 헤더를 읽는다.
// 배포 설정(wrangler.toml)에는 TEST_CLOCK이 없으므로 배포본에서는 늘 서버의 서울 날짜를 쓴다.
function todayFor(request, env) {
  const t = request.headers.get('x-test-today');
  if (env.TEST_CLOCK === '1' && t && /^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  return seoulToday();
}

async function route(request, env, url) {
  const db = env.DB;
  const m = request.method;
  const parts = url.pathname.replace(/^\/api\/?/, '').split('/').filter(Boolean);
  const [a, b, c] = parts;

  const user = await auth.currentUser(db, request);

  // --- 로그인 없이 부를 수 있는 것 ---
  if (a === 'auth') {
    if (b === 'signup' && m === 'POST') return auth.signup(db, request);
    if (b === 'login' && m === 'POST') return auth.login(db, request);
    if (b === 'logout' && m === 'POST') return auth.logout(db, user);
    if (b === 'me' && m === 'GET') {
      auth.requireUser(user);
      return { user: { id: user.id, username: user.username }, expires_at: user.expires_at };
    }
    if (b === 'password' && m === 'POST') return auth.changePassword(db, auth.requireUser(user), request);
    if (b === 'account' && m === 'DELETE') return auth.deleteAccount(db, auth.requireUser(user), request);
    throw new HttpError(404, '없는 주소입니다.');
  }

  // --- 여기부터는 모두 로그인 필요 ---
  const uid = auth.requireUser(user).id;

  if (a === 'plans' && !b) {
    if (m === 'GET') return diary.listPlans(db, uid);
    if (m === 'POST') return diary.createPlan(db, uid, await body(request));
  }
  if (a === 'plans' && b && !c) {
    if (m === 'GET') return diary.planDetail(db, uid, id(b));
    if (m === 'PUT') return diary.updatePlan(db, uid, id(b), await body(request));
  }
  if (a === 'plans' && b && c === 'tasks' && parts.length === 3) {
    if (m === 'GET') return diary.listTasks(db, uid, id(b), url);
    if (m === 'POST') return diary.createTask(db, uid, id(b), await body(request));
  }
  if (a === 'plans' && b && c === 'review' && m === 'GET') {
    return diary.computeReview(db, uid, id(b), url.searchParams.get('from'), url.searchParams.get('to'));
  }
  if (a === 'plans' && b && c === 'reviews' && m === 'POST') return diary.createReview(db, uid, id(b), await body(request));
  if (a === 'reviews' && b && !c && m === 'GET') return diary.getReview(db, uid, id(b));
  if (a === 'tasks' && b && !c) {
    if (m === 'GET') return diary.taskDetail(db, uid, id(b));
    if (m === 'PUT') return diary.updateTask(db, uid, id(b), await body(request));
    if (m === 'DELETE') return diary.deleteTask(db, uid, id(b));
  }
  if (a === 'tasks' && b && m === 'POST') {
    if (c === 'complete') return diary.completeTask(db, uid, id(b), request);
    if (c === 'reopen') return diary.reopenTask(db, uid, id(b));
    if (c === 'executions') return diary.createExecution(db, uid, id(b), await body(request));
  }
  if (a === 'executions' && b && !c && m === 'DELETE') return diary.deleteExecution(db, uid, id(b));

  if (a === 'experiment') {
    const today = todayFor(request, env);
    if (!b && m === 'GET') return exp.getState(db, uid, today);
    if (!b && m === 'POST') return exp.createExperiment(db, uid, await body(request), today);
    if (b === 'logs' && !c && m === 'POST') return exp.addLog(db, uid, await body(request), today);
    if (b === 'logs' && c && m === 'PUT') return exp.updateLog(db, uid, c, await body(request), today);
    if (b === 'rule-change' && m === 'POST') return exp.changeRule(db, uid, await body(request), today);
  }

  if (a === 'export' && m === 'GET') return exportMine(db, user);
  throw new HttpError(404, '없는 주소입니다.');
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    try {
      // 다른 사이트에서 보낸 쓰기 요청(CSRF)을 막는다: 쓰기 요청은 이 사이트에서 온 것만 받는다.
      if (!['GET', 'HEAD'].includes(request.method)) {
        const origin = request.headers.get('origin');
        if (origin !== url.origin) throw new HttpError(403, '이 사이트에서 보낸 요청만 받습니다.');
      }
      const out = await route(request, env, url);
      return out instanceof Response ? out : json(out);
    } catch (err) {
      if (err instanceof HttpError) return json({ error: err.message }, err.status);
      // 내부 오류 내용은 화면·응답에 내보내지 않는다. 요청 본문(비밀번호 포함)도 로그에 남기지 않는다.
      console.error('api error', request.method, url.pathname, err && err.name, err && err.message);
      return json({ error: '서버에서 처리하지 못했습니다. 잠시 뒤 다시 시도해 주세요.' }, 500);
    }
  },
};
