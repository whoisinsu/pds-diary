# 플랜두씨 다이어리 1 — 내 계획과 실제를 담는 앱

계획(Plan) → 실제로 한 일(Do) → 돌아보기(See)가 하나로 이어지는 다이어리입니다.

> **공개 안내** — 지금은 로그인이 없어 링크를 아는 사람은 누구나 볼 수 있습니다. 남이 봐도 괜찮은 내용만 넣으세요. 잠그는 일은 7번 과제에서 합니다.

- 결과물: https://pds-diary.plandosee-diary.workers.dev
- 소스: https://github.com/whoisinsu/pds-diary

## 구조

| 부분 | 쓰는 것 |
|---|---|
| 화면 | `public/` — HTML·CSS·JS만 씀(빌드 없음), 사용자 글은 `textContent`로만 넣음 |
| API | `src/worker.js` — Cloudflare Worker, `/api/*` |
| DB | Cloudflare D1(SQLite) — `migrations/0001_init.sql` |
| 계약 | `contracts/pds-schema-v2.json` — 표·항목·관계·날짜 규칙 |
| 점검 | `tests/check.mjs` — 통과 기준 점검(로컬 서버 전용: `node tests/check.mjs`) |

- 계획을 고치면 `plans`의 지금 값이 바뀌고, 바뀐 내용이 `plan_revisions`에 새 판으로 쌓입니다. 1판(처음 세운 계획)은 남아 있습니다.
- 완료는 `Idempotency-Key` 헤더와 `completions`의 `UNIQUE(task_id, cycle)` 제약으로 한 번만 기록됩니다. 버튼 잠금에만 기대지 않습니다.
- 실행 기록은 `executions`에만 들어가고 계획과 할 일의 예상 값은 건드리지 않습니다.
- 거르기와 정렬은 서버 SQL에서 합니다. 값이 같으면 항상 할 일 ID로 순서를 정합니다.
- 코드에는 비밀키가 없습니다. D1은 Worker 바인딩(`env.DB`)으로 붙고, `database_id`는 비밀키가 아닙니다.

## 배포

```bash
npm install
npx wrangler login
npx wrangler d1 create pds-diary        # 출력된 database_id를 wrangler.toml에 넣기
npm run db:migrate:remote
npm run deploy
```

## 짧은 확인 방법

1. **어디로 가나요** — 결과물 주소를 새 시크릿 창으로 엽니다.
2. **세 단계 안에 무엇을 하나요** — ① 계획을 눌러 할 일에서 `완료`를 누릅니다 → ② 할 일 화면에서 `점검: 완료 요청을 연달아 두 번 보내 보기`를 실행합니다 → ③ `돌아보기`에서 숫자 하나를 누릅니다.
3. **무엇이 보이면 통과인가요** — 첫 화면의 공개 안내, "기록 1건, 집계 1만 늘었습니다", 그 숫자가 나온 할 일·실행 기록 목록이 보입니다.
4. **안 될 때는 무엇이 보이나요** — 빨간 글씨 오류 문구(예: "서버에 연결하지 못했습니다")가 보이거나, 목록이 비어 "아직 계획이 없습니다"가 보입니다.

## AI와 내 판단

1. **AI에게 맡긴 일** — (직접 적기)
2. **내가 직접 판단한 일** — (직접 적기)
3. **AI 제안을 따르지 않은 일** — (직접 적기. 없었다면 왜 없었는지)
