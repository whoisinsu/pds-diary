# 플랜두씨 다이어리 2 — 인증을 붙인 계획·실행·돌아보기 앱

계획(Plan) → 실제로 한 일(Do) → 돌아보기(See)가 하나로 이어지는 다이어리에, 가입·로그인을 붙여 내 자료를 나만 보게 했습니다.

- 결과물: https://pds-diary.plandosee-diary.workers.dev (첫 화면 = 로그인 화면, 계정 없이 열림)
- 소스: https://github.com/whoisinsu/pds-diary
- 이어서 쓴 6번 결과: 커밋 [`03ac8da`](https://github.com/whoisinsu/pds-diary/commit/03ac8dae3008580a01a37a981b99b2fed838d25f) — 같은 주소·같은 DB를 잠갔고, 6번 커밋은 7번 커밋들의 조상입니다.
- **인증 구현 설명서: [docs/auth.md](docs/auth.md)** · 배포본 확인 기록: [docs/evidence-live.md](docs/evidence-live.md)

## 구조

| 부분 | 쓰는 것 |
|---|---|
| 화면 | `public/` — HTML·CSS·JS만 씀(빌드 없음), 사용자 글은 `textContent`로만 넣음 |
| API 입구 | `src/worker.js` — Origin 확인 → 세션 확인 → 로그인 필요 → 각 기능 |
| 인증 | `src/auth.js` — PBKDF2-SHA256(Web Crypto) 비밀번호, 서버 세션(쿠키 `__Host-pds_session`) |
| 다이어리 | `src/diary.js` — 계획·할 일·완료·실행 기록·돌아보기, 모든 쿼리에 주인 조건 |
| 5일 기록 | `src/experiment.js` — 1일차 고정, 하루 한 번, 2일차 뒤·3일차 앞 규칙 변경 |
| DB | Cloudflare D1(SQLite) — `migrations/0001_init.sql`, `migrations/0002_auth.sql` |
| 점검 | `tests/check.mjs`(6번 기능), `tests/auth-check.mjs`(7번 인증·5일 기록, `--evidence`로 확인 기록 생성) |

비밀키: 코드·설정·Git 기록 어디에도 없습니다. 세션은 서명하지 않는 무작위 값이고, DB에는 그 해시만 저장합니다. `wrangler.toml`의 `database_id`는 접근 권한이 없는 이름표입니다.

## 배포

```bash
npm install
npx wrangler login
npx wrangler d1 migrations apply pds-diary --remote
npx wrangler deploy
```

## 짧은 확인 방법

1. **어디로 가나요** — https://pds-diary.plandosee-diary.workers.dev 를 새 시크릿 창으로 엽니다.
2. **세 단계 안에 무엇을 하나요** — ① 주소 끝에 `#/plan/1`을 붙여 열어 봅니다 → ② **가입하기**로 새 계정을 만듭니다 → ③ 오른쪽 위 **로그아웃**을 누른 뒤 뒤로 가기로 자료 화면을 다시 엽니다.
3. **무엇이 보이면 통과인가요** — ①과 ③에서 자료 대신 **로그인 화면**이 나오고, ②에서는 빈 "내 계획" 목록(남의 계획이 하나도 없음)이 보입니다.
4. **안 될 때는 무엇이 보이나요** — 로그인하지 않았는데 계획 목록이나 할 일이 보이거나, 가입 직후 목록에 다른 사람의 계획이 섞여 있습니다. 서버 오류면 빨간 글씨로 "서버에서 처리하지 못했습니다"가 뜹니다.

## AI와 내 판단

1. **AI에게 맡긴 일** — (직접 적기)
2. **내가 직접 판단한 일** — (직접 적기)
3. **AI 제안을 따르지 않은 일** — (직접 적기. 없었다면 왜 없었는지)
