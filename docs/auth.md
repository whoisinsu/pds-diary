# 인증 구현 설명서 — 플랜두씨 다이어리 2

- 결과물: https://pds-diary.plandosee-diary.workers.dev (첫 화면 = 로그인 화면)
- 소스: https://github.com/whoisinsu/pds-diary
- 이어서 쓴 6번 결과: 6번 제출 커밋 `03ac8dae3008580a01a37a981b99b2fed838d25f` (같은 저장소, 7번 커밋들의 조상) · 같은 주소·같은 D1 데이터베이스를 그대로 잠갔다.

> 이 문서의 비밀번호는 모두 `••••`로, 세션 값은 앞 6글자만 남기고 `…생략`으로 가렸다. 서명용 비밀키는 처음부터 없다(아래 ①).

---

## ① 무엇으로 붙였나

| 항목 | 고른 것 |
|---|---|
| 방식 | **직접 구현** (인증 서비스·인증 라이브러리 없이 Worker 코드로 가입·로그인·로그아웃·세션을 만듦) |
| 비밀번호 보관 | **PBKDF2-SHA256** — Web Crypto API(`crypto.subtle.deriveBits`), Cloudflare Workers 런타임 내장 · 반복 100,000회 · 계정마다 16바이트 무작위 소금값 · 결과 32바이트 |
| 사람 알아보기 | **서버 세션** — 무작위 32바이트 값(base64url)을 쿠키 `__Host-pds_session`(HttpOnly · Secure · SameSite=Lax · Path=/)로 준다. DB `sessions` 표에는 그 값의 SHA-256만 둔다 |
| 만료 | 로그인 뒤 **7일**(쿠키 Max-Age와 DB `expires_at` 둘 다). 로그아웃·비밀번호 변경·계정 삭제 때 서버에서 행을 지운다 |
| 실행 환경·버전 | Cloudflare Workers(`compatibility_date = 2025-09-01`) · D1(SQLite) · 배포 도구 wrangler 4.144.0 · 외부 npm 런타임 의존성 없음 |

암호 알고리즘(PBKDF2, SHA-256, 난수)은 직접 만들지 않았고 Workers에 들어 있는 Web Crypto 구현을 불렀다. 직접 만든 것은 그 함수를 부르는 흐름(가입·로그인·세션 표·쿠키)이다.

## ② 왜 그걸 골랐나

- **직접 구현을 고른 이유:** 6번 앱이 이미 Worker 하나 + D1 하나로 돌아가서, 같은 DB에 `users`·`sessions` 표를 더하면 주인 확인을 SQL 한 줄(`p.user_id = ?`)로 모든 조회에 걸 수 있었다. 외부 서비스를 붙이면 사용자 ID가 다른 시스템에 있고 그 ID를 매 요청 검증하는 연결 코드가 따로 생긴다.
- **PBKDF2를 고른 이유:** Workers에서 추가 패키지 없이 쓸 수 있는 유일한 "느린 비밀번호 해시"다. bcrypt·argon2·scrypt는 Workers에 내장돼 있지 않아 순수 JS 라이브러리를 써야 하고, 무료 요금제의 요청당 CPU 시간 제한 안에서 느리고 불안정하다.
- **세션(서버 저장)을 고른 이유:** 로그아웃·비밀번호 변경 때 "이전 값이 더는 통하지 않는다"를 DB 행 삭제 한 번으로 확실히 만들 수 있다. 서명 토큰(JWT)은 만료 전까지 서버가 끊을 수 없어서 끊으려면 결국 폐기 목록 표가 필요하다. 또 서명용 비밀키를 둘 필요가 없어 비밀키가 새어 나갈 곳 자체가 없다.

**함께 검토했지만 고르지 않은 방법**

| 방법 | 고르지 않은 이유 |
|---|---|
| Cloudflare Access (인증 서비스) | 심사하는 사람이 결과물 첫 화면(로그인 화면)을 계정 없이 열 수 있어야 하는데, Access는 앱 앞에서 Cloudflare 로그인 화면을 먼저 띄워 그 조건을 깬다. |
| Auth0·Clerk 같은 외부 인증 서비스 | 별도 가입·OAuth 설정이 필요하고, 사용자 ID가 D1 밖에 있어 매 요청 토큰 검증과 ID 연결 코드가 따로 생긴다. 이 과제 규모에 비해 움직이는 부분이 많다. |
| JWT(서명 토큰) | 로그아웃해도 만료 전까지 서버가 끊을 수 없다(C114를 지키려면 폐기 목록이 필요). 서명용 비밀키도 관리해야 한다. |
| bcryptjs (순수 JS bcrypt 라이브러리) | Workers 무료 요금제의 요청당 CPU 시간 제한에서 비용 계수를 충분히 높이기 어렵다. 내장 PBKDF2가 같은 목적을 추가 의존성 없이 해결한다. |

## ③ 어디를 어떻게 고쳤나

| 파일 | 바뀐 것 |
|---|---|
| `migrations/0002_auth.sql` | `users`·`sessions`·`experiments`·`daily_logs`·`rule_changes` 표 추가, `plans.user_id` 칸 추가 |
| `src/auth.js` | 비밀번호 해시·확인, 세션 만들기·찾기, 가입·로그인·로그아웃·비밀번호 변경·계정 삭제 |
| `src/worker.js` | 요청 입구: 쓰기 요청 Origin 확인 → 세션 확인 → `/api/auth/*` 외에는 로그인 필요(401) → 각 함수에 `uid`만 넘김 |
| `src/diary.js` | 6번의 계획·할 일·실행 기록·돌아보기 코드. 모든 조회·쓰기에 주인 조건 추가 |
| `src/experiment.js` | 5일 기록(1일차 고정, 하루 한 번, 2일차 뒤·3일차 앞 규칙 변경) |
| `public/app.js`·`pages.js`·`index.html` | 로그인·가입 화면, 로그인 안 했으면 어떤 주소든 로그인 화면, 내 계정(비밀번호 변경·내보내기·계정 삭제), 5일 기록 화면 |

**네 흐름이 지나는 곳**

1. **가입** — 화면 `authPage('signup')`(`public/app.js`) → `POST /api/auth/signup` → `worker.js` `route()`의 `auth` 분기 → `auth.signup()`: 아이디 형식 확인 → 같은 아이디 확인(`users.username`은 `UNIQUE COLLATE NOCASE`) → `hashPassword()` → `INSERT INTO users` → `createSession()`이 쿠키를 붙여 201.
2. **로그인** — `authPage('login')` → `POST /api/auth/login` → `auth.login()`: 아이디로 사용자 찾기 → 없으면 가짜 해시(`DUMMY_HASH`)로 같은 계산을 한 번 더 → `verifyPassword()`(`timingSafeEqual`) → 실패면 두 경우 모두 401 "아이디 또는 비밀번호가 올바르지 않습니다." → 성공이면 `createSession()`.
3. **로그아웃** — 머리말 `logout()` → `POST /api/auth/logout` → `auth.logout()`: `DELETE FROM sessions WHERE id = ?`(지금 세션) + 쿠키 지우기(Max-Age=0).
4. **자료 조회** — 예: `GET /api/plans/3` → `worker.js` `fetch()` → `auth.currentUser()`: 쿠키 값의 SHA-256으로 `sessions` 조회 → 만료면 행 삭제 후 null → `auth.requireUser()`가 null이면 401 → `diary.planDetail(db, uid, 3)` → `getPlan()`: `SELECT … FROM plans WHERE id = ? AND user_id = ?` → 없으면 404.

**거절을 만드는 소스 위치(카드 4)**

| 거절 | 위치 |
|---|---|
| 로그인 안 함 → 401 | `src/auth.js` `requireUser()` (불리는 곳: `src/worker.js` `route()`의 `const uid = auth.requireUser(user).id`) |
| 남의 계획 → 404 | `src/diary.js` `getPlan()` — `WHERE id = ? AND user_id = ?` |
| 남의 할 일 → 404 | `src/diary.js` `getTask()` — `JOIN plans p … WHERE t.id = ? AND p.user_id = ?` |
| 남의 실행 기록 삭제 → 404 | `src/diary.js` `deleteExecution()` — `DELETE … WHERE id = ? AND task_id IN (MY_TASKS)` 후 바뀐 행이 0이면 404 |
| 남의 돌아보기 → 404 | `src/diary.js` `getReview()`·`computeReview()`(→ `getPlan()`) |
| 목록에 남의 자료 없음 | `src/diary.js` `listPlans()` — `WHERE p.user_id = ?`, `listTasks()` — `p.user_id = ?` |
| 주소·헤더·본문의 user_id 무시 | `src/worker.js` — `uid`는 `currentUser()`(세션)에서만 온다. 어떤 함수도 요청의 user_id를 읽지 않는다 |
| 쓰기 문장의 이중 확인 | `src/diary.js` — UPDATE·DELETE·INSERT 문에도 `AND id IN (MY_TASKS)`/`AND user_id = ?`를 다시 건다(확인 뒤 저장, 거절 시 아무것도 쓰지 않음) |
| 다른 사이트의 쓰기 요청 → 403 | `src/worker.js` `fetch()` — Origin이 이 사이트와 다르면 거절 |

**6번 자료를 내 계정으로 옮기기:** 6번 때 만든 계획은 `user_id`가 비어 있어 누구에게도 보이지 않는다. 내 계정을 만든 뒤 아래 한 번을 실행했다(할 일·실행 기록·돌아보기는 계획을 따라온다).

```sql
UPDATE plans SET user_id = (SELECT id FROM users WHERE username = '<내 아이디>') WHERE user_id IS NULL;
```

실행 결과(2026-10-12, `wrangler d1 execute pds-diary --remote`): 내 계정 `iss611`(users.id = 5)로 **계획 1건**("10월 푸시업 루틴", plans.id = 1)이 옮겨졌다(changes = 1). 옮긴 뒤 주인 없는 계획은 0건이다. 6번 제출 때 이 계획에는 할 일·실행 기록이 아직 없었고, 할 일과 기록은 잠근 뒤 내 계정에서 이어서 넣었다.

## ④ 안 열리는 것을 확인한 기록

2026-10-12 15:56(서울)에 배포본(https://pds-diary.plandosee-diary.workers.dev)에서 `tests/auth-check.mjs`를 돌렸다(배포본 대상 점검 모두 통과. 5일 기록 점검은 날짜를 바꿔 봐야 해서 로컬에서만 돌린다). 요청·응답 전체는 [evidence-live.md](evidence-live.md)에 있다. 점검용 계정은 A = `rev_a_weppt`, B = `rev_b_weppt`, D = `rev_d_weppt`(B와 같은 비밀번호), C = 삭제 확인용(지움)이고, 비밀번호는 실행할 때 무작위로 만들어 어디에도 적지 않았다. 아래 주소는 모두 `https://pds-diary.plandosee-diary.workers.dev` 아래다.

### 확인 1 — 로그인하지 않으면 자료가 열리지 않는다

| | 요청 | 응답 |
|---|---|---|
| 성공 | `GET /api/plans` · A 세션 `JsEWxs…생략` | **200** `{"plans":[…A의 계획만…],"today":"2026-10-12"}` |
| 거절 | `GET /api/plans` · 세션 없음 | **401** `{"error":"로그인이 필요합니다."}` |
| 거절 | `GET /api/plans/2` (A의 계획) · 세션 없음 | **401** `{"error":"로그인이 필요합니다."}` |
| 거절 | `DELETE /api/tasks/1` (A의 할 일) · 세션 없음 | **401** `{"error":"로그인이 필요합니다."}` |
| 화면 | 로그인하지 않고 `/#/plan/1`을 연다 | 자료 대신 **로그인 화면**이 나온다(`public/app.js` `router()`가 `ME`가 없으면 `authPage()`를 그린다) |

### 확인 2 — 저장된 비밀번호에 입력한 글자가 보이지 않고, 같은 비밀번호라도 저장값이 다르다

`SELECT username, password_hash FROM users`(배포 DB, `wrangler d1 execute --remote`) 결과. B와 D는 **같은 비밀번호**로 만들었다.

| 아이디 | password_hash (`알고리즘$반복$소금값$결과`) |
|---|---|
| `rev_b_weppt` | `pbkdf2_sha256$100000$SyeE9BIfBeCS1EsgSi3lxQ==$5GGK4krI0/vGZIBIpoBxrUp/NyelfhJNBBO9RSG8Jrk=` |
| `rev_d_weppt` | `pbkdf2_sha256$100000$nRPhaKeD+WToxMR8aV9zNw==$h1I98fMaX/IvpTRtneYIfKQQDnZe3dKRCxCes4sHn/k=` |

소금값이 계정마다 달라 결과도 다르다. 로그인 요청 기록의 본문은 `{"username":"rev_a_weppt","password":"••••(가림)"}`처럼 가렸고, 응답(`{"user":{…},"expires_at":…}`)에는 비밀번호도 세션 값도 실리지 않는다(세션 값은 `Set-Cookie` 헤더로만 간다). 서버 로그(`console.error`)에는 메서드·주소·오류 이름만 남기고 요청 본문은 남기지 않는다. 점검 스크립트는 모든 응답 본문에 비밀번호 원문·세션 원문이 섞이지 않았는지 검사했다(섞였으면 실패로 처리).

### 확인 3 — 로그아웃·비밀번호 변경 뒤 같은 값은 거절된다 (같은 주소·같은 방식)

| | 요청 | 응답 |
|---|---|---|
| 로그아웃 전 | `GET /api/plans` · A 세션 `r6ZBeh…생략` | **200** `{"plans":[],"today":"2026-10-12"}` |
| (로그아웃) | `POST /api/auth/logout` · A 세션 `r6ZBeh…생략` | **200** `{"ok":true}` · `Set-Cookie: __Host-pds_session=; … Max-Age=0` |
| 로그아웃 뒤 | `GET /api/plans` · **같은 값** `r6ZBeh…생략` | **401** `{"error":"로그인이 필요합니다."}` |
| 비밀번호 변경 뒤, 다른 브라우저의 예전 값 | `GET /api/plans` · `SXjRn3…생략` | **401** |
| 비밀번호 변경 뒤, 바꾼 브라우저의 바꾸기 전 값 | `GET /api/plans` · `qLkjsj…생략` | **401** |
| 비밀번호 변경 뒤, 새로 받은 값 | `GET /api/plans` · `JsEWxs…생략` | **200** |

두 요청(200·401)은 주소·방식·쿠키 값이 같고, 사이에 로그아웃 하나만 있다. 만료: 로그인 응답의 `expires_at`이 로그인 시각 + 7일(예: 2026-10-12T06:56:05Z 로그인 → `2026-10-19T06:56:05.636Z`)이고 쿠키 `Max-Age=604800`(7일)이다. 세션 값은 쿠키로만 다니고 주소창(URL)에 실리지 않는다.

### 확인 4 — 남의 자료를 읽기·수정·삭제하면 양쪽 방향 모두 거절된다

A의 자료: 계획 #2 · 할 일 #1 · 실행 기록 #1. B의 자료: 계획 #3 · 할 일 #2 · 실행 기록 #2.

| 방향 | 종류 | 요청 | 응답 |
|---|---|---|---|
| (성공) | 읽기 | A가 `GET /api/plans` (자기 목록) | **200** 계획 #2가 들어 있음 |
| (성공) | 쓰기 | A가 `POST /api/plans/2/tasks` (자기 계획에 할 일) | **200** `{"id":1}` |
| B → A | 읽기 | `GET /api/plans/2` · `GET /api/tasks/1` · `GET /api/plans/2/review` · `GET /api/plans/2/tasks` | **404** ×4 `{"error":"계획을 찾을 수 없습니다."}` 등 |
| B → A | 수정 | `PUT /api/plans/2` · `PUT /api/tasks/1` · `POST /api/tasks/1/complete` · `POST /api/plans/2/tasks` · `POST /api/tasks/1/executions` | **404** ×5 |
| B → A | 삭제 | `DELETE /api/tasks/1` · `DELETE /api/executions/1` | **404** ×2 |
| A → B | 읽기 | `GET /api/plans/3` · `GET /api/tasks/2` · `GET /api/plans/3/review` · `GET /api/plans/3/tasks` | **404** ×4 |
| A → B | 수정 | `PUT /api/plans/3` · `PUT /api/tasks/2` · `POST /api/tasks/2/complete` · `POST /api/plans/3/tasks` · `POST /api/tasks/2/executions` | **404** ×5 |
| A → B | 삭제 | `DELETE /api/tasks/2` · `DELETE /api/executions/2` | **404** ×2 |

거절은 모두 **404**(존재 자체를 감춤)이다. 거절 앞뒤 건수: A는 계획 1 · 할 일 1 · 실행 기록 1 · 완료 기록 0 → 거절 뒤에도 1 · 1 · 1 · 0이고, 내용(계획·할 일·실행 기록·완료 기록·수정 이력 전체)을 거절 전과 비교해 같았다. B도 1 · 1 · 1 · 0 → 1 · 1 · 1 · 0, 내용 같음. 거절을 만드는 소스 위치는 ③의 표에 있다.

### 확인 5 — 주소·헤더·본문에 남의 계정을 적어도 내 자료만, 목록에도 남의 자료가 없다

| | 요청 | 응답 |
|---|---|---|
| 주소+헤더 | B가 `GET /api/plans?user_id=1` + `X-User-Id: 1` (1 = A의 ID) | **200** B의 계획(#3)만. A의 계획 #2는 없음 |
| 본문 | B가 `POST /api/plans` `{"user_id":1,"title":"B가 A 이름으로",…}` | **200** `{"id":4}` → #4는 **B의 목록**에만 있고 A의 목록에는 없음 |
| 목록 | A가 `GET /api/plans` | **200** A의 계획(#2)만 — 모든 항목의 `user_id`가 1 |
| 목록 | B가 `GET /api/plans` | **200** B의 계획(#3, #4)만 — `user_id`가 1인 항목 없음 |
| 다른 사이트 | A의 쿠키를 실은 `POST /api/plans`, `Origin: https://evil.example` | **403** `{"error":"이 사이트에서 보낸 요청만 받습니다."}` |

그 밖에 확인한 것: 같은 아이디로 두 번 가입 → **409**, 대문자만 바꾼 아이디(`REV_A_WEPPT`) → **409**. 아이디는 맞고 비밀번호만 틀림 → **401** "아이디 또는 비밀번호가 올바르지 않습니다." / 없는 아이디 → **401** 같은 문구. 계정 삭제 → 삭제 전 세션 값으로 요청하면 **401**, 지운 계정으로 로그인하면 **401**.

## ⑤ AI와 나

<!-- 직접 적는다: AI에게 맡긴 일 / 내가 직접 판단한 일 / AI 제안을 따르지 않은 일 -->

## ⑥ 아직 못 막은 것

| 못 막은 것 | 왜 위험한가 |
|---|---|
| **무차별 대입(비밀번호 맞히기 반복)** — 로그인 실패 횟수 제한·잠금·지연이 없다 | 공격자가 한 아이디에 비밀번호를 끝없이 시도할 수 있다. 약한 비밀번호(10자 이상만 요구)는 결국 뚫린다. |
| **가입 화면으로 아이디 존재 여부가 드러남** — 이미 있는 아이디로 가입하면 "이미 쓰는 아이디"라고 알려 준다 | 로그인 문구는 같게 만들었지만, 가입 시도로 어떤 아이디가 있는지 확인한 뒤 그 아이디만 골라 무차별 대입을 할 수 있다. |
| **비밀번호 재설정이 없다** — 이메일을 받지 않아서 잊어버리면 되찾을 길이 없다 | 자료를 잃는다. 반대로 재설정을 대충 붙이면 그것이 새 침입 경로가 된다. |
| **두 번째 인증 수단(2단계 인증)이 없다** | 비밀번호 하나가 새면 바로 계정 전체가 열린다. |
| **PBKDF2 반복 횟수가 권장보다 낮다** — 100,000회(Workers 상한) < OWASP 권장 600,000회 | DB가 통째로 새면, 오프라인에서 비밀번호를 맞혀 보는 속도가 권장 설정보다 약 6배 빠르다. |
| **로그인 기록·이상 감지가 없다** — 누가 언제 로그인했는지, 실패가 몰렸는지 남기지 않는다 | 계정이 털려도 알아챌 방법이 없다. |
| **세션 목록·원격 로그아웃 화면이 없다** — 다른 기기 세션을 하나씩 끊을 수 없다(비밀번호를 바꾸면 전부 끊긴다) | 잃어버린 기기의 세션을 끊으려면 비밀번호를 바꿔야 한다. |
| **Google Fonts를 외부에서 불러온다** | 화면을 열 때 브라우저가 Google 서버에 접속한다(접속 사실이 Google에 남음). 스크립트는 막혀 있어 코드 실행 위험은 없다. |
