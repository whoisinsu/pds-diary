# 확인 기록 (2026-10-12T06:56:14.802Z · https://pds-diary.plandosee-diary.workers.dev)

비밀번호는 실행할 때 무작위로 만들고 적지 않았습니다(••••). 세션 값은 앞 6글자만 남기고 가렸습니다.
아래 주소는 모두 `/api` 아래에 있습니다(예: `GET /plans` = `GET https://pds-diary.plandosee-diary.workers.dev/api/plans`). 쓰기 요청은 모두 `Origin: https://pds-diary.plandosee-diary.workers.dev`를 실어 보냈고, 다른 Origin을 쓴 요청만 따로 적었습니다.
점검용 계정: A = `rev_a_weppt`, B = `rev_b_weppt`, D = `rev_d_weppt` (B와 D는 같은 비밀번호로 만듦, A는 중간에 비밀번호를 바꿈). C는 계정 삭제 확인용으로 만들고 지웠습니다.

### 가입·로그인·로그아웃 (카드 1)

- A 가입 — `POST /auth/signup` {"username":"rev_a_weppt","password":"••••(가림)"} · 세션 없음
  → **201** {"user":{"id":1,"username":"rev_a_weppt"},"expires_at":"2026-10-19T06:56:03.745Z"} · set-cookie: __Host-pds_session=Ewxma0…생략; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=604800
- B 가입(A와 같은 비밀번호) — `POST /auth/signup` {"username":"rev_b_weppt","password":"••••(가림)"} · 세션 없음
  → **201** {"user":{"id":2,"username":"rev_b_weppt"},"expires_at":"2026-10-19T06:56:04.299Z"} · set-cookie: __Host-pds_session=ZtCaZf…생략; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=604800
- D 가입(B와 같은 비밀번호, 저장값 비교용) — `POST /auth/signup` {"username":"rev_d_weppt","password":"••••(가림)"} · 세션 없음
  → **201** {"user":{"id":3,"username":"rev_d_weppt"},"expires_at":"2026-10-19T06:56:04.662Z"} · set-cookie: __Host-pds_session=51H10N…생략; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=604800
- 같은 아이디로 다시 가입 — `POST /auth/signup` {"username":"rev_a_weppt","password":"••••(가림)"} · 세션 없음
  → **409** {"error":"이미 쓰는 아이디입니다. 다른 아이디를 골라 주세요."}
- 대문자로 바꿔 다시 가입 — `POST /auth/signup` {"username":"REV_A_WEPPT","password":"••••(가림)"} · 세션 없음
  → **409** {"error":"이미 쓰는 아이디입니다. 다른 아이디를 골라 주세요."}
- 아이디는 맞고 비밀번호가 틀림 — `POST /auth/login` {"username":"rev_a_weppt","password":"••••(가림)"} · 세션 없음
  → **401** {"error":"아이디 또는 비밀번호가 올바르지 않습니다."}
- 없는 아이디 — `POST /auth/login` {"username":"nobody_weppt","password":"••••(가림)"} · 세션 없음
  → **401** {"error":"아이디 또는 비밀번호가 올바르지 않습니다."}
- 로그인 없이 자료 목록 직접 요청 — `GET /plans` · 세션 없음
  → **401** {"error":"로그인이 필요합니다."}
- A 로그인 — `POST /auth/login` {"username":"rev_a_weppt","password":"••••(가림)"} · 세션 없음
  → **200** {"user":{"id":1,"username":"rev_a_weppt"},"expires_at":"2026-10-19T06:56:05.636Z"} · set-cookie: __Host-pds_session=r6ZBeh…생략; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=604800

### 같은 주소·같은 방식: 로그아웃 전 성공 / 뒤 거절 (카드 3)

- 로그아웃 전 — `GET /plans` · A 세션 r6ZBeh…생략
  → **200** {"plans":[],"today":"2026-10-12"}
- 로그아웃 — `POST /auth/logout` · A 세션 r6ZBeh…생략
  → **200** {"ok":true} · set-cookie: __Host-pds_session=(없음); Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0
- 로그아웃 뒤 같은 값으로 같은 요청 — `GET /plans` · A(로그아웃한 값) 세션 r6ZBeh…생략
  → **401** {"error":"로그인이 필요합니다."}

### 비밀번호를 바꾸면 이전 값이 끊김 (카드 3)

- A 브라우저 1 로그인 — `POST /auth/login` {"username":"rev_a_weppt","password":"••••(가림)"} · 세션 없음
  → **200** {"user":{"id":1,"username":"rev_a_weppt"},"expires_at":"2026-10-19T06:56:06.367Z"} · set-cookie: __Host-pds_session=qLkjsj…생략; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=604800
- A 브라우저 2 로그인 — `POST /auth/login` {"username":"rev_a_weppt","password":"••••(가림)"} · 세션 없음
  → **200** {"user":{"id":1,"username":"rev_a_weppt"},"expires_at":"2026-10-19T06:56:06.643Z"} · set-cookie: __Host-pds_session=SXjRn3…생략; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=604800
- 브라우저 1에서 비밀번호 변경 — `POST /auth/password` {"current_password":"••••(가림)","new_password":"••••(가림)"} · A-1 세션 qLkjsj…생략
  → **200** {"ok":true,"expires_at":"2026-10-19T06:56:06.960Z"} · set-cookie: __Host-pds_session=JsEWxs…생략; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=604800
- 브라우저 2(예전 값)로 요청 — `GET /plans` · A-2 세션 SXjRn3…생략
  → **401** {"error":"로그인이 필요합니다."}
- 브라우저 1의 바꾸기 전 값으로 요청 — `GET /plans` · A-1(바꾸기 전 값) 세션 qLkjsj…생략
  → **401** {"error":"로그인이 필요합니다."}
- 브라우저 1의 새 값 — `GET /plans` · A-1 세션 JsEWxs…생략
  → **200** {"plans":[],"today":"2026-10-12"}
- 예전 비밀번호로 로그인 — `POST /auth/login` {"username":"rev_a_weppt","password":"••••(가림)"} · 세션 없음
  → **401** {"error":"아이디 또는 비밀번호가 올바르지 않습니다."}

### 계정 두 개에 자료 넣기 (카드 4)

- A 계획 만들기 — `POST /plans` {"title":"A의 계획","start_date":"2026-10-12","end_date":"2026-10-31","priority":2,"success_criteria":"A 기준","estimated_minutes":300} · A 세션 JsEWxs…생략
  → **200** {"id":2}
- A 할 일 만들기 — `POST /plans/2/tasks` {"title":"A의 할 일","priority":2,"estimated_minutes":30,"tags":"test"} · A 세션 JsEWxs…생략
  → **200** {"id":1}
- A 실행 기록 만들기 — `POST /tasks/1/executions` {"started_at":"2026-10-12T10:00:00Z","ended_at":"2026-10-12T10:30:00Z"} · A 세션 JsEWxs…생략
  → **200** {"id":1}
- B 계획 만들기 — `POST /plans` {"title":"B의 계획","start_date":"2026-10-12","end_date":"2026-10-31","priority":2,"success_criteria":"B 기준","estimated_minutes":300} · B 세션 ZtCaZf…생략
  → **200** {"id":3}
- B 할 일 만들기 — `POST /plans/3/tasks` {"title":"B의 할 일","priority":2,"estimated_minutes":30,"tags":"test"} · B 세션 ZtCaZf…생략
  → **200** {"id":2}
- B 실행 기록 만들기 — `POST /tasks/2/executions` {"started_at":"2026-10-12T10:00:00Z","ended_at":"2026-10-12T10:30:00Z"} · B 세션 ZtCaZf…생략
  → **200** {"id":2}

### B → A: 읽기·수정·삭제 (카드 4)

- 거절 전 A의 자료: 계획 1 · 할 일 1 · 실행 기록 1 · 완료 기록 0
- B가 A의 자료 읽기 — `GET /plans/2` · B 세션 ZtCaZf…생략
  → **404** {"error":"계획을 찾을 수 없습니다."}
- B가 A의 자료 읽기 — `GET /tasks/1` · B 세션 ZtCaZf…생략
  → **404** {"error":"할 일을 찾을 수 없습니다."}
- B가 A의 자료 읽기 — `GET /plans/2/review` · B 세션 ZtCaZf…생략
  → **404** {"error":"계획을 찾을 수 없습니다."}
- B가 A의 자료 읽기 — `GET /plans/2/tasks` · B 세션 ZtCaZf…생략
  → **404** {"error":"계획을 찾을 수 없습니다."}
- B가 A의 자료 수정 — `PUT /plans/2` {"title":"덮어쓰기","start_date":"2026-10-12","end_date":"2026-10-31","priority":1,"success_criteria":"x","estimated_minutes":1} · B 세션 ZtCaZf…생략
  → **404** {"error":"계획을 찾을 수 없습니다."}
- B가 A의 자료 수정 — `PUT /tasks/1` {"title":"덮어쓰기","priority":1} · B 세션 ZtCaZf…생략
  → **404** {"error":"할 일을 찾을 수 없습니다."}
- B가 A의 자료 수정 — `POST /tasks/1/complete` · B 세션 ZtCaZf…생략 · Idempotency-Key: atk-weppt-5
  → **404** {"error":"할 일을 찾을 수 없습니다."}
- B가 A의 자료 수정 — `POST /plans/2/tasks` {"title":"끼워 넣기","priority":1} · B 세션 ZtCaZf…생략
  → **404** {"error":"계획을 찾을 수 없습니다."}
- B가 A의 자료 수정 — `POST /tasks/1/executions` {"started_at":"2026-10-12T10:00:00Z","ended_at":"2026-10-12T11:00:00Z"} · B 세션 ZtCaZf…생략
  → **404** {"error":"할 일을 찾을 수 없습니다."}
- B가 A의 자료 삭제 — `DELETE /tasks/1` · B 세션 ZtCaZf…생략
  → **404** {"error":"할 일을 찾을 수 없습니다."}
- B가 A의 자료 삭제 — `DELETE /executions/1` · B 세션 ZtCaZf…생략
  → **404** {"error":"실행 기록을 찾을 수 없습니다."}
- 거절 뒤 A의 자료: 계획 1 · 할 일 1 · 실행 기록 1 · 완료 기록 0 · 내용 비교: 거절 전과 같음

### A → B (반대 방향): 읽기·수정·삭제 (카드 4)

- 거절 전 B의 자료: 계획 1 · 할 일 1 · 실행 기록 1 · 완료 기록 0
- A가 B의 자료 읽기 — `GET /plans/3` · A 세션 JsEWxs…생략
  → **404** {"error":"계획을 찾을 수 없습니다."}
- A가 B의 자료 읽기 — `GET /tasks/2` · A 세션 JsEWxs…생략
  → **404** {"error":"할 일을 찾을 수 없습니다."}
- A가 B의 자료 읽기 — `GET /plans/3/review` · A 세션 JsEWxs…생략
  → **404** {"error":"계획을 찾을 수 없습니다."}
- A가 B의 자료 읽기 — `GET /plans/3/tasks` · A 세션 JsEWxs…생략
  → **404** {"error":"계획을 찾을 수 없습니다."}
- A가 B의 자료 수정 — `PUT /plans/3` {"title":"덮어쓰기","start_date":"2026-10-12","end_date":"2026-10-31","priority":1,"success_criteria":"x","estimated_minutes":1} · A 세션 JsEWxs…생략
  → **404** {"error":"계획을 찾을 수 없습니다."}
- A가 B의 자료 수정 — `PUT /tasks/2` {"title":"덮어쓰기","priority":1} · A 세션 JsEWxs…생략
  → **404** {"error":"할 일을 찾을 수 없습니다."}
- A가 B의 자료 수정 — `POST /tasks/2/complete` · A 세션 JsEWxs…생략 · Idempotency-Key: atk-weppt-13
  → **404** {"error":"할 일을 찾을 수 없습니다."}
- A가 B의 자료 수정 — `POST /plans/3/tasks` {"title":"끼워 넣기","priority":1} · A 세션 JsEWxs…생략
  → **404** {"error":"계획을 찾을 수 없습니다."}
- A가 B의 자료 수정 — `POST /tasks/2/executions` {"started_at":"2026-10-12T10:00:00Z","ended_at":"2026-10-12T11:00:00Z"} · A 세션 JsEWxs…생략
  → **404** {"error":"할 일을 찾을 수 없습니다."}
- A가 B의 자료 삭제 — `DELETE /tasks/2` · A 세션 JsEWxs…생략
  → **404** {"error":"할 일을 찾을 수 없습니다."}
- A가 B의 자료 삭제 — `DELETE /executions/2` · A 세션 JsEWxs…생략
  → **404** {"error":"실행 기록을 찾을 수 없습니다."}
- 거절 뒤 B의 자료: 계획 1 · 할 일 1 · 실행 기록 1 · 완료 기록 0 · 내용 비교: 거절 전과 같음

### 주소·헤더·본문에 다른 계정을 적어 보내기 (카드 4)

- A의 사용자 ID 확인 — `GET /auth/me` · A 세션 JsEWxs…생략
  → **200** {"user":{"id":1,"username":"rev_a_weppt"},"expires_at":"2026-10-19T06:56:06.960Z"}
- B가 주소와 헤더에 A의 ID를 적어 목록 요청 — `GET /plans?user_id=1` · B 세션 ZtCaZf…생략 · X-User-Id: 1
  → **200** {"plans":[{"id":3,"title":"B의 계획","start_date":"2026-10-12","end_date":"2026-10-31","priority":2,"success_criteria":"B 기준","estimated_minutes":300,"current_rev":1,"carried_from_review_id":null,"carried_note":null,"create
- B가 본문에 A의 ID를 적어 계획 만들기 — `POST /plans` {"user_id":1,"title":"B가 A 이름으로","start_date":"2026-10-12","end_date":"2026-10-31","priority":2,"success_criteria":"x","estimated_minutes":10} · B 세션 ZtCaZf…생략
  → **200** {"id":4}
- A의 목록 — `GET /plans` · A 세션 JsEWxs…생략
  → **200** {"plans":[{"id":2,"title":"A의 계획","start_date":"2026-10-12","end_date":"2026-10-31","priority":2,"success_criteria":"A 기준","estimated_minutes":300,"current_rev":1,"carried_from_review_id":null,"carried_note":null,"create
- B의 목록 — `GET /plans` · B 세션 ZtCaZf…생략
  → **200** {"plans":[{"id":4,"title":"B가 A 이름으로","start_date":"2026-10-12","end_date":"2026-10-31","priority":2,"success_criteria":"x","estimated_minutes":10,"current_rev":1,"carried_from_review_id":null,"carried_note":null,"create

### 로그인 없이 직접 요청, 다른 사이트에서 보낸 쓰기 요청 (카드 4)

- 로그인 없이 A의 계획 읽기 — `GET /plans/2` · 세션 없음
  → **401** {"error":"로그인이 필요합니다."}
- 로그인 없이 A의 할 일 지우기 — `DELETE /tasks/1` · 세션 없음
  → **401** {"error":"로그인이 필요합니다."}
- 로그인 없이 내보내기 — `GET /export` · 세션 없음
  → **401** {"error":"로그인이 필요합니다."}
- A의 쿠키를 실은 채 다른 사이트(Origin)에서 쓰기 — `POST /plans` {"title":"x","start_date":"2026-10-12","end_date":"2026-10-31","priority":2,"success_criteria":"x","estimated_minutes":1} · A 세션 JsEWxs…생략 · origin: https://evil.example
  → **403** {"error":"이 사이트에서 보낸 요청만 받습니다."}

### 계정 삭제 (카드 5)

- C 가입 — `POST /auth/signup` {"username":"rev_c_weppt","password":"••••(가림)"} · 세션 없음
  → **201** {"user":{"id":4,"username":"rev_c_weppt"},"expires_at":"2026-10-19T06:56:14.307Z"} · set-cookie: __Host-pds_session=pDTvxz…생략; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=604800
- C 계획 만들기 — `POST /plans` {"title":"C의 계획","start_date":"2026-10-12","end_date":"2026-10-31","priority":2,"success_criteria":"C 기준","estimated_minutes":300} · C 세션 pDTvxz…생략
  → **200** {"id":5}
- C 할 일 만들기 — `POST /plans/5/tasks` {"title":"C의 할 일","priority":2,"estimated_minutes":30,"tags":"test"} · C 세션 pDTvxz…생략
  → **200** {"id":3}
- C 실행 기록 만들기 — `POST /tasks/3/executions` {"started_at":"2026-10-12T10:00:00Z","ended_at":"2026-10-12T10:30:00Z"} · C 세션 pDTvxz…생략
  → **200** {"id":3}
- C 계정 삭제 — `DELETE /auth/account` {"password":"••••(가림)"} · C 세션 pDTvxz…생략
  → **200** {"ok":true,"deleted":true} · set-cookie: __Host-pds_session=(없음); Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0
- 삭제 전 세션 값으로 C의 계획 읽기 — `GET /plans/5` · C(삭제 전 값) 세션 pDTvxz…생략
  → **401** {"error":"로그인이 필요합니다."}
- 지운 계정으로 로그인 — `POST /auth/login` {"username":"rev_c_weppt","password":"••••(가림)"} · 세션 없음
  → **401** {"error":"아이디 또는 비밀번호가 올바르지 않습니다."}
