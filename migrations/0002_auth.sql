-- 플랜두씨 다이어리 2 — 인증과 5일 기록
-- 날짜 규칙은 0001과 같다: …_at = UTC ISO-8601, 날짜 = 서울 'YYYY-MM-DD'.

-- 계정: 아이디만 받는다(이메일·실명 없음). 비밀번호는 PBKDF2-SHA256 결과만 저장한다.
--   password_hash = 'pbkdf2_sha256$<반복 횟수>$<소금값 base64>$<결과 base64>'
CREATE TABLE users (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  username            TEXT    NOT NULL UNIQUE COLLATE NOCASE,
  password_hash       TEXT    NOT NULL,
  password_changed_at TEXT    NOT NULL,
  created_at          TEXT    NOT NULL
);

-- 세션: 브라우저에는 무작위 값을, DB에는 그 값의 SHA-256만 둔다.
-- 로그아웃·비밀번호 변경·계정 삭제 때 행을 지우면 그 값은 더는 통하지 않는다.
CREATE TABLE sessions (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id),
  token_hash TEXT    NOT NULL UNIQUE,
  created_at TEXT    NOT NULL,
  expires_at TEXT    NOT NULL
);
CREATE INDEX idx_sessions_user ON sessions(user_id);

-- 계획의 주인. 할 일·실행 기록·완료 기록·돌아보기는 계획을 거쳐 주인을 따른다.
-- 6번 때 만든 계획은 user_id가 비어 있고, 누구에게도 보이지 않는다(내 계정으로 옮기기 전까지).
ALTER TABLE plans ADD COLUMN user_id INTEGER REFERENCES users(id);
CREATE INDEX idx_plans_user ON plans(user_id);

-- 5일 기록: 1일차에 질문·지표·단위·규칙을 한 번만 정한다(고칠 수 없음).
CREATE TABLE experiments (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id        INTEGER NOT NULL UNIQUE REFERENCES users(id),
  question       TEXT    NOT NULL,
  metric         TEXT    NOT NULL,
  unit           TEXT    NOT NULL,
  calc_rule      TEXT    NOT NULL,
  plan_rule      TEXT    NOT NULL,   -- 1~2일차에 따르는 계획 규칙
  missing_rule   TEXT    NOT NULL,
  duplicate_rule TEXT    NOT NULL,
  outlier_rule   TEXT    NOT NULL,
  rounding_rule  TEXT    NOT NULL,
  week_start     TEXT    NOT NULL,
  created_at     TEXT    NOT NULL
);

-- 하루 기록: 날짜는 서버가 서울 기준 오늘로 정한다. 같은 날 두 번 저장되지 않는다.
CREATE TABLE daily_logs (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  experiment_id INTEGER NOT NULL REFERENCES experiments(id),
  day_no        INTEGER NOT NULL CHECK (day_no BETWEEN 1 AND 5),
  log_date      TEXT    NOT NULL,
  value         REAL,               -- NULL = 그날 값이 빠짐
  plan_rule     TEXT    NOT NULL,   -- 그날 따른 계획 규칙(저장 순간의 규칙)
  note          TEXT    NOT NULL DEFAULT '',
  created_at    TEXT    NOT NULL,
  updated_at    TEXT    NOT NULL,
  UNIQUE (experiment_id, log_date),
  UNIQUE (experiment_id, day_no)
);

-- 계획 규칙 변경: 실험마다 한 번, 2일차 기록 뒤·3일차 기록 앞에만.
CREATE TABLE rule_changes (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  experiment_id INTEGER NOT NULL UNIQUE REFERENCES experiments(id),
  day1_log_id   INTEGER NOT NULL REFERENCES daily_logs(id),
  day2_log_id   INTEGER NOT NULL REFERENCES daily_logs(id),
  old_rule      TEXT    NOT NULL,
  new_rule      TEXT    NOT NULL,
  reason        TEXT    NOT NULL,
  changed_at    TEXT    NOT NULL
);
