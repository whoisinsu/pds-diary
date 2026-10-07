// 플랜두씨 다이어리 API — Cloudflare Worker + D1
// 정적 화면은 public/ 에서 Workers Assets가 내보내고, /api/* 만 여기로 온다.

const SCHEMA_VERSION = 'pds-schema-v2';
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const PRIORITY_LABEL = { 1: '높음', 2: '보통', 3: '낮음' };

const SORTS = {
  due: {
    sql: 't.due_date IS NULL, t.due_date ASC, t.priority ASC, t.id ASC',
    label: '마감일 빠른 순 → 같으면 우선순위 높은 순 → 같으면 할 일 ID 작은 순 (마감일 없는 할 일은 맨 뒤)',
  },
  priority: {
    sql: 't.priority ASC, t.due_date IS NULL, t.due_date ASC, t.id ASC',
    label: '우선순위 높은 순 → 같으면 마감일 빠른 순 → 같으면 할 일 ID 작은 순',
  },
  estimate: {
    sql: 't.estimated_minutes IS NULL, t.estimated_minutes DESC, t.id ASC',
    label: '예상 시간 긴 순 → 같으면 할 일 ID 작은 순 (예상 시간 없는 할 일은 맨 뒤)',
  },
  created: {
    sql: 't.id DESC',
    label: '최근에 만든 순 (할 일 ID 큰 순)',
  },
};

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const nowIso = () => new Date().toISOString();

// 서울(UTC+9, 일광절약 없음) 기준 오늘 날짜
function seoulToday() {
  return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      ...extra,
    },
  });
}

// ---------- 입력 검사 ----------

function text(v, name, { required = false, max = 2000 } = {}) {
  if (v === undefined || v === null) v = '';
  if (typeof v !== 'string') throw new HttpError(400, `${name}은(는) 글자여야 합니다.`);
  v = v.trim();
  if (required && !v) throw new HttpError(400, `${name}을(를) 적어 주세요.`);
  if (v.length > max) throw new HttpError(400, `${name}은(는) ${max}자 이하로 적어 주세요.`);
  return v;
}

function date(v, name, { required = false } = {}) {
  if (v === undefined || v === null || v === '') {
    if (required) throw new HttpError(400, `${name}을(를) 골라 주세요.`);
    return null;
  }
  if (typeof v !== 'string' || !DATE_RE.test(v) || isNaN(Date.parse(v + 'T00:00:00Z'))) {
    throw new HttpError(400, `${name}은(는) YYYY-MM-DD 형식이어야 합니다.`);
  }
  return v;
}

function instant(v, name) {
  if (typeof v !== 'string' || isNaN(Date.parse(v))) {
    throw new HttpError(400, `${name}이(가) 올바른 시각이 아닙니다.`);
  }
  return new Date(v).toISOString();
}

function minutes(v, name, { required = false } = {}) {
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

function priority(v) {
  const n = Number(v);
  if (![1, 2, 3].includes(n)) throw new HttpError(400, '우선순위는 높음·보통·낮음 중 하나여야 합니다.');
  return n;
}

function tags(v) {
  if (v === undefined || v === null) return [];
  const list = Array.isArray(v) ? v : String(v).split(',');
  const out = [...new Set(list.map((t) => String(t).trim()).filter(Boolean))];
  if (out.length > 10) throw new HttpError(400, '태그는 10개까지 넣을 수 있습니다.');
  for (const t of out) if (t.length > 30) throw new HttpError(400, '태그 하나는 30자 이하로 적어 주세요.');
  return out;
}

function id(v) {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new HttpError(404, '찾을 수 없습니다.');
  return n;
}

async function body(request) {
  const raw = await request.text();
  if (raw.length > 20000) throw new HttpError(413, '보낸 내용이 너무 깁니다.');
  try {
    return raw ? JSON.parse(raw) : {};
  } catch {
    throw new HttpError(400, 'JSON 형식이 아닙니다.');
  }
}

const likeEscape = (s) => s.replace(/[\\%_]/g, (c) => '\\' + c);

// ---------- 공통 조회 ----------

async function getPlan(db, planId) {
  const plan = await db.prepare('SELECT * FROM plans WHERE id = ?').bind(planId).first();
  if (!plan) throw new HttpError(404, '계획을 찾을 수 없습니다.');
  return plan;
}

async function getTask(db, taskId) {
  const task = await db
    .prepare(
      `SELECT t.*, (SELECT group_concat(tag, char(31)) FROM task_tags WHERE task_id = t.id) AS tag_list
       FROM tasks t WHERE t.id = ? AND t.deleted_at IS NULL`
    )
    .bind(taskId)
    .first();
  if (!task) throw new HttpError(404, '할 일을 찾을 수 없습니다.');
  return shapeTask(task);
}

function shapeTask(row) {
  const { tag_list, ...rest } = row;
  return { ...rest, tags: tag_list ? tag_list.split('\u001f').sort() : [] };
}

// ---------- 계획 ----------

function readPlanInput(b) {
  const p = {
    title: text(b.title, '계획 이름', { required: true, max: 200 }),
    start_date: date(b.start_date, '시작일', { required: true }),
    end_date: date(b.end_date, '종료일', { required: true }),
    priority: priority(b.priority),
    success_criteria: text(b.success_criteria, '성공 기준', { required: true }),
    estimated_minutes: minutes(b.estimated_minutes, '예상 시간', { required: true }),
  };
  if (p.end_date < p.start_date) throw new HttpError(400, '종료일은 시작일보다 앞설 수 없습니다.');
  return p;
}

// 첫 화면 카드용 요약. 규칙은 돌아보기(computeReview)의 기간 없는 집계와 같다.
async function listPlans(db) {
  const today = seoulToday();
  const { results } = await db
    .prepare(
      `SELECT p.*,
         (SELECT count(*) FROM tasks t WHERE t.plan_id = p.id AND t.deleted_at IS NULL) AS task_count,
         (SELECT count(*) FROM tasks t WHERE t.plan_id = p.id AND t.deleted_at IS NULL AND t.status = 'done') AS done_count,
         (SELECT count(*) FROM tasks t WHERE t.plan_id = p.id AND t.deleted_at IS NULL AND t.status <> 'done'
            AND t.due_date IS NOT NULL AND t.due_date < ?) AS late_count,
         (SELECT count(*) FROM tasks t WHERE t.plan_id = p.id AND t.deleted_at IS NULL
            AND EXISTS (SELECT 1 FROM executions e WHERE e.task_id = t.id AND trim(e.blocker) <> '')) AS blocked_count,
         (SELECT coalesce(sum(t.estimated_minutes), 0) FROM tasks t WHERE t.plan_id = p.id AND t.deleted_at IS NULL) AS task_estimated_minutes,
         (SELECT coalesce(sum(e.actual_minutes), 0) FROM executions e JOIN tasks t ON t.id = e.task_id
            WHERE t.plan_id = p.id AND t.deleted_at IS NULL) AS task_actual_minutes
       FROM plans p ORDER BY p.id DESC`
    )
    .bind(today)
    .all();
  return { plans: results, today };
}

async function createPlan(db, b) {
  const p = readPlanInput(b);
  const now = nowIso();
  let carriedId = null;
  let carriedNote = null;
  if (b.carried_from_review_id) {
    carriedId = id(b.carried_from_review_id);
    const review = await db.prepare('SELECT * FROM reviews WHERE id = ?').bind(carriedId).first();
    if (!review) throw new HttpError(400, '넘겨받을 돌아보기를 찾을 수 없습니다.');
    const used = await db.prepare('SELECT id FROM plans WHERE carried_from_review_id = ?').bind(carriedId).first();
    if (used) throw new HttpError(409, `이 고칠 점은 이미 계획 #${used.id}(으)로 넘어갔습니다.`);
    carriedNote = review.improvement;
  }
  // 계획과 1판 이력을 한 트랜잭션으로 넣는다.
  const [ins] = await db.batch([
    db
      .prepare(
        `INSERT INTO plans (title, start_date, end_date, priority, success_criteria, estimated_minutes,
           current_rev, carried_from_review_id, carried_note, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?) RETURNING id`
      )
      .bind(p.title, p.start_date, p.end_date, p.priority, p.success_criteria, p.estimated_minutes,
        carriedId, carriedNote, now, now),
    db
      .prepare(
        `INSERT INTO plan_revisions (plan_id, rev_no, title, start_date, end_date, priority,
           success_criteria, estimated_minutes, change_note, created_at)
         SELECT id, 1, title, start_date, end_date, priority, success_criteria, estimated_minutes, '처음 세운 계획', ?
         FROM plans WHERE id = last_insert_rowid()`
      )
      .bind(now),
  ]);
  return { id: ins.results[0].id };
}

async function planDetail(db, planId) {
  const plan = await getPlan(db, planId);
  const [revs, reviews, next] = await db.batch([
    db.prepare('SELECT * FROM plan_revisions WHERE plan_id = ? ORDER BY rev_no DESC').bind(planId),
    db
      .prepare(
        `SELECT r.*, (SELECT id FROM plans WHERE carried_from_review_id = r.id) AS next_plan_id
         FROM reviews r WHERE r.plan_id = ? ORDER BY r.id DESC`
      )
      .bind(planId),
    plan.carried_from_review_id
      ? db.prepare('SELECT id, plan_id FROM reviews WHERE id = ?').bind(plan.carried_from_review_id)
      : db.prepare('SELECT NULL AS id WHERE 0'),
  ]);
  return {
    plan,
    revisions: revs.results,
    reviews: reviews.results.map((r) => ({ ...r, snapshot: JSON.parse(r.snapshot_json) })),
    carried_from: next.results[0] || null,
  };
}

async function updatePlan(db, planId, b) {
  await getPlan(db, planId);
  const p = readPlanInput(b);
  const note = text(b.change_note, '고친 이유', { max: 500 });
  const now = nowIso();
  // 지금 값을 바꾸고, 바뀐 값을 새 판으로 쌓는다. 예전 판은 그대로 남는다.
  await db.batch([
    db
      .prepare(
        `UPDATE plans SET title = ?, start_date = ?, end_date = ?, priority = ?, success_criteria = ?,
           estimated_minutes = ?, current_rev = current_rev + 1, updated_at = ? WHERE id = ?`
      )
      .bind(p.title, p.start_date, p.end_date, p.priority, p.success_criteria, p.estimated_minutes, now, planId),
    db
      .prepare(
        `INSERT INTO plan_revisions (plan_id, rev_no, title, start_date, end_date, priority,
           success_criteria, estimated_minutes, change_note, created_at)
         SELECT id, current_rev, title, start_date, end_date, priority, success_criteria, estimated_minutes, ?, ?
         FROM plans WHERE id = ?`
      )
      .bind(note, now, planId),
  ]);
  return { id: planId };
}

// ---------- 할 일 ----------

function readTaskInput(b) {
  return {
    title: text(b.title, '할 일', { required: true, max: 200 }),
    memo: text(b.memo, '메모'),
    due_date: date(b.due_date, '마감일'),
    priority: priority(b.priority),
    estimated_minutes: minutes(b.estimated_minutes, '예상 시간'),
    tags: tags(b.tags),
  };
}

function tagStatements(db, taskIdExpr, taskId, list) {
  const stmts = [];
  if (taskId !== null) stmts.push(db.prepare('DELETE FROM task_tags WHERE task_id = ?').bind(taskId));
  for (const tag of list) {
    stmts.push(
      taskId !== null
        ? db.prepare('INSERT INTO task_tags (task_id, tag) VALUES (?, ?)').bind(taskId, tag)
        : db.prepare(`INSERT INTO task_tags (task_id, tag) VALUES (${taskIdExpr}, ?)`).bind(tag)
    );
  }
  return stmts;
}

async function listTasks(db, planId, url) {
  await getPlan(db, planId);
  const q = (url.searchParams.get('q') || '').trim();
  const status = url.searchParams.get('status') || 'all';
  const prio = url.searchParams.get('priority') || '';
  const tag = (url.searchParams.get('tag') || '').trim();
  const sortKey = SORTS[url.searchParams.get('sort')] ? url.searchParams.get('sort') : 'due';
  const today = seoulToday();

  const where = ['t.plan_id = ?', 't.deleted_at IS NULL'];
  const args = [planId];
  if (q) {
    const like = '%' + likeEscape(q) + '%';
    where.push(
      `(t.title LIKE ? ESCAPE '\\' OR t.memo LIKE ? ESCAPE '\\'
        OR EXISTS (SELECT 1 FROM task_tags g WHERE g.task_id = t.id AND g.tag LIKE ? ESCAPE '\\'))`
    );
    args.push(like, like, like);
  }
  if (status === 'todo' || status === 'done') {
    where.push('t.status = ?');
    args.push(status);
  } else if (status === 'late') {
    where.push("t.status <> 'done' AND t.due_date IS NOT NULL AND t.due_date < ?");
    args.push(today);
  }
  if (prio) {
    where.push('t.priority = ?');
    args.push(priority(prio));
  }
  if (tag) {
    where.push('EXISTS (SELECT 1 FROM task_tags g WHERE g.task_id = t.id AND g.tag = ?)');
    args.push(tag);
  }

  const [rows, allTags] = await db.batch([
    db
      .prepare(
        `SELECT t.*,
           (SELECT group_concat(tag, char(31)) FROM task_tags WHERE task_id = t.id) AS tag_list,
           (SELECT count(*) FROM executions e WHERE e.task_id = t.id) AS execution_count,
           (SELECT coalesce(sum(actual_minutes), 0) FROM executions e WHERE e.task_id = t.id) AS actual_minutes,
           EXISTS (SELECT 1 FROM executions e WHERE e.task_id = t.id AND trim(e.blocker) <> '') AS blocked
         FROM tasks t WHERE ${where.join(' AND ')} ORDER BY ${SORTS[sortKey].sql}`
      )
      .bind(...args),
    db
      .prepare(
        `SELECT DISTINCT g.tag FROM task_tags g JOIN tasks t ON t.id = g.task_id
         WHERE t.plan_id = ? AND t.deleted_at IS NULL ORDER BY g.tag`
      )
      .bind(planId),
  ]);
  return {
    tasks: rows.results.map(shapeTask),
    sort: { key: sortKey, label: SORTS[sortKey].label },
    today,
    tags: allTags.results.map((r) => r.tag),
  };
}

async function createTask(db, planId, b) {
  await getPlan(db, planId);
  const t = readTaskInput(b);
  const now = nowIso();
  const results = await db.batch([
    db
      .prepare(
        `INSERT INTO tasks (plan_id, title, memo, due_date, priority, estimated_minutes, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`
      )
      .bind(planId, t.title, t.memo, t.due_date, t.priority, t.estimated_minutes, now, now),
    // 태그를 넣을 때마다 last_insert_rowid()가 바뀌므로, 같은 트랜잭션 안에서 방금 만든 할 일 ID(max)를 쓴다.
    ...tagStatements(db, '(SELECT max(id) FROM tasks)', null, t.tags),
  ]);
  return { id: results[0].results[0].id };
}

async function taskDetail(db, taskId) {
  const task = await getTask(db, taskId);
  const [plan, execs, comps] = await db.batch([
    db.prepare('SELECT id, title FROM plans WHERE id = ?').bind(task.plan_id),
    db.prepare('SELECT * FROM executions WHERE task_id = ? ORDER BY started_at DESC, id DESC').bind(taskId),
    db.prepare('SELECT * FROM completions WHERE task_id = ? ORDER BY id DESC').bind(taskId),
  ]);
  return { task, plan: plan.results[0], executions: execs.results, completions: comps.results };
}

async function updateTask(db, taskId, b) {
  await getTask(db, taskId);
  const t = readTaskInput(b);
  await db.batch([
    db
      .prepare(
        `UPDATE tasks SET title = ?, memo = ?, due_date = ?, priority = ?, estimated_minutes = ?, updated_at = ?
         WHERE id = ? AND deleted_at IS NULL`
      )
      .bind(t.title, t.memo, t.due_date, t.priority, t.estimated_minutes, nowIso(), taskId),
    ...tagStatements(db, null, taskId, t.tags),
  ]);
  return { id: taskId };
}

async function deleteTask(db, taskId) {
  await getTask(db, taskId);
  const now = nowIso();
  await db.prepare('UPDATE tasks SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL')
    .bind(now, now, taskId).run();
  return { id: taskId, deleted: true };
}

// 완료: 버튼을 몇 번 눌러도, 요청이 동시에 와도 완료 기록은 한 건.
//  1) 같은 Idempotency-Key 요청은 이전 결과를 돌려준다.
//  2) completions의 UNIQUE(task_id, cycle)가 같은 완료 주기의 두 번째 기록을 막는다.
async function completeTask(db, taskId, request) {
  const key = (request.headers.get('idempotency-key') || '').trim();
  if (!/^[A-Za-z0-9-]{8,64}$/.test(key)) throw new HttpError(400, 'Idempotency-Key 헤더가 필요합니다.');
  const task = await getTask(db, taskId);

  const seen = await db.prepare('SELECT * FROM completions WHERE idem_key = ?').bind(key).first();
  if (seen) {
    if (seen.task_id !== taskId) throw new HttpError(409, '이 요청 키는 다른 할 일에 이미 쓰였습니다.');
    return { id: taskId, status: 'done', duplicate: true, completion_id: seen.id };
  }

  const now = nowIso();
  const [ins] = await db.batch([
    db
      .prepare(
        `INSERT INTO completions (task_id, cycle, idem_key, completed_at)
         SELECT id, reopen_count, ?, ? FROM tasks WHERE id = ? AND status = 'todo' AND deleted_at IS NULL
         ON CONFLICT DO NOTHING RETURNING id`
      )
      .bind(key, now, taskId),
    db
      .prepare(
        `UPDATE tasks SET status = 'done', completed_at = ?, updated_at = ?
         WHERE id = ? AND status = 'todo' AND deleted_at IS NULL`
      )
      .bind(now, now, taskId),
  ]);
  const created = ins.results[0];
  return {
    id: taskId,
    status: 'done',
    duplicate: !created,
    completion_id: created ? created.id : null,
    was_already_done: task.status === 'done',
  };
}

async function reopenTask(db, taskId) {
  await getTask(db, taskId);
  const now = nowIso();
  await db.batch([
    db
      .prepare(
        `UPDATE completions SET reverted_at = ?
         WHERE task_id = ? AND reverted_at IS NULL
           AND cycle = (SELECT reopen_count FROM tasks WHERE id = ? AND status = 'done')`
      )
      .bind(now, taskId, taskId),
    db
      .prepare(
        `UPDATE tasks SET status = 'todo', completed_at = NULL, reopen_count = reopen_count + 1, updated_at = ?
         WHERE id = ? AND status = 'done' AND deleted_at IS NULL`
      )
      .bind(now, taskId),
  ]);
  return { id: taskId, status: 'todo' };
}

// ---------- 실행 기록 ----------

async function createExecution(db, taskId, b) {
  await getTask(db, taskId);
  const started = instant(b.started_at, '시작 시각');
  const ended = instant(b.ended_at, '끝난 시각');
  if (ended < started) throw new HttpError(400, '끝난 시각은 시작 시각보다 앞설 수 없습니다.');
  let actual = minutes(b.actual_minutes, '실제로 걸린 시간');
  if (actual === null) actual = Math.round((Date.parse(ended) - Date.parse(started)) / 60000);
  const blocker = text(b.blocker, '막혔던 이유', { max: 1000 });
  const note = text(b.note, '메모', { max: 1000 });
  // 실행 기록 표에만 넣는다. 계획·할 일의 값은 바꾸지 않는다.
  const row = await db
    .prepare(
      `INSERT INTO executions (task_id, started_at, ended_at, actual_minutes, blocker, note, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id`
    )
    .bind(taskId, started, ended, actual, blocker, note, nowIso())
    .first();
  return { id: row.id };
}

async function deleteExecution(db, execId) {
  const res = await db.prepare('DELETE FROM executions WHERE id = ?').bind(execId).run();
  if (!res.meta.changes) throw new HttpError(404, '실행 기록을 찾을 수 없습니다.');
  return { id: execId, deleted: true };
}

// ---------- 돌아보기 ----------

async function computeReview(db, planId, from, to) {
  const plan = await getPlan(db, planId);
  from = date(from, '기간 시작');
  to = date(to, '기간 끝');
  if (from && to && to < from) throw new HttpError(400, '기간 끝이 기간 시작보다 앞설 수 없습니다.');
  const today = seoulToday();

  const where = ['t.plan_id = ?', 't.deleted_at IS NULL'];
  const args = [planId];
  if (from) { where.push('t.due_date >= ?'); args.push(from); }
  if (to) { where.push('t.due_date <= ?'); args.push(to); }
  const scope = where.join(' AND ');

  const [taskRows, execRows] = await db.batch([
    db
      .prepare(`SELECT t.id, t.title, t.status, t.due_date, t.priority, t.estimated_minutes FROM tasks t WHERE ${scope} ORDER BY t.id`)
      .bind(...args),
    db
      .prepare(
        `SELECT e.*, t.title AS task_title FROM executions e JOIN tasks t ON t.id = e.task_id
         WHERE ${scope} ORDER BY e.started_at, e.id`
      )
      .bind(...args),
  ]);
  const tasks = taskRows.results;
  const execs = execRows.results;

  const blockedIds = new Set(execs.filter((e) => e.blocker && e.blocker.trim()).map((e) => e.task_id));
  const ids = {
    planned: tasks.map((t) => t.id),
    done: tasks.filter((t) => t.status === 'done').map((t) => t.id),
    // 완료한 할 일은 지연으로 세지 않는다.
    late: tasks.filter((t) => t.status !== 'done' && t.due_date && t.due_date < today).map((t) => t.id),
    blocked: tasks.filter((t) => blockedIds.has(t.id)).map((t) => t.id),
  };
  const estimated = tasks.reduce((s, t) => s + (t.estimated_minutes || 0), 0);
  const actual = execs.reduce((s, e) => s + (e.actual_minutes || 0), 0);

  return {
    plan: { id: plan.id, title: plan.title, start_date: plan.start_date, end_date: plan.end_date },
    period: { from, to },
    today,
    counts: {
      planned: ids.planned.length,
      done: ids.done.length,
      late: ids.late.length,
      blocked: ids.blocked.length,
      estimated_minutes: estimated,
      actual_minutes: actual,
      diff_minutes: actual - estimated,
    },
    ids,
    tasks,
    executions: execs,
  };
}

async function createReview(db, planId, b) {
  const r = await computeReview(db, planId, b.period_from, b.period_to);
  const improvement = text(b.improvement, '고칠 점', { required: true, max: 300 });
  const snapshot = { counts: r.counts, ids: r.ids, today: r.today };
  const row = await db
    .prepare(
      `INSERT INTO reviews (plan_id, period_from, period_to, snapshot_json, improvement, created_at)
       VALUES (?, ?, ?, ?, ?, ?) RETURNING id`
    )
    .bind(planId, r.period.from, r.period.to, JSON.stringify(snapshot), improvement, nowIso())
    .first();
  return { id: row.id };
}

async function getReview(db, reviewId) {
  const r = await db.prepare('SELECT * FROM reviews WHERE id = ?').bind(reviewId).first();
  if (!r) throw new HttpError(404, '돌아보기를 찾을 수 없습니다.');
  const used = await db.prepare('SELECT id FROM plans WHERE carried_from_review_id = ?').bind(reviewId).first();
  return { review: { ...r, snapshot: JSON.parse(r.snapshot_json) }, next_plan_id: used ? used.id : null };
}

// ---------- 내보내기 ----------

async function exportAll(db) {
  const names = ['plans', 'plan_revisions', 'tasks', 'task_tags', 'completions', 'executions', 'reviews'];
  const results = await db.batch(names.map((n) => db.prepare(`SELECT * FROM ${n} ORDER BY rowid`)));
  const data = {
    schema: SCHEMA_VERSION,
    exported_at: nowIso(),
    rules: {
      instants: 'UTC ISO-8601 (…_at)',
      dates: 'YYYY-MM-DD, Asia/Seoul 달력 기준',
      durations: '정수, 분(minute)',
      priority: PRIORITY_LABEL,
    },
    tables: Object.fromEntries(names.map((n, i) => [n, results[i].results])),
  };
  const stamp = seoulToday().replace(/-/g, '');
  return new Response(JSON.stringify(data, null, 2), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'content-disposition': `attachment; filename="pds-diary-export-${stamp}.json"`,
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    },
  });
}

// ---------- 라우팅 ----------

async function route(request, env) {
  const url = new URL(request.url);
  const db = env.DB;
  const m = request.method;
  const parts = url.pathname.replace(/^\/api\/?/, '').split('/').filter(Boolean);
  const [a, b, c] = parts;

  if (a === 'plans' && !b) {
    if (m === 'GET') return listPlans(db);
    if (m === 'POST') return createPlan(db, await body(request));
  }
  if (a === 'plans' && b && !c) {
    if (m === 'GET') return planDetail(db, id(b));
    if (m === 'PUT') return updatePlan(db, id(b), await body(request));
  }
  if (a === 'plans' && b && c === 'tasks' && parts.length === 3) {
    if (m === 'GET') return listTasks(db, id(b), url);
    if (m === 'POST') return createTask(db, id(b), await body(request));
  }
  if (a === 'plans' && b && c === 'review' && m === 'GET') {
    return computeReview(db, id(b), url.searchParams.get('from'), url.searchParams.get('to'));
  }
  if (a === 'plans' && b && c === 'reviews' && m === 'POST') {
    return createReview(db, id(b), await body(request));
  }
  if (a === 'reviews' && b && !c && m === 'GET') return getReview(db, id(b));
  if (a === 'tasks' && b && !c) {
    if (m === 'GET') return taskDetail(db, id(b));
    if (m === 'PUT') return updateTask(db, id(b), await body(request));
    if (m === 'DELETE') return deleteTask(db, id(b));
  }
  if (a === 'tasks' && b && m === 'POST') {
    if (c === 'complete') return completeTask(db, id(b), request);
    if (c === 'reopen') return reopenTask(db, id(b));
    if (c === 'executions') return createExecution(db, id(b), await body(request));
  }
  if (a === 'executions' && b && !c && m === 'DELETE') return deleteExecution(db, id(b));
  if (a === 'export' && m === 'GET') return exportAll(db);
  throw new HttpError(404, '없는 주소입니다.');
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    try {
      const out = await route(request, env);
      return out instanceof Response ? out : json(out);
    } catch (err) {
      if (err instanceof HttpError) return json({ error: err.message }, err.status);
      // 내부 오류 내용은 화면·응답에 내보내지 않는다.
      console.error('api error', err && err.stack ? err.stack : err);
      return json({ error: '서버에서 처리하지 못했습니다. 잠시 뒤 다시 시도해 주세요.' }, 500);
    }
  },
};
