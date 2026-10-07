-- 플랜두씨 다이어리 스키마 v2
-- 날짜 규칙
--   * 시각(…_at): UTC ISO-8601 문자열 (예: 2026-09-30T01:05:00.000Z). 화면에는 Asia/Seoul로 바꿔 보여 준다.
--   * 날짜(start_date, end_date, due_date, period_*): 서울 달력 기준 'YYYY-MM-DD' 문자열.
--   * 시간의 양(…_minutes): 정수, 단위는 분(minute). 저장·계산·표시 모두 분.

PRAGMA foreign_keys = ON;

-- 계획: 지금 값. 고칠 때마다 plan_revisions에 새 판이 쌓이고 id는 그대로다.
CREATE TABLE plans (
  id                     INTEGER PRIMARY KEY AUTOINCREMENT,
  title                  TEXT    NOT NULL,
  start_date             TEXT    NOT NULL,
  end_date               TEXT    NOT NULL,
  priority               INTEGER NOT NULL CHECK (priority IN (1, 2, 3)),  -- 1 높음 · 2 보통 · 3 낮음
  success_criteria       TEXT    NOT NULL,
  estimated_minutes      INTEGER NOT NULL CHECK (estimated_minutes >= 0),
  current_rev            INTEGER NOT NULL DEFAULT 1,
  carried_from_review_id INTEGER UNIQUE REFERENCES reviews(id),          -- 돌아보기 한 건은 다음 계획 하나로만 넘어간다
  carried_note           TEXT,
  created_at             TEXT    NOT NULL,
  updated_at             TEXT    NOT NULL,
  CHECK (end_date >= start_date)
);

-- 계획 수정 이력: rev_no 1이 처음 세운 계획. 한 번 쌓이면 고치지 않는다.
CREATE TABLE plan_revisions (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  plan_id           INTEGER NOT NULL REFERENCES plans(id),
  rev_no            INTEGER NOT NULL,
  title             TEXT    NOT NULL,
  start_date        TEXT    NOT NULL,
  end_date          TEXT    NOT NULL,
  priority          INTEGER NOT NULL,
  success_criteria  TEXT    NOT NULL,
  estimated_minutes INTEGER NOT NULL,
  change_note       TEXT,
  created_at        TEXT    NOT NULL,
  UNIQUE (plan_id, rev_no)
);

-- 할 일: 지울 때는 deleted_at만 채운다(돌아보기에서 제외).
CREATE TABLE tasks (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  plan_id           INTEGER NOT NULL REFERENCES plans(id),
  title             TEXT    NOT NULL,
  memo              TEXT    NOT NULL DEFAULT '',
  due_date          TEXT,
  priority          INTEGER NOT NULL CHECK (priority IN (1, 2, 3)),
  estimated_minutes INTEGER CHECK (estimated_minutes IS NULL OR estimated_minutes >= 0),
  status            TEXT    NOT NULL DEFAULT 'todo' CHECK (status IN ('todo', 'done')),
  completed_at      TEXT,
  reopen_count      INTEGER NOT NULL DEFAULT 0,  -- 되돌릴 때마다 +1. 완료 기록의 cycle과 짝을 이룬다.
  deleted_at        TEXT,
  created_at        TEXT    NOT NULL,
  updated_at        TEXT    NOT NULL
);
CREATE INDEX idx_tasks_plan ON tasks(plan_id, deleted_at);

CREATE TABLE task_tags (
  task_id INTEGER NOT NULL REFERENCES tasks(id),
  tag     TEXT    NOT NULL,
  PRIMARY KEY (task_id, tag)
);
CREATE INDEX idx_task_tags_tag ON task_tags(tag);

-- 완료 기록: (task_id, cycle)과 idem_key가 각각 UNIQUE라서
-- 완료 버튼을 두 번 눌러도 같은 완료 주기에는 한 건만 들어간다.
CREATE TABLE completions (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id      INTEGER NOT NULL REFERENCES tasks(id),
  cycle        INTEGER NOT NULL,
  idem_key     TEXT    NOT NULL UNIQUE,
  completed_at TEXT    NOT NULL,
  reverted_at  TEXT,
  UNIQUE (task_id, cycle)
);

-- 실행 기록: 실제로 한 일. 계획·할 일의 값은 건드리지 않는다.
CREATE TABLE executions (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id        INTEGER NOT NULL REFERENCES tasks(id),
  started_at     TEXT    NOT NULL,
  ended_at       TEXT    NOT NULL,
  actual_minutes INTEGER NOT NULL CHECK (actual_minutes >= 0),
  blocker        TEXT    NOT NULL DEFAULT '',
  note           TEXT    NOT NULL DEFAULT '',
  created_at     TEXT    NOT NULL,
  CHECK (ended_at >= started_at)
);
CREATE INDEX idx_executions_task ON executions(task_id);

-- 돌아보기: 저장 순간의 집계(snapshot_json)와 고칠 점 한 줄.
CREATE TABLE reviews (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  plan_id       INTEGER NOT NULL REFERENCES plans(id),
  period_from   TEXT,
  period_to     TEXT,
  snapshot_json TEXT    NOT NULL,
  improvement   TEXT    NOT NULL,
  created_at    TEXT    NOT NULL
);
CREATE INDEX idx_reviews_plan ON reviews(plan_id);
