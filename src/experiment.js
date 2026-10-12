// 5일 기록: 1일차에 질문·지표·단위·규칙을 고정하고, 서로 다른 5일을 기록한다.
// 계획 규칙은 2일차 기록 뒤·3일차 기록 앞에 한 번만 바꿀 수 있다.
//
//  * 날짜는 서버가 정한다(서울 기준 오늘). 사용자가 날짜를 고를 수 없다.
//  * 같은 날짜 두 번째 기록은 UNIQUE(experiment_id, log_date)가 막는다. 고치려면 그날 안에 고친다.
//  * 값이 빠진 날은 value = NULL로 남기고, 합계·평균에서 뺀다(0으로 치지 않는다).
//  * 반올림: 평균은 소수 둘째 자리에서 반올림해 첫째 자리까지(절댓값 기준 0.05 → 0.1).

import { HttpError, nowIso, text, id } from './util.js';

export const DEFAULT_RULES = {
  missing_rule: '그날 값을 적지 못하면 "빠짐"으로 기록하고, 합계와 평균에서 뺀다(0으로 치지 않는다). 평균의 분모는 값이 있는 날 수다.',
  duplicate_rule: '날짜마다 기록은 하나다. 같은 날 두 번째 저장은 거절되고, 고치려면 그날 안에 그날 기록을 고친다.',
  outlier_rule: '유난히 튀는 값도 지우거나 바꾸지 않고 그대로 계산에 넣는다. 대신 그날 메모에 왜 튀었는지 적는다.',
  rounding_rule: '평균은 소수 둘째 자리에서 반올림해 소수 첫째 자리까지 보인다(예: 12.25 → 12.3). 합계는 반올림하지 않는다.',
  week_start: '월요일',
};

export function round1(x) {
  if (x === null || x === undefined) return null;
  const s = Math.sign(x);
  // 부동소수 오차(예: 1.005*10)를 먼저 걷어 낸 뒤 반올림한다.
  return (s * Math.round(Number((Math.abs(x) * 10).toFixed(6)))) / 10;
}

function readValue(b) {
  if (b.missing === true || b.value === null || b.value === undefined || b.value === '') return null;
  const n = Number(b.value);
  if (!Number.isFinite(n) || Math.abs(n) > 1e6) throw new HttpError(400, '값은 숫자여야 합니다.');
  return round1(n); // 저장도 소수 첫째 자리까지
}

async function getExperiment(db, uid) {
  return db.prepare('SELECT * FROM experiments WHERE user_id = ?').bind(uid).first();
}

function summarize(logs) {
  const part = (rows) => {
    const vals = rows.filter((r) => r.value !== null).map((r) => r.value);
    const sum = round1(vals.reduce((s, v) => s + v, 0)); // 소수 첫째 자리 값끼리의 합 — 부동소수 오차만 걷어 낸다
    return {
      days: rows.map((r) => r.day_no),
      counted: vals.length,
      missing: rows.length - vals.length,
      values: vals,
      sum: vals.length ? sum : null,
      average: vals.length ? round1(sum / vals.length) : null,
    };
  };
  const before = part(logs.filter((l) => l.day_no <= 2));
  const after = part(logs.filter((l) => l.day_no >= 3));
  const all = part(logs);
  const change = before.average !== null && after.average !== null ? round1(after.average - before.average) : null;
  return { before, after, all, change_of_average: change };
}

export async function getState(db, uid, today) {
  const exp = await getExperiment(db, uid);
  if (!exp) return { experiment: null, defaults: DEFAULT_RULES, today };
  const [logs, rc] = await db.batch([
    db.prepare('SELECT * FROM daily_logs WHERE experiment_id = ? ORDER BY day_no').bind(exp.id),
    db.prepare('SELECT * FROM rule_changes WHERE experiment_id = ?').bind(exp.id),
  ]);
  const ruleChange = rc.results[0] || null;
  const list = logs.results;
  const todayLog = list.find((l) => l.log_date === today) || null;
  let next = 'log';
  if (list.length >= 5) next = 'done';
  else if (todayLog) next = 'wait';
  else if (list.length === 2 && !ruleChange) next = 'change_rule';
  return {
    experiment: exp,
    logs: list,
    rule_change: ruleChange,
    current_rule: ruleChange ? ruleChange.new_rule : exp.plan_rule,
    summary: summarize(list),
    today,
    today_log: todayLog,
    next,
  };
}

export async function createExperiment(db, uid, b, today) {
  if (await getExperiment(db, uid)) throw new HttpError(409, '5일 기록은 이미 시작했습니다. 1일차에 정한 내용은 고칠 수 없습니다.');
  const f = {
    question: text(b.question, '답하려는 질문', { required: true, max: 300 }),
    metric: text(b.metric, '관찰 지표', { required: true, max: 100 }),
    unit: text(b.unit, '단위', { required: true, max: 20 }),
    calc_rule: text(b.calc_rule, '계산 규칙', { required: true, max: 500 }),
    plan_rule: text(b.plan_rule, '계획 규칙', { required: true, max: 500 }),
    missing_rule: text(b.missing_rule || DEFAULT_RULES.missing_rule, '값이 빠졌을 때', { max: 500 }),
    duplicate_rule: text(b.duplicate_rule || DEFAULT_RULES.duplicate_rule, '값이 중복될 때', { max: 500 }),
    outlier_rule: text(b.outlier_rule || DEFAULT_RULES.outlier_rule, '값이 튈 때', { max: 500 }),
    rounding_rule: text(b.rounding_rule || DEFAULT_RULES.rounding_rule, '반올림', { max: 500 }),
    week_start: text(b.week_start || DEFAULT_RULES.week_start, '주 시작 요일', { max: 10 }),
  };
  const row = await db
    .prepare(
      `INSERT INTO experiments (user_id, question, metric, unit, calc_rule, plan_rule, missing_rule, duplicate_rule,
         outlier_rule, rounding_rule, week_start, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`
    )
    .bind(uid, f.question, f.metric, f.unit, f.calc_rule, f.plan_rule, f.missing_rule, f.duplicate_rule,
      f.outlier_rule, f.rounding_rule, f.week_start, nowIso())
    .first();
  return { id: row.id, today };
}

export async function addLog(db, uid, b, today) {
  const st = await getState(db, uid, today);
  if (!st.experiment) throw new HttpError(409, '먼저 1일차에 질문과 규칙을 정해 주세요.');
  if (st.next === 'done') throw new HttpError(409, '5일 기록을 모두 마쳤습니다.');
  if (st.next === 'wait') throw new HttpError(409, `오늘(${today})은 이미 기록했습니다. 같은 날 두 번 기록할 수 없습니다. 고치려면 오늘 기록을 고쳐 주세요.`);
  if (st.next === 'change_rule') throw new HttpError(409, '3일차를 적기 전에 계획 규칙을 한 번 바꿔 주세요.');
  const value = readValue(b);
  const note = text(b.note, '메모', { max: 1000 });
  const now = nowIso();
  try {
    const row = await db
      .prepare(
        `INSERT INTO daily_logs (experiment_id, day_no, log_date, value, plan_rule, note, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id, day_no, log_date`
      )
      .bind(st.experiment.id, st.logs.length + 1, today, value, st.current_rule, note, now, now)
      .first();
    return row;
  } catch (e) {
    if (String(e && e.message).includes('UNIQUE')) throw new HttpError(409, '이 날짜(또는 이 일차)는 이미 기록되어 있습니다.');
    throw e;
  }
}

export async function updateLog(db, uid, logId, b, today) {
  logId = id(logId);
  const row = await db
    .prepare('SELECT l.* FROM daily_logs l JOIN experiments x ON x.id = l.experiment_id WHERE l.id = ? AND x.user_id = ?')
    .bind(logId, uid)
    .first();
  if (!row) throw new HttpError(404, '기록을 찾을 수 없습니다.');
  if (row.log_date !== today) throw new HttpError(409, '지난 날짜의 기록은 고칠 수 없습니다. 그날 안에만 고칠 수 있습니다.');
  const value = readValue(b);
  const note = text(b.note, '메모', { max: 1000 });
  await db
    .prepare(
      `UPDATE daily_logs SET value = ?, note = ?, updated_at = ?
       WHERE id = ? AND experiment_id IN (SELECT id FROM experiments WHERE user_id = ?)`
    )
    .bind(value, note, nowIso(), logId, uid)
    .run();
  return { id: logId };
}

export async function changeRule(db, uid, b, today) {
  const st = await getState(db, uid, today);
  if (!st.experiment) throw new HttpError(409, '먼저 1일차에 질문과 규칙을 정해 주세요.');
  if (st.rule_change) throw new HttpError(409, '계획 규칙은 한 번만 바꿀 수 있고, 이미 바꿨습니다.');
  if (st.logs.length !== 2) throw new HttpError(409, '계획 규칙은 2일차 기록 뒤, 3일차 기록 앞에만 바꿀 수 있습니다.');
  const newRule = text(b.new_rule, '새 계획 규칙', { required: true, max: 500 });
  const reason = text(b.reason, '바꾼 이유', { required: true, max: 500 });
  if (newRule === st.experiment.plan_rule) throw new HttpError(400, '새 규칙이 지금 규칙과 같습니다.');
  const row = await db
    .prepare(
      `INSERT INTO rule_changes (experiment_id, day1_log_id, day2_log_id, old_rule, new_rule, reason, changed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id, changed_at`
    )
    .bind(st.experiment.id, st.logs[0].id, st.logs[1].id, st.experiment.plan_rule, newRule, reason, nowIso())
    .first();
  return row;
}
