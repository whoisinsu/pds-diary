// 다이어리: 계획·할 일·완료·실행 기록·돌아보기
//
// 주인 확인 규칙(모든 함수 공통)
//  * uid는 세션에서만 온다. 주소·헤더·본문에 적힌 user_id는 읽지 않는다.
//  * 계획은 plans.user_id = uid 일 때만 보인다. 할 일·실행 기록·완료 기록·돌아보기는 계획을 거쳐 확인한다.
//  * 남의 자료이거나 없는 자료면 똑같이 404를 준다(존재 자체를 감춤).
//  * 확인을 먼저 하고, 쓰기 문장에도 주인 조건을 한 번 더 건다.

import {
  HttpError, nowIso, seoulToday, text, date, instant, minutes, priority, tags, id, likeEscape,
} from './util.js';

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

// 내 할 일 ID 집합(쓰기 문장의 주인 조건에 쓴다)
const MY_TASKS = 'SELECT t.id FROM tasks t JOIN plans p ON p.id = t.plan_id WHERE p.user_id = ?';

// ---------- 주인 확인 ----------

export async function getPlan(db, uid, planId) {
  const plan = await db.prepare('SELECT * FROM plans WHERE id = ? AND user_id = ?').bind(planId, uid).first();
  if (!plan) throw new HttpError(404, '계획을 찾을 수 없습니다.');
  return plan;
}

async function getTask(db, uid, taskId) {
  const task = await db
    .prepare(
      `SELECT t.*, (SELECT group_concat(tag, char(31)) FROM task_tags WHERE task_id = t.id) AS tag_list
       FROM tasks t JOIN plans p ON p.id = t.plan_id
       WHERE t.id = ? AND p.user_id = ? AND t.deleted_at IS NULL`
    )
    .bind(taskId, uid)
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
export async function listPlans(db, uid) {
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
       FROM plans p WHERE p.user_id = ? ORDER BY p.id DESC`
    )
    .bind(today, uid)
    .all();
  return { plans: results, today };
}

export async function createPlan(db, uid, b) {
  const p = readPlanInput(b);
  const now = nowIso();
  let carriedId = null;
  let carriedNote = null;
  if (b.carried_from_review_id) {
    carriedId = id(b.carried_from_review_id);
    const review = await db
      .prepare('SELECT r.* FROM reviews r JOIN plans p ON p.id = r.plan_id WHERE r.id = ? AND p.user_id = ?')
      .bind(carriedId, uid)
      .first();
    if (!review) throw new HttpError(400, '넘겨받을 돌아보기를 찾을 수 없습니다.');
    const used = await db.prepare('SELECT id FROM plans WHERE carried_from_review_id = ?').bind(carriedId).first();
    if (used) throw new HttpError(409, `이 고칠 점은 이미 계획 #${used.id}(으)로 넘어갔습니다.`);
    carriedNote = review.improvement;
  }
  const [ins] = await db.batch([
    db
      .prepare(
        `INSERT INTO plans (user_id, title, start_date, end_date, priority, success_criteria, estimated_minutes,
           current_rev, carried_from_review_id, carried_note, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?) RETURNING id`
      )
      .bind(uid, p.title, p.start_date, p.end_date, p.priority, p.success_criteria, p.estimated_minutes,
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

export async function planDetail(db, uid, planId) {
  const plan = await getPlan(db, uid, planId);
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

export async function updatePlan(db, uid, planId, b) {
  await getPlan(db, uid, planId);
  const p = readPlanInput(b);
  const note = text(b.change_note, '고친 이유', { max: 500 });
  const now = nowIso();
  await db.batch([
    db
      .prepare(
        `UPDATE plans SET title = ?, start_date = ?, end_date = ?, priority = ?, success_criteria = ?,
           estimated_minutes = ?, current_rev = current_rev + 1, updated_at = ? WHERE id = ? AND user_id = ?`
      )
      .bind(p.title, p.start_date, p.end_date, p.priority, p.success_criteria, p.estimated_minutes, now, planId, uid),
    db
      .prepare(
        `INSERT INTO plan_revisions (plan_id, rev_no, title, start_date, end_date, priority,
           success_criteria, estimated_minutes, change_note, created_at)
         SELECT id, current_rev, title, start_date, end_date, priority, success_criteria, estimated_minutes, ?, ?
         FROM plans WHERE id = ? AND user_id = ?`
      )
      .bind(note, now, planId, uid),
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

export async function listTasks(db, uid, planId, url) {
  await getPlan(db, uid, planId);
  const q = (url.searchParams.get('q') || '').trim();
  const status = url.searchParams.get('status') || 'all';
  const prio = url.searchParams.get('priority') || '';
  const tag = (url.searchParams.get('tag') || '').trim();
  const sortKey = SORTS[url.searchParams.get('sort')] ? url.searchParams.get('sort') : 'due';
  const today = seoulToday();

  // 주인 조건을 목록 쿼리에도 직접 건다(계획 확인과 별개로).
  const where = ['t.plan_id = ?', 'p.user_id = ?', 't.deleted_at IS NULL'];
  const args = [planId, uid];
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
         FROM tasks t JOIN plans p ON p.id = t.plan_id
         WHERE ${where.join(' AND ')} ORDER BY ${SORTS[sortKey].sql}`
      )
      .bind(...args),
    db
      .prepare(
        `SELECT DISTINCT g.tag FROM task_tags g JOIN tasks t ON t.id = g.task_id JOIN plans p ON p.id = t.plan_id
         WHERE t.plan_id = ? AND p.user_id = ? AND t.deleted_at IS NULL ORDER BY g.tag`
      )
      .bind(planId, uid),
  ]);
  return {
    tasks: rows.results.map(shapeTask),
    sort: { key: sortKey, label: SORTS[sortKey].label },
    today,
    tags: allTags.results.map((r) => r.tag),
  };
}

export async function createTask(db, uid, planId, b) {
  await getPlan(db, uid, planId);
  const t = readTaskInput(b);
  const now = nowIso();
  const results = await db.batch([
    db
      .prepare(
        `INSERT INTO tasks (plan_id, title, memo, due_date, priority, estimated_minutes, created_at, updated_at)
         SELECT id, ?, ?, ?, ?, ?, ?, ? FROM plans WHERE id = ? AND user_id = ? RETURNING id`
      )
      .bind(t.title, t.memo, t.due_date, t.priority, t.estimated_minutes, now, now, planId, uid),
    // 태그를 넣을 때마다 last_insert_rowid()가 바뀌므로, 같은 트랜잭션 안에서 방금 만든 할 일 ID(max)를 쓴다.
    ...t.tags.map((tag) => db.prepare('INSERT INTO task_tags (task_id, tag) VALUES ((SELECT max(id) FROM tasks), ?)').bind(tag)),
  ]);
  return { id: results[0].results[0].id };
}

export async function taskDetail(db, uid, taskId) {
  const task = await getTask(db, uid, taskId);
  const [plan, execs, comps] = await db.batch([
    db.prepare('SELECT id, title FROM plans WHERE id = ? AND user_id = ?').bind(task.plan_id, uid),
    db.prepare('SELECT * FROM executions WHERE task_id = ? ORDER BY started_at DESC, id DESC').bind(taskId),
    db.prepare('SELECT * FROM completions WHERE task_id = ? ORDER BY id DESC').bind(taskId),
  ]);
  return { task, plan: plan.results[0], executions: execs.results, completions: comps.results };
}

export async function updateTask(db, uid, taskId, b) {
  await getTask(db, uid, taskId);
  const t = readTaskInput(b);
  await db.batch([
    db
      .prepare(
        `UPDATE tasks SET title = ?, memo = ?, due_date = ?, priority = ?, estimated_minutes = ?, updated_at = ?
         WHERE id = ? AND deleted_at IS NULL AND id IN (${MY_TASKS})`
      )
      .bind(t.title, t.memo, t.due_date, t.priority, t.estimated_minutes, nowIso(), taskId, uid),
    db.prepare(`DELETE FROM task_tags WHERE task_id = ? AND task_id IN (${MY_TASKS})`).bind(taskId, uid),
    ...t.tags.map((tag) =>
      db.prepare(`INSERT INTO task_tags (task_id, tag) SELECT ?, ? WHERE ? IN (${MY_TASKS})`).bind(taskId, tag, taskId, uid)),
  ]);
  return { id: taskId };
}

export async function deleteTask(db, uid, taskId) {
  await getTask(db, uid, taskId);
  const now = nowIso();
  await db
    .prepare(`UPDATE tasks SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL AND id IN (${MY_TASKS})`)
    .bind(now, now, taskId, uid)
    .run();
  return { id: taskId, deleted: true };
}

// 완료: 버튼을 몇 번 눌러도, 요청이 동시에 와도 완료 기록은 한 건.
//  1) 같은 Idempotency-Key 요청은 이전 결과를 돌려준다.
//  2) completions의 UNIQUE(task_id, cycle)가 같은 완료 주기의 두 번째 기록을 막는다.
export async function completeTask(db, uid, taskId, request) {
  const key = (request.headers.get('idempotency-key') || '').trim();
  if (!/^[A-Za-z0-9-]{8,64}$/.test(key)) throw new HttpError(400, 'Idempotency-Key 헤더가 필요합니다.');
  const task = await getTask(db, uid, taskId);

  const seen = await db.prepare('SELECT * FROM completions WHERE idem_key = ?').bind(key).first();
  if (seen) {
    if (seen.task_id !== taskId) throw new HttpError(409, '이 요청 키는 이미 쓰였습니다. 화면을 새로 읽어 주세요.');
    return { id: taskId, status: 'done', duplicate: true, completion_id: seen.id };
  }

  const now = nowIso();
  const [ins] = await db.batch([
    db
      .prepare(
        `INSERT INTO completions (task_id, cycle, idem_key, completed_at)
         SELECT id, reopen_count, ?, ? FROM tasks
         WHERE id = ? AND status = 'todo' AND deleted_at IS NULL AND id IN (${MY_TASKS})
         ON CONFLICT DO NOTHING RETURNING id`
      )
      .bind(key, now, taskId, uid),
    db
      .prepare(
        `UPDATE tasks SET status = 'done', completed_at = ?, updated_at = ?
         WHERE id = ? AND status = 'todo' AND deleted_at IS NULL AND id IN (${MY_TASKS})`
      )
      .bind(now, now, taskId, uid),
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

export async function reopenTask(db, uid, taskId) {
  await getTask(db, uid, taskId);
  const now = nowIso();
  await db.batch([
    db
      .prepare(
        `UPDATE completions SET reverted_at = ?
         WHERE task_id = ? AND reverted_at IS NULL AND task_id IN (${MY_TASKS})
           AND cycle = (SELECT reopen_count FROM tasks WHERE id = ? AND status = 'done')`
      )
      .bind(now, taskId, uid, taskId),
    db
      .prepare(
        `UPDATE tasks SET status = 'todo', completed_at = NULL, reopen_count = reopen_count + 1, updated_at = ?
         WHERE id = ? AND status = 'done' AND deleted_at IS NULL AND id IN (${MY_TASKS})`
      )
      .bind(now, taskId, uid),
  ]);
  return { id: taskId, status: 'todo' };
}

// ---------- 실행 기록 ----------

export async function createExecution(db, uid, taskId, b) {
  await getTask(db, uid, taskId);
  const started = instant(b.started_at, '시작 시각');
  const ended = instant(b.ended_at, '끝난 시각');
  if (ended < started) throw new HttpError(400, '끝난 시각은 시작 시각보다 앞설 수 없습니다.');
  let actual = minutes(b.actual_minutes, '실제로 걸린 시간');
  if (actual === null) actual = Math.round((Date.parse(ended) - Date.parse(started)) / 60000);
  const blocker = text(b.blocker, '막혔던 이유', { max: 1000 });
  const note = text(b.note, '메모', { max: 1000 });
  const row = await db
    .prepare(
      `INSERT INTO executions (task_id, started_at, ended_at, actual_minutes, blocker, note, created_at)
       SELECT ?, ?, ?, ?, ?, ?, ? WHERE ? IN (${MY_TASKS}) RETURNING id`
    )
    .bind(taskId, started, ended, actual, blocker, note, nowIso(), taskId, uid)
    .first();
  return { id: row.id };
}

export async function deleteExecution(db, uid, execId) {
  const res = await db
    .prepare(`DELETE FROM executions WHERE id = ? AND task_id IN (${MY_TASKS})`)
    .bind(execId, uid)
    .run();
  if (!res.meta.changes) throw new HttpError(404, '실행 기록을 찾을 수 없습니다.');
  return { id: execId, deleted: true };
}

// ---------- 돌아보기 ----------

export async function computeReview(db, uid, planId, from, to) {
  const plan = await getPlan(db, uid, planId);
  from = date(from, '기간 시작');
  to = date(to, '기간 끝');
  if (from && to && to < from) throw new HttpError(400, '기간 끝이 기간 시작보다 앞설 수 없습니다.');
  const today = seoulToday();

  const where = ['t.plan_id = ?', 'p.user_id = ?', 't.deleted_at IS NULL'];
  const args = [planId, uid];
  if (from) { where.push('t.due_date >= ?'); args.push(from); }
  if (to) { where.push('t.due_date <= ?'); args.push(to); }
  const scope = where.join(' AND ');

  const [taskRows, execRows] = await db.batch([
    db
      .prepare(`SELECT t.id, t.title, t.status, t.due_date, t.priority, t.estimated_minutes
                FROM tasks t JOIN plans p ON p.id = t.plan_id WHERE ${scope} ORDER BY t.id`)
      .bind(...args),
    db
      .prepare(
        `SELECT e.*, t.title AS task_title FROM executions e JOIN tasks t ON t.id = e.task_id JOIN plans p ON p.id = t.plan_id
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

export async function createReview(db, uid, planId, b) {
  const r = await computeReview(db, uid, planId, b.period_from, b.period_to);
  const improvement = text(b.improvement, '고칠 점', { required: true, max: 300 });
  const snapshot = { counts: r.counts, ids: r.ids, today: r.today };
  const row = await db
    .prepare(
      `INSERT INTO reviews (plan_id, period_from, period_to, snapshot_json, improvement, created_at)
       SELECT id, ?, ?, ?, ?, ? FROM plans WHERE id = ? AND user_id = ? RETURNING id`
    )
    .bind(r.period.from, r.period.to, JSON.stringify(snapshot), improvement, nowIso(), planId, uid)
    .first();
  return { id: row.id };
}

export async function getReview(db, uid, reviewId) {
  const r = await db
    .prepare('SELECT r.* FROM reviews r JOIN plans p ON p.id = r.plan_id WHERE r.id = ? AND p.user_id = ?')
    .bind(reviewId, uid)
    .first();
  if (!r) throw new HttpError(404, '돌아보기를 찾을 수 없습니다.');
  const used = await db.prepare('SELECT id FROM plans WHERE carried_from_review_id = ? AND user_id = ?').bind(reviewId, uid).first();
  return { review: { ...r, snapshot: JSON.parse(r.snapshot_json) }, next_plan_id: used ? used.id : null };
}

export { PRIORITY_LABEL };
