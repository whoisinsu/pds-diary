'use strict';
// 플랜두씨 다이어리 화면. 사용자가 적은 글은 모두 textContent로만 넣는다(innerHTML 쓰지 않음).

const $app = document.getElementById('app');
const $flash = document.getElementById('flash');
const PRIORITY = { 1: '높음', 2: '보통', 3: '낮음' };
const METRICS = {
  planned: { label: '계획 수', rule: '이 계획에 딸린, 지우지 않은 할 일 수' },
  done: { label: '완료 수', rule: '그중 지금 완료 상태인 할 일 수' },
  late: { label: '지연 수', rule: '완료되지 않았고 마감일이 서울 기준 오늘보다 앞선 할 일 수 (완료한 할 일은 세지 않음)' },
  blocked: { label: '막힘 수', rule: '실행 기록에 막힌 이유가 하나라도 적힌 할 일 수' },
  estimated: { label: '예상 시간', rule: '대상 할 일의 예상 시간 합계', unit: '분' },
  actual: { label: '실제 시간', rule: '대상 할 일의 실행 기록 실제 시간 합계', unit: '분' },
  diff: { label: '차이', rule: '실제 시간 − 예상 시간 (+면 더 걸림)', unit: '분' },
};

// ---------- DOM 도우미 ----------

function h(tag, props, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k === 'css') Object.assign(el.style, v); // CSSOM이라 CSP(style-src 'self')에 걸리지 않음
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k in el && k !== 'list' && k !== 'form') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat(Infinity)) {
    if (c === undefined || c === null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

const ICONS = {
  plus: ['M12 5v14M5 12h14'],
  check: ['m5 12 5 5 9-10'],
  edit: ['M4 20h4L19 9l-4-4L4 16z'],
  trash: ['M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13'],
  search: ['M11 4a7 7 0 1 0 0 14a7 7 0 1 0 0-14z', 'm20 20-3.5-3.5'],
  sort: ['M3 6h13M3 12h9M3 18h5', 'm17 15 3 3 3-3M20 8v10'],
  undo: ['M9 14 4 9l5-5', 'M4 9h11a5 5 0 0 1 0 10h-3'],
};
function icon(name, size = 16, width = 2) {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  for (const [k, v] of Object.entries({ width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
    'stroke-width': width, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' })) svg.setAttribute(k, v);
  for (const d of ICONS[name]) {
    const p = document.createElementNS(NS, 'path');
    p.setAttribute('d', d);
    svg.append(p);
  }
  return svg;
}

function render(...nodes) {
  $app.replaceChildren(...nodes.flat().filter((n) => n !== null && n !== undefined && n !== false));
  window.scrollTo(0, 0);
}

let flashTimer;
function flash(msg, bad = false) {
  $flash.textContent = msg;
  $flash.className = bad ? 'flash bad' : 'flash';
  $flash.hidden = false;
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => { $flash.hidden = true; }, bad ? 8000 : 4000);
}

// ---------- 서버 ----------

async function api(method, path, data, headers = {}) {
  const opt = { method, headers: { ...headers } };
  if (data !== undefined) {
    opt.headers['content-type'] = 'application/json';
    opt.body = JSON.stringify(data);
  }
  let res;
  try {
    res = await fetch('/api' + path, opt);
  } catch {
    throw new Error('서버에 연결하지 못했습니다. 인터넷 연결을 확인해 주세요.');
  }
  const out = await res.json().catch(() => ({}));
  if (res.status === 401 && !path.startsWith('/auth/')) {
    // 세션이 끝났거나 끊겼다: 자료 대신 로그인 화면을 보인다.
    ME = null;
    renderNav();
    authPage('login', '로그인이 끝났습니다. 다시 로그인해 주세요.');
    throw new Error('로그인이 필요합니다.');
  }
  if (!res.ok) throw new Error(out.error || `요청이 실패했습니다 (${res.status}).`);
  return out;
}

// ---------- 로그인 상태 ----------

let ME; // undefined = 아직 모름, null = 로그인 안 됨, { id, username } = 로그인됨

async function loadMe() {
  try {
    const out = await api('GET', '/auth/me');
    ME = out.user;
  } catch {
    ME = null;
  }
  renderNav();
}

function renderNav() {
  const nav = document.getElementById('nav');
  if (!ME) {
    nav.replaceChildren(
      h('a', { class: 'navlink', href: '#/login', text: '로그인' }),
      h('a', { class: 'btn', href: '#/signup', text: '가입하기' }));
    return;
  }
  nav.replaceChildren(
    h('a', { class: 'navlink', href: '#/', text: '계획 목록' }),
    h('a', { class: 'navlink', href: '#/log', text: '5일 기록' }),
    h('a', { class: 'navlink', href: '#/account', text: `${ME.username} 님` }),
    h('button', { type: 'button', onclick: logout, text: '로그아웃' }));
}

async function logout() {
  try { await api('POST', '/auth/logout'); } catch { /* 이미 끊긴 세션이어도 화면은 로그아웃 */ }
  ME = null;
  renderNav();
  flash('로그아웃했습니다. 이 브라우저의 세션은 서버에서도 끊겼습니다.');
  location.hash = '#/login';
  router();
}

function authPage(mode, notice) {
  const signup = mode === 'signup';
  const pwIn = h('input', { name: 'password', type: 'password', required: true, minLength: signup ? 10 : 1, maxLength: 128,
    autocomplete: signup ? 'new-password' : 'current-password' });
  const msg = h('p', { class: 'error', role: 'alert' });
  const f = h('form', { class: 'grid' },
    h('label', { class: 'full' }, h('span', {}, '아이디 ', signup && h('span', { class: 'hint', text: '영문 소문자·숫자·밑줄 3~20자. 이메일·실명은 받지 않습니다.' })),
      h('input', { name: 'username', required: true, maxLength: 20, autocomplete: 'username', autocapitalize: 'none', spellcheck: false })),
    h('label', { class: 'full' }, h('span', {}, '비밀번호 ', signup && h('span', { class: 'hint', text: '10자 이상, 아이디를 넣지 마세요.' })), pwIn),
    signup && h('label', { class: 'full' }, '비밀번호 확인', h('input', { name: 'password2', type: 'password', required: true, autocomplete: 'new-password' })),
    h('div', { class: 'full row' }, h('button', { class: 'primary', type: 'submit', text: signup ? '가입하고 시작하기' : '로그인' })),
    msg);
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(f));
    msg.textContent = '';
    if (signup && d.password !== d.password2) { msg.textContent = '두 비밀번호가 다릅니다.'; return; }
    const btn = f.querySelector('button[type=submit]');
    btn.disabled = true;
    try {
      const out = await api('POST', signup ? '/auth/signup' : '/auth/login', { username: d.username, password: d.password });
      ME = out.user;
      renderNav();
      flash(signup ? `${ME.username} 님, 가입했습니다.` : `${ME.username} 님, 반갑습니다.`);
      if (/^#\/(login|signup)?$/.test(location.hash) || !location.hash) location.hash = '#/';
      router();
    } catch (err) {
      msg.textContent = err.message;
      pwIn.value = '';
    } finally {
      btn.disabled = false;
    }
  });
  render(
    h('section', { class: 'hero' },
      h('span', { class: 'stamp', text: stampFmt.format(new Date()) }),
      h('h1', {}, h('span', { class: 'hl', text: signup ? '가입하기' : '로그인' })),
      h('p', { text: '계획(Plan) → 실제로 한 일(Do) → 돌아보기(See)를 잇는 다이어리입니다. 내 자료는 로그인한 뒤에만 보입니다.' })),
    notice && h('p', { class: 'flash', text: notice }),
    h('div', { class: 'auth-wrap' },
      h('section', { class: 'card tape lift' }, f),
      h('p', { class: 'small' },
        signup ? '이미 계정이 있나요? ' : '처음인가요? ',
        h('a', { href: signup ? '#/login' : '#/signup', text: signup ? '로그인' : '가입하기' }))));
}

// ---------- 날짜·시간 ----------

const seoulFmt = new Intl.DateTimeFormat('ko-KR', {
  timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hour12: false,
});
const stampFmt = new Intl.DateTimeFormat('ko-KR', {
  timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'long',
});
const fmtInstant = (iso) => (iso ? seoulFmt.format(new Date(iso)) : '—');
const seoulToday = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
// datetime-local 입력값(서울 시각) ↔ UTC ISO
const localToIso = (v) => new Date(v + ':00+09:00').toISOString();
const isoToLocal = (iso) => new Date(Date.parse(iso) + 9 * 3600e3).toISOString().slice(0, 16);
const daysLate = (due, today) => Math.round((Date.parse(today) - Date.parse(due)) / 86400e3);

function fmtMin(m) {
  if (m === null || m === undefined || m === '') return '—';
  const n = Number(m);
  const sign = n < 0 ? '−' : '';
  const a = Math.abs(n);
  const hm = a >= 60 ? ` (${Math.floor(a / 60)}시간${a % 60 ? ' ' + (a % 60) + '분' : ''})` : '';
  return `${sign}${a}분${hm}`;
}
const signed = (n) => (n > 0 ? `+${n}` : n < 0 ? `−${-n}` : '0');

function newKey() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
}

// ---------- 라우터 ----------

function parseHash() {
  const raw = location.hash.replace(/^#/, '') || '/';
  const [path, qs] = raw.split('?');
  return { parts: path.split('/').filter(Boolean), query: new URLSearchParams(qs || '') };
}

function setQuery(query) {
  const { parts } = parseHash();
  const qs = query.toString();
  history.replaceState(null, '', '#/' + parts.join('/') + (qs ? '?' + qs : ''));
}

async function router() {
  const { parts, query } = parseHash();
  const [a, b, c] = parts;
  if (ME === undefined) await loadMe();
  // 로그인하지 않았으면 어떤 주소로 와도 자료 대신 로그인(또는 가입) 화면을 보인다.
  if (!ME) return authPage(a === 'signup' ? 'signup' : 'login');
  try {
    if (!a || a === 'login' || a === 'signup') return await homePage();
    if (a === 'log') return await experimentPage();
    if (a === 'account') return accountPage();
    if (a === 'new-plan') return await newPlanPage(query);
    if (a === 'plan' && b) return await planPage(Number(b), query);
    if (a === 'task' && b) return await taskPage(Number(b));
    if (a === 'review' && b && c) return await drillPage(Number(b), c, query);
    if (a === 'review' && b) return await reviewPage(Number(b), query);
    render(h('p', { class: 'error', text: '없는 화면입니다.' }), h('a', { href: '#/', text: '처음으로' }));
  } catch (err) {
    if (!ME) return; // 세션이 끊겨 api()가 이미 로그인 화면을 그렸다
    render(h('div', { class: 'card' },
      h('p', { class: 'error', text: err.message }),
      h('a', { href: '#/', text: '계획 목록으로' })));
  }
}
window.addEventListener('hashchange', router);
router();

function crumbs(...items) {
  const out = [h('a', { href: '#/', text: '계획 목록' })];
  for (const it of items) out.push(h('span', { text: '/' }), typeof it === 'string' ? h('span', { text: it }) : it);
  return h('nav', { class: 'crumbs', 'aria-label': '위치' }, out);
}

// ---------- 계획 입력 폼 ----------

function planForm(plan, { submitText, withNote, onSubmit }) {
  const f = h('form', { class: 'grid' },
    h('label', { class: 'full' }, '계획 이름',
      h('input', { name: 'title', required: true, maxLength: 200, value: plan.title || '', placeholder: '예: 10월 하체 근력 루틴 지키기' })),
    h('label', {}, '시작일', h('input', { type: 'date', name: 'start_date', required: true, value: plan.start_date || seoulToday() })),
    h('label', {}, '종료일', h('input', { type: 'date', name: 'end_date', required: true, value: plan.end_date || '' })),
    h('label', {}, '우선순위', prioritySelect(plan.priority || 2)),
    h('label', {}, '예상 시간 (분)',
      h('input', { type: 'number', name: 'estimated_minutes', min: 0, step: 1, required: true, value: plan.estimated_minutes ?? '' })),
    h('label', { class: 'full' }, h('span', {}, '성공 기준 ', h('span', { class: 'hint', text: '무엇이 되면 이 계획은 성공인가요?' })),
      h('textarea', { name: 'success_criteria', required: true, maxLength: 2000, value: plan.success_criteria || '' })),
    withNote && h('label', { class: 'full' }, h('span', {}, '고친 이유 ', h('span', { class: 'hint', text: '수정 이력에 남습니다' })),
      h('input', { name: 'change_note', maxLength: 500, placeholder: '예: 첫 주 해 보니 주 4회는 무리여서 주 3회로 줄임' })),
    h('div', { class: 'full row' }, h('button', { class: 'primary', type: 'submit', text: submitText }))
  );
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = f.querySelector('button[type=submit]');
    btn.disabled = true;
    try {
      await onSubmit(Object.fromEntries(new FormData(f)));
    } catch (err) {
      flash(err.message, true);
    } finally {
      btn.disabled = false;
    }
  });
  return f;
}

function prioritySelect(value, name = 'priority') {
  return h('select', { name },
    [1, 2, 3].map((p) => h('option', { value: p, text: PRIORITY[p], selected: Number(value) === p })));
}

const prioChip = (p) => h('span', { class: 'chip' + (p === 1 ? ' p1' : ''), text: `우선순위 ${PRIORITY[p]}` });

function progress(done, total) {
  return h('div', { class: 'progress', role: 'img', 'aria-label': `완료 ${done} / ${total}` },
    h('span', { css: { width: total ? `${(done / total) * 100}%` : '0%' } }));
}

// ---------- 처음 화면 ----------

async function homePage() {
  const { plans } = await api('GET', '/plans');
  render(
    h('section', { class: 'hero' },
      h('div', { class: 'hero-row' },
        h('div', {},
          h('span', { class: 'stamp', text: stampFmt.format(new Date()) }),
          h('h1', {}, h('span', { class: 'hl', text: '내 계획' })),
          h('p', { text: '계획을 세우고, 실제로 한 일을 적고, 돌아보며 고칠 점 한 줄을 다음 계획으로 넘깁니다.' })),
        h('div', { class: 'row' },
          h('a', { class: 'btn', href: '/api/export', download: '', text: '내 자료 내보내기 (JSON)' }),
          h('a', { class: 'btn primary', href: '#/new-plan' }, icon('plus', 16, 2.4), '새 계획 세우기')))),
    plans.length
      ? h('div', { class: 'plan-grid' }, plans.map(planCard))
      : h('div', { class: 'empty' }, '아직 계획이 없습니다. 지금 실제로 하고 있는 일 하나를 골라 첫 계획을 세워 보세요.')
  );
}

function planCard(p) {
  const rate = p.task_count ? Math.round((p.done_count / p.task_count) * 100) : 0;
  return h('a', { class: 'card tape lift plan-card', href: `#/plan/${p.id}` },
    h('div', { class: 'row spread' },
      h('span', { class: 'mono small muted', text: `PLAN #${p.id} · ${p.current_rev}판` }),
      prioChip(p.priority)),
    h('div', { class: 'row spread' },
      h('span', { class: 'title', text: p.title }),
      h('span', { class: 'mono small muted', text: `${p.start_date} — ${p.end_date}` })),
    p.carried_note && h('div', { class: 'carry' },
      h('span', { class: 'hand', text: '넘겨받은 고칠 점' }),
      h('span', { text: p.carried_note })),
    h('div', {},
      h('div', { class: 'row spread small' },
        h('span', { class: 'muted', text: `완료 ${p.done_count} / ${p.task_count}` }),
        h('span', { class: 'mono', text: `${rate}%` })),
      progress(p.done_count, p.task_count)),
    h('div', { class: 'stats' },
      h('div', {}, h('span', { text: '지연' }), h('b', { class: p.late_count ? 'plus' : '', text: p.late_count })),
      h('div', {}, h('span', { text: '막힘' }), h('b', { text: p.blocked_count })),
      h('div', {}, h('span', { text: '예상(분)' }), h('b', { text: p.task_estimated_minutes })),
      h('div', {}, h('span', { text: '실제(분)' }), h('b', { text: p.task_actual_minutes }))));
}

async function newPlanPage(query) {
  const fromReview = query.get('from_review');
  let carry = null;
  if (fromReview) carry = await api('GET', `/reviews/${Number(fromReview)}`);
  render(
    crumbs('새 계획'),
    h('section', { class: 'hero' },
      h('span', { class: 'stamp', text: stampFmt.format(new Date()) }),
      h('h1', {}, h('span', { class: 'hl', text: '새 계획 세우기' }))),
    carry && h('div', { class: 'carry' },
      h('span', { class: 'hand', text: `돌아보기 #${carry.review.id}에서 넘겨받는 고칠 점` }),
      h('div', { class: 'pre', text: carry.review.improvement }),
      carry.next_plan_id && h('p', { class: 'small', text: `이 고칠 점은 이미 계획 #${carry.next_plan_id}(으)로 넘어갔습니다.` })),
    h('div', { class: 'card tape' },
      planForm({}, {
        submitText: '계획 저장',
        onSubmit: async (data) => {
          if (carry) data.carried_from_review_id = carry.review.id;
          const out = await api('POST', '/plans', data);
          flash('계획을 저장했습니다.');
          location.hash = `#/plan/${out.id}`;
        },
      }))
  );
}

// ---------- 계획 화면 ----------

async function planPage(planId, query) {
  const detail = await api('GET', `/plans/${planId}`);
  const { plan, revisions } = detail;
  const editBox = h('div', { class: 'card soft', hidden: true },
    h('h3', { text: '계획 고치기' }),
    h('p', { class: 'small muted', text: '고치기 전 내용은 아래 수정 이력에 그대로 남습니다. 계획 ID는 바뀌지 않습니다.' }),
    planForm(plan, {
      submitText: '고친 내용 저장',
      withNote: true,
      onSubmit: async (data) => {
        await api('PUT', `/plans/${planId}`, data);
        flash('계획을 고쳤습니다. 고치기 전 판은 수정 이력에 남아 있습니다.');
        router();
      },
    }));

  const tasksBox = h('section', { class: 'card flush' });
  render(
    crumbs(`계획 #${plan.id}`),
    h('section', {},
      h('div', { class: 'hero-row' },
        h('div', {},
          h('span', { class: 'eyebrow', text: `PLAN #${plan.id} · 지금 ${plan.current_rev}판` }),
          h('h1', { text: plan.title })),
        h('div', { class: 'row' },
          h('button', { type: 'button', onclick: () => { editBox.hidden = !editBox.hidden; } }, icon('edit'), '계획 고치기'),
          h('a', { class: 'btn primary', href: `#/review/${plan.id}`, text: '돌아보기 →' }))),
      h('dl', { class: 'facts' },
        fact('기간', `${plan.start_date} — ${plan.end_date}`),
        fact('우선순위', PRIORITY[plan.priority]),
        fact('예상 시간', fmtMin(plan.estimated_minutes)),
        fact('성공 기준', plan.success_criteria))),
    detail.carried_from && h('div', { class: 'carry', css: { marginTop: '18px' } },
      h('span', { class: 'hand' }, '지난 돌아보기에서 넘겨받은 고칠 점 ',
        h('a', { href: `#/review/${detail.carried_from.plan_id}`, text: `(돌아보기 #${detail.carried_from.id})` })),
      h('div', { class: 'pre', text: plan.carried_note })),
    editBox,
    tasksBox,
    h('h2', {}, '계획 수정 이력', h('span', { class: 'h-count', text: `${revisions.length}판` })),
    revisionTimeline(revisions, plan.current_rev),
    detail.reviews.length > 0 && h('h2', { text: '이 계획의 돌아보기' }),
    detail.reviews.length > 0 && reviewHistory(detail.reviews)
  );
  await renderTasks(tasksBox, planId, query);
}

function fact(label, value) {
  return h('div', {}, h('dt', { text: label }), h('dd', { text: value }));
}

function revisionTimeline(revs, current) {
  const cols = [
    ['title', '계획 이름'], ['start_date', '시작일'], ['end_date', '종료일'],
    ['priority', '우선순위', (v) => PRIORITY[v]], ['success_criteria', '성공 기준'],
    ['estimated_minutes', '예상 시간', fmtMin],
  ];
  return h('div', {},
    h('p', { class: 'small muted', text: '1판이 처음 세운 계획입니다. 한 번 쌓인 판은 바뀌지 않고, 앞 판과 달라진 값은 형광펜으로 표시합니다.' }),
    h('ol', { class: 'timeline' }, revs.map((r, i) => {
      const prev = revs[i + 1];
      return h('li', { class: r.rev_no === current ? 'current' : '' },
        h('div', { class: 'row' },
          h('strong', { text: `${r.rev_no}판${r.rev_no === current ? ' · 지금' : ''}${r.rev_no === 1 ? ' · 처음 세운 계획' : ''}` }),
          h('span', { class: 'mono small muted', text: fmtInstant(r.created_at) })),
        r.change_note && h('p', { class: 'small', css: { margin: '4px 0 0' }, text: `고친 이유 — ${r.change_note}` }),
        h('dl', { class: 'rev-grid' }, cols.map(([k, label, f]) => {
          const show = (v) => (f ? f(v) : v);
          const changed = prev && prev[k] !== r[k];
          return [h('dt', { text: label }),
            h('dd', {}, changed ? [h('del', { text: show(prev[k]) }), ' → ', h('ins', { text: show(r[k]) })] : show(r[k]))];
        })));
    })));
}

// ---------- 할 일 목록 ----------

async function renderTasks(box, planId, query) {
  const state = {
    q: query.get('q') || '',
    status: query.get('status') || 'all',
    priority: query.get('priority') || '',
    tag: query.get('tag') || '',
    sort: query.get('sort') || 'due',
  };
  const listBox = h('div', {});
  const ruleBox = h('p', { class: 'sort-rule' });
  const countBox = h('span', { class: 'h-count' });
  const tagSel = h('select', { name: 'tag', 'aria-label': '태그로 거르기' });

  const segButtons = [['all', '전체'], ['todo', '진행 중'], ['done', '완료'], ['late', '지연']].map(([v, t]) =>
    h('button', { type: 'button', 'data-v': v, 'aria-pressed': String(state.status === v), text: t, onclick: () => {
      state.status = v;
      for (const b of segButtons) b.setAttribute('aria-pressed', String(b.dataset.v === v));
      reload();
    } }));

  const toolbar = h('form', { class: 'toolbar', role: 'search', onsubmit: (e) => e.preventDefault() },
    h('input', { class: 'q', name: 'q', type: 'search', value: state.q, placeholder: '할 일 · 메모 · 태그에서 찾기', 'aria-label': '검색' }),
    h('div', { class: 'seg', role: 'group', 'aria-label': '상태로 거르기' }, segButtons),
    h('select', { name: 'priority', 'aria-label': '우선순위로 거르기' },
      h('option', { value: '', text: '우선순위 전체' }),
      [1, 2, 3].map((p) => h('option', { value: p, text: PRIORITY[p], selected: state.priority === String(p) }))),
    tagSel,
    h('select', { name: 'sort', 'aria-label': '정렬' },
      [['due', '마감일순'], ['priority', '우선순위순'], ['estimate', '예상 시간순'], ['created', '최근 만든 순']]
        .map(([v, t]) => h('option', { value: v, text: t, selected: state.sort === v }))));

  let timer;
  const reload = async () => {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(state)) if (v && !(k === 'status' && v === 'all')) qs.set(k, v);
    setQuery(qs);
    try {
      const data = await api('GET', `/plans/${planId}/tasks?${qs}`);
      ruleBox.replaceChildren(icon('sort'), h('b', { text: '정렬 기준' }), h('span', { text: data.sort.label }),
        h('span', { class: 'muted', text: `· 거르기·정렬은 서버에서 합니다 · 오늘(서울) ${data.today}` }));
      countBox.textContent = data.tasks.length;
      tagSel.replaceChildren(
        h('option', { value: '', text: '태그 전체' }),
        data.tags.map((t) => h('option', { value: t, text: `#${t}`, selected: state.tag === t })));
      listBox.replaceChildren(taskList(data.tasks, data.today, reload));
    } catch (err) {
      listBox.replaceChildren(h('p', { class: 'error', css: { padding: '0 22px' }, text: err.message }));
    }
  };
  toolbar.addEventListener('input', (e) => {
    if (!e.target.name) return;
    state[e.target.name] = e.target.value;
    clearTimeout(timer);
    timer = setTimeout(reload, e.target.name === 'q' ? 250 : 0);
  });

  box.replaceChildren(
    h('div', { class: 'card-head' }, h('h2', {}, '할 일', countBox)),
    h('details', { class: 'add-task' },
      h('summary', { class: 'btn primary' }, icon('plus', 16, 2.4), '할 일 더하기'),
      taskForm({}, {
        submitText: '할 일 저장',
        onSubmit: async (data, form) => {
          await api('POST', `/plans/${planId}/tasks`, data);
          form.reset();
          flash('할 일을 저장했습니다.');
          reload();
        },
      })),
    toolbar, ruleBox, listBox
  );
  await reload();
}

function taskForm(task, { submitText, onSubmit }) {
  const f = h('form', { class: 'grid' },
    h('label', { class: 'full' }, '할 일',
      h('input', { name: 'title', required: true, maxLength: 200, value: task.title || '', placeholder: '예: 스쿼트 5×5 (60kg)' })),
    h('label', {}, '마감일', h('input', { type: 'date', name: 'due_date', value: task.due_date || '' })),
    h('label', {}, '우선순위', prioritySelect(task.priority || 2)),
    h('label', {}, '예상 시간 (분)', h('input', { type: 'number', name: 'estimated_minutes', min: 0, step: 1, value: task.estimated_minutes ?? '' })),
    h('label', {}, h('span', {}, '태그 ', h('span', { class: 'hint', text: '쉼표로 나눔' })),
      h('input', { name: 'tags', value: (task.tags || []).join(', '), placeholder: '예: 하체, 헬스장' })),
    h('label', { class: 'full' }, '메모', h('textarea', { name: 'memo', maxLength: 2000, value: task.memo || '' })),
    h('div', { class: 'full row' }, h('button', { class: 'primary', type: 'submit', text: submitText }))
  );
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = f.querySelector('button[type=submit]');
    btn.disabled = true;
    try {
      await onSubmit(Object.fromEntries(new FormData(f)), f);
    } catch (err) {
      flash(err.message, true);
    } finally {
      btn.disabled = false;
    }
  });
  return f;
}

function taskChips(t, today) {
  const late = t.status !== 'done' && t.due_date && t.due_date < today;
  return [
    h('span', { class: 'chip ghost mono', text: `#${t.id}` }),
    t.status === 'done' ? h('span', { class: 'chip done', text: '완료' }) : h('span', { class: 'chip ghost', text: '진행 중' }),
    late
      ? h('span', { class: 'chip late', text: `지연 ${daysLate(t.due_date, today)}일 · 마감 ${t.due_date}` })
      : h('span', { class: 'chip ghost', text: `마감 ${t.due_date || '없음'}` }),
    t.blocked ? h('span', { class: 'chip block', text: '막힘' }) : null, // 서버는 0/1로 준다
    prioChip(t.priority),
    t.tags.map((g) => h('span', { class: 'chip', text: `#${g}` })),
  ];
}

function timeCell(est, act) {
  const d = (act || 0) - (est || 0);
  return h('div', { class: 'time' },
    h('span', {}, `${est ?? '—'} / `, h('strong', { class: act > (est || 0) ? 'plus' : '', text: act ?? 0 }), '분'),
    act > 0 && h('small', { class: d > 0 ? 'plus' : 'minus', text: `${signed(d)}분` }));
}

// 같은 할 일·같은 완료 주기에는 같은 요청 키를 쓴다. 서버의 UNIQUE 제약이 최종 방어선이다.
const completeKeys = new Map();
function completeKeyFor(t) {
  const k = `${t.id}:${t.reopen_count}`;
  if (!completeKeys.has(k)) completeKeys.set(k, newKey());
  return completeKeys.get(k);
}

async function completeTask(t) {
  const out = await api('POST', `/tasks/${t.id}/complete`, undefined, { 'Idempotency-Key': completeKeyFor(t) });
  flash(out.duplicate ? '이미 완료로 기록된 할 일입니다. 완료 기록을 새로 만들지 않았습니다.' : '완료로 바꿨습니다.');
  return out;
}

function checkButton(t, after) {
  const done = t.status === 'done';
  return h('button', {
    type: 'button',
    class: 'check' + (done ? ' on' : ''),
    'aria-label': done ? `${t.title} 진행 중으로 되돌리기` : `${t.title} 완료로 바꾸기`,
    title: done ? '진행 중으로 되돌리기' : '완료',
    onclick: async () => {
      try {
        if (done) { await api('POST', `/tasks/${t.id}/reopen`); flash('진행 중으로 되돌렸습니다.'); }
        else await completeTask(t);
      } catch (err) { flash(err.message, true); }
      after();
    },
  }, done && icon('check', 14, 3.2));
}

function taskList(tasks, today, reload) {
  if (!tasks.length) return h('p', { class: 'empty', css: { margin: '14px 22px 22px' }, text: '조건에 맞는 할 일이 없습니다.' });
  return h('ul', { class: 'list' }, tasks.map((t) => {
    const edit = h('div', { hidden: true, class: 'card soft editbox' },
      taskForm(t, {
        submitText: '고친 내용 저장',
        onSubmit: async (data) => {
          await api('PUT', `/tasks/${t.id}`, data);
          flash('할 일을 고쳤습니다.');
          reload();
        },
      }));
    return h('li', { class: 'task' + (t.status === 'done' ? ' is-done' : '') },
      checkButton(t, reload),
      h('div', {},
        h('a', { class: 'task-title', href: `#/task/${t.id}`, text: t.title }),
        h('div', { class: 'meta' }, taskChips(t, today)),
        t.memo && h('div', { class: 'small muted pre', css: { marginTop: '6px' }, text: t.memo }),
        h('div', { class: 'task-actions' },
          t.status === 'done'
            ? h('button', { type: 'button', onclick: act(async () => {
                await api('POST', `/tasks/${t.id}/reopen`);
                flash('진행 중으로 되돌렸습니다.');
              }) }, icon('undo', 14), '진행 중으로 되돌리기')
            : h('button', { type: 'button', class: 'teal', onclick: act(() => completeTask(t)) }, icon('check', 14, 2.6), '완료'),
          h('button', { type: 'button', onclick: () => { edit.hidden = !edit.hidden; } }, icon('edit', 14), '고치기'),
          h('a', { class: 'btn', href: `#/task/${t.id}`, text: '실행 기록 적기' }),
          h('button', { type: 'button', class: 'danger', onclick: act(async () => {
            if (!confirm(`"${t.title}" 할 일을 지울까요? 돌아보기 집계에서도 빠집니다.`)) return;
            await api('DELETE', `/tasks/${t.id}`);
            flash('할 일을 지웠습니다.');
          }) }, icon('trash', 14), '지우기'))),
      timeCell(t.estimated_minutes, t.actual_minutes),
      edit);
  }));

  function act(fn) {
    return async () => {
      try { await fn(); } catch (err) { flash(err.message, true); }
      reload();
    };
  }
}

// ---------- 할 일 화면 (실행 기록) ----------

async function taskPage(taskId) {
  const { task, plan, executions, completions } = await api('GET', `/tasks/${taskId}`);
  const today = seoulToday();
  const actualSum = executions.reduce((s, e) => s + e.actual_minutes, 0);
  const blocked = executions.some((e) => e.blocker && e.blocker.trim());
  const est = task.estimated_minutes || 0;
  const max = Math.max(est, actualSum, 1);

  const nowLocal = isoToLocal(new Date().toISOString());
  const startIn = h('input', { class: 'mono', type: 'datetime-local', name: 'started_at', required: true, value: nowLocal });
  const endIn = h('input', { class: 'mono', type: 'datetime-local', name: 'ended_at', required: true, value: nowLocal });
  const minIn = h('input', { class: 'mono', type: 'number', name: 'actual_minutes', min: 0, step: 1, placeholder: '비우면 시작~끝으로 계산' });
  const syncMin = () => {
    if (!startIn.value || !endIn.value) return;
    const d = Math.round((Date.parse(localToIso(endIn.value)) - Date.parse(localToIso(startIn.value))) / 60000);
    if (d >= 0) minIn.value = d;
  };
  startIn.addEventListener('change', syncMin);
  endIn.addEventListener('change', syncMin);

  const execForm = h('form', { class: 'grid' },
    h('label', {}, '시작 시각 (서울)', startIn),
    h('label', {}, '끝난 시각 (서울)', endIn),
    h('label', {}, '실제로 걸린 시간 (분)', minIn),
    h('label', { class: 'full' }, h('span', {}, '막혔던 이유 ', h('span', { class: 'hint', text: '없으면 비워 두세요 · 적으면 돌아보기의 막힘 수에 들어갑니다' })),
      h('textarea', { name: 'blocker', maxLength: 1000, placeholder: '예: 무릎이 아파서 마지막 세트를 못 함' })),
    h('label', { class: 'full' }, '메모', h('input', { name: 'note', maxLength: 1000 })),
    h('div', { class: 'full row' }, h('button', { class: 'primary', type: 'submit', text: '실행 기록 저장' })));
  execForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(execForm));
    try {
      await api('POST', `/tasks/${taskId}/executions`, {
        started_at: localToIso(d.started_at),
        ended_at: localToIso(d.ended_at),
        actual_minutes: d.actual_minutes,
        blocker: d.blocker,
        note: d.note,
      });
      flash('실행 기록을 저장했습니다. 계획과 할 일의 예상 값은 그대로입니다.');
      router();
    } catch (err) {
      flash(err.message, true);
    }
  });

  const doubleOut = h('div', { class: 'small mono' });
  const toggleDone = async () => {
    try {
      if (task.status === 'done') { await api('POST', `/tasks/${taskId}/reopen`); flash('진행 중으로 되돌렸습니다.'); }
      else await completeTask(task);
    } catch (err) { flash(err.message, true); }
    router();
  };

  render(
    crumbs(h('a', { href: `#/plan/${plan.id}`, text: `계획 #${plan.id} ${plan.title}` }), `할 일 #${task.id}`),
    h('section', { class: 'hero-row' },
      h('div', {},
        h('span', { class: 'eyebrow', text: `TASK #${task.id} · ${task.status === 'done' ? '완료' : '진행 중'}` }),
        h('h1', { text: task.title }),
        h('div', { class: 'row', css: { marginTop: '10px' } }, taskChips({ ...task, blocked }, today))),
      h('div', { class: 'row' },
        h('button', { type: 'button', class: 'danger', onclick: async () => {
          if (!confirm(`"${task.title}" 할 일을 지울까요? 돌아보기 집계에서도 빠집니다.`)) return;
          try { await api('DELETE', `/tasks/${taskId}`); flash('할 일을 지웠습니다.'); location.hash = `#/plan/${plan.id}`; } catch (err) { flash(err.message, true); }
        } }, icon('trash'), '지우기'),
        h('a', { class: 'btn', href: `#/plan/${plan.id}` }, icon('edit'), '계획에서 고치기'),
        task.status === 'done'
          ? h('button', { type: 'button', onclick: toggleDone }, icon('undo'), '진행 중으로 되돌리기')
          : h('button', { type: 'button', class: 'primary', onclick: toggleDone }, icon('check', 16, 2.6), '완료'))),
    task.memo && h('p', { class: 'pre muted', text: task.memo }),

    h('div', { class: 'split', css: { marginTop: '24px' } },
      h('section', { class: 'card tape', css: { margin: '0' } },
        h('h3', { text: '실제로 한 일 적기' }),
        h('p', { class: 'small muted', css: { margin: '0 0 14px' }, text: `이 기록은 할 일 #${task.id}에 이어집니다. 계획과 할 일의 예상 값은 바뀌지 않습니다.` }),
        execForm),
      h('section', { class: 'card teal', css: { margin: '0' } },
        h('span', { class: 'hand', css: { fontSize: '20px' }, text: '예상과 실제' }),
        h('div', { class: 'bars', css: { marginTop: '14px' } },
          h('div', { class: 'bar-row' }, h('span', { text: '예상' }), h('div', { class: 'bar' }, h('span', { css: { width: `${(est / max) * 100}%` } })), h('span', { class: 'mono', text: `${est}분` })),
          h('div', { class: 'bar-row' }, h('span', { text: '실제' }), h('div', { class: 'bar actual' }, h('span', { css: { width: `${(actualSum / max) * 100}%` } })), h('span', { class: 'mono', text: `${actualSum}분` })),
          h('div', { class: 'big-diff' }, h('span', { text: '차이 (실제 − 예상)' }), h('b', { text: `${signed(actualSum - est)}분` }))))),

    h('h2', {}, '실행 기록', h('span', { class: 'h-count', text: `${executions.length}건 · ${actualSum}분` })),
    executions.length
      ? h('div', { class: 'card flush table-wrap' }, executionTable(executions, true))
      : h('p', { class: 'empty', text: '아직 실행 기록이 없습니다.' }),

    h('h2', {}, '완료 기록', h('span', { class: 'h-count', text: `${completions.length}건` })),
    h('p', { class: 'small muted', text: '완료할 때마다 한 건씩 생기고, 되돌리면 되돌린 시각이 적힙니다. 같은 완료를 두 번 눌러도 새 기록은 생기지 않습니다.' }),
    completions.length
      ? h('div', { class: 'card flush table-wrap' },
          h('table', {},
            h('thead', {}, h('tr', {}, ['기록 ID', '완료 주기', '완료 시각', '되돌린 시각'].map((t) => h('th', { text: t })))),
            h('tbody', {}, completions.map((c) => h('tr', {},
              h('td', { class: 'mono', text: `#${c.id}` }), h('td', { class: 'mono', text: `${c.cycle + 1}회차` }),
              h('td', { class: 'mono', text: fmtInstant(c.completed_at) }),
              h('td', { class: 'mono', text: c.reverted_at ? fmtInstant(c.reverted_at) : '—' }))))))
      : h('p', { class: 'empty', text: '아직 완료 기록이 없습니다.' }),

    task.status !== 'done' && h('details', { class: 'card' },
      h('summary', { css: { fontWeight: '600' }, text: '점검: 완료 요청을 연달아 두 번 보내 보기' }),
      h('p', { class: 'small', text: '버튼 잠금 없이 완료 요청 두 개를 동시에 서버로 보냅니다. 완료 기록과 돌아보기 완료 수가 각각 1만 늘어나면 통과입니다.' }),
      h('button', { type: 'button', text: '완료 요청 두 번 동시에 보내기', onclick: async () => {
        try {
          const before = await counts(plan.id, taskId);
          const [r1, r2] = await Promise.all([
            api('POST', `/tasks/${taskId}/complete`, undefined, { 'Idempotency-Key': newKey() }),
            api('POST', `/tasks/${taskId}/complete`, undefined, { 'Idempotency-Key': newKey() }),
          ]);
          const after = await counts(plan.id, taskId);
          const pass = after.comps - before.comps === 1 && after.done - before.done === 1;
          doubleOut.replaceChildren(
            h('p', { text: `요청 1: ${r1.duplicate ? '중복으로 처리(기록 안 만듦)' : '완료 기록 #' + r1.completion_id + ' 생성'}` }),
            h('p', { text: `요청 2: ${r2.duplicate ? '중복으로 처리(기록 안 만듦)' : '완료 기록 #' + r2.completion_id + ' 생성'}` }),
            h('p', { text: `이 할 일의 완료 기록: ${before.comps}건 → ${after.comps}건 (+${after.comps - before.comps})` }),
            h('p', { text: `돌아보기 완료 수: ${before.done} → ${after.done} (+${after.done - before.done})` }),
            h('p', { css: { fontWeight: '700' } }, h('span', { class: pass ? 'hl' : 'error', text:
              pass ? '결과: 통과 — 기록 1건, 집계 1만 늘었습니다.' : '결과: 확인 필요' })),
            h('button', { type: 'button', text: '화면 새로 읽기', onclick: router }));
        } catch (err) {
          flash(err.message, true);
        }
      } }),
      doubleOut)
  );
}

async function counts(planId, taskId) {
  const [r, t] = await Promise.all([api('GET', `/plans/${planId}/review`), api('GET', `/tasks/${taskId}`)]);
  return { done: r.counts.done, comps: t.completions.length };
}

function executionTable(execs, withDelete, withTask = false) {
  return h('table', {},
    h('thead', {}, h('tr', {},
      [withTask && '할 일', '기록 ID', '시작 시각', '끝난 시각', '실제 시간', '막혔던 이유', '메모', withDelete && '']
        .filter((x) => x !== false).map((t) => h('th', { text: t })))),
    h('tbody', {}, execs.map((e) => h('tr', {},
      withTask && h('td', {}, h('a', { href: `#/task/${e.task_id}`, text: `#${e.task_id} ${e.task_title}` })),
      h('td', { class: 'mono', text: `#${e.id}` }),
      h('td', { class: 'mono', text: fmtInstant(e.started_at) }),
      h('td', { class: 'mono', text: fmtInstant(e.ended_at) }),
      h('td', { class: 'mono', text: fmtMin(e.actual_minutes) }),
      h('td', {}, e.blocker ? [h('span', { class: 'chip block', text: '막힘' }), ' ', h('span', { class: 'pre', text: e.blocker })] : h('span', { class: 'muted', text: '—' })),
      h('td', { class: 'pre', text: e.note || '' }),
      withDelete && h('td', {}, h('button', { type: 'button', class: 'link danger', text: '지우기', onclick: async () => {
        if (!confirm(`실행 기록 #${e.id}을(를) 지울까요?`)) return;
        try { await api('DELETE', `/executions/${e.id}`); flash('실행 기록을 지웠습니다.'); } catch (err) { flash(err.message, true); }
        router();
      } }))))));
}

// ---------- 돌아보기 ----------

function periodQS(query) {
  const qs = new URLSearchParams();
  if (query.get('from')) qs.set('from', query.get('from'));
  if (query.get('to')) qs.set('to', query.get('to'));
  return qs.toString();
}

function metricValue(key, c) {
  return { estimated: c.estimated_minutes, actual: c.actual_minutes, diff: c.diff_minutes }[key] ?? c[key];
}

function headline(c) {
  if (!c.planned) return '아직 돌아볼 할 일이 없습니다.';
  const t = c.diff_minutes === 0 ? '예상한 만큼 썼고,' : `예상보다 ${Math.abs(c.diff_minutes)}분 ${c.diff_minutes < 0 ? '덜' : '더'} 썼고,`;
  return [t, `${c.planned}개 중 ${c.done}개를 끝냈습니다.`];
}

async function reviewPage(planId, query) {
  const qs = periodQS(query);
  const [r, detail] = await Promise.all([
    api('GET', `/plans/${planId}/review${qs ? '?' + qs : ''}`),
    api('GET', `/plans/${planId}`),
  ]);
  const c = r.counts;
  const link = (k) => `#/review/${planId}/${k}${qs ? '?' + qs : ''}`;

  const periodForm = h('form', { class: 'row', css: { alignItems: 'flex-end' } },
    h('label', {}, '기간 시작 · 마감일 기준', h('input', { class: 'mono', type: 'date', name: 'from', value: r.period.from || '' })),
    h('label', {}, '기간 끝', h('input', { class: 'mono', type: 'date', name: 'to', value: r.period.to || '' })),
    h('button', { type: 'submit', text: '모아 보기' }),
    h('button', { type: 'button', class: 'link', text: '계획 기간', onclick: () => {
      location.hash = `#/review/${planId}?from=${r.plan.start_date}&to=${r.plan.end_date}`;
    } }),
    h('button', { type: 'button', class: 'link', text: '전체', onclick: () => { location.hash = `#/review/${planId}`; } }));
  periodForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const d = new URLSearchParams();
    for (const [k, v] of new FormData(periodForm)) if (v) d.set(k, v);
    location.hash = `#/review/${planId}${d.toString() ? '?' + d : ''}`;
  });

  const improveForm = h('form', { class: 'grid' },
    h('label', { class: 'full' }, h('span', { class: 'sr-only', text: '고칠 점' }),
      h('input', { name: 'improvement', required: true, maxLength: 300, placeholder: '예: 마감을 평일 저녁이 아니라 주말 오전으로 잡는다', 'aria-label': '다음 계획으로 넘길 고칠 점' })),
    h('div', { class: 'full row' }, h('button', { class: 'primary', type: 'submit', text: '돌아보기 저장' })));
  improveForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const out = await api('POST', `/plans/${planId}/reviews`, {
        period_from: r.period.from, period_to: r.period.to,
        improvement: new FormData(improveForm).get('improvement'),
      });
      flash(`돌아보기 #${out.id}을(를) 저장했습니다. 아래에서 다음 계획으로 넘길 수 있습니다.`);
      router();
    } catch (err) {
      flash(err.message, true);
    }
  });

  // 할 일별 예상·실제 막대
  const actByTask = new Map();
  for (const e of r.executions) actByTask.set(e.task_id, (actByTask.get(e.task_id) || 0) + e.actual_minutes);
  const scale = Math.max(1, ...r.tasks.map((t) => Math.max(t.estimated_minutes || 0, actByTask.get(t.id) || 0)));

  const head = headline(c);
  render(
    crumbs(h('a', { href: `#/plan/${planId}`, text: `계획 #${planId} ${r.plan.title}` }), '돌아보기'),
    h('section', { class: 'hero' },
      h('div', { class: 'hero-row' },
        h('div', {},
          h('span', { class: 'stamp', text: `돌아보기 · 오늘(서울) ${r.today}` }),
          h('h1', { css: { fontSize: '38px', lineHeight: '54px' } },
            Array.isArray(head) ? [h('span', { class: 'hl', text: head[0] }), h('br'), head[1]] : head)),
        periodForm)),
    h('p', { class: 'small muted', text:
      `대상: ${r.period.from || r.period.to ? `마감일이 ${r.period.from || '처음'} ~ ${r.period.to || '끝'}인 할 일` : '이 계획의 모든 할 일'} · 숫자를 누르면 그 숫자가 나온 기록으로 갑니다` }),

    h('div', { class: 'metrics' }, ['planned', 'done', 'late', 'blocked'].map((k) =>
      h('a', { class: `metric k-${k}`, href: link(k) },
        h('span', { class: 'label', text: METRICS[k].label }),
        h('span', { class: 'value', text: c[k] }),
        h('span', { class: 'rule', text: METRICS[k].rule }),
        h('span', { class: 'go', text: `근거 기록 ${c[k]}건 →` })))),

    h('section', { class: 'card lift time-card', css: { marginTop: '20px' } },
      h('div', { class: 'time-sum' },
        h('h3', { text: '계획이 얼마나 빗나갔나' }),
        h('a', { href: link('estimated') }, h('span', { text: '예상 시간 합계' }), h('b', {}, `${c.estimated_minutes}`, h('small', { class: 'muted', text: '분' }))),
        h('a', { href: link('actual') }, h('span', { text: '실제 시간 합계' }), h('b', { css: { color: 'var(--accent)' } }, `${c.actual_minutes}`, h('small', { class: 'muted', text: '분' }))),
        h('a', { href: link('diff') }, h('span', { text: '차이 (실제 − 예상)' }), h('b', { class: c.diff_minutes > 0 ? 'plus' : c.diff_minutes < 0 ? 'minus' : '', css: { fontSize: '32px' } }, signed(c.diff_minutes), h('small', { class: 'muted', text: '분' })))),
      h('div', {},
        h('div', { class: 'legend' }, h('span', {}, h('i'), '예상'), h('span', {}, h('i', { class: 'a' }), '실제'), h('span', { class: 'mono', css: { marginLeft: 'auto' }, text: `0 — ${scale}분` })),
        r.tasks.length
          ? h('div', { class: 'task-bars' }, r.tasks.map((t) => {
              const a = actByTask.get(t.id) || 0;
              const e = t.estimated_minutes || 0;
              return [
                h('a', { href: `#/task/${t.id}`, text: `#${t.id} ${t.title}` }),
                h('div', { class: 'pair' },
                  h('span', { css: { width: `${(e / scale) * 100}%` } }),
                  h('span', { class: 'a', css: { width: `${(a / scale) * 100}%` } })),
                h('span', { class: 'mono ' + (a - e > 0 ? 'plus' : a - e < 0 ? 'minus' : ''), css: { textAlign: 'right', fontWeight: '600' }, text: signed(a - e) }),
              ];
            }))
          : h('p', { class: 'muted small', text: '대상 할 일이 없습니다.' }))),

    h('div', { class: 'split', css: { marginTop: '28px' } },
      h('section', { class: 'card teal', css: { margin: '0' } },
        h('span', { class: 'hand', css: { fontSize: '22px' }, text: '다음 계획으로 넘길 한 줄' }),
        h('p', { class: 'small', css: { margin: '4px 0 14px', opacity: '.9' }, text: '지금 보이는 숫자와 함께 저장됩니다. 저장한 고칠 점 한 건은 다음 계획 하나로 넘어갑니다.' }),
        improveForm),
      h('section', {},
        h('h3', { text: '저장한 돌아보기' }),
        detail.reviews.length ? reviewHistory(detail.reviews) : h('p', { class: 'empty', text: '아직 저장한 돌아보기가 없습니다.' })))
  );
}

function reviewHistory(reviews) {
  return h('div', {}, reviews.map((rv) => {
    const c = rv.snapshot.counts;
    return h('article', { class: 'card', css: { margin: '0 0 14px' } },
      h('div', { class: 'row spread' },
        h('strong', { text: `돌아보기 #${rv.id}` }),
        h('span', { class: 'small muted mono', text: fmtInstant(rv.created_at) })),
      h('p', { class: 'small muted mono', css: { margin: '6px 0' }, text:
        `기간 ${rv.period_from || '처음'} ~ ${rv.period_to || '끝'} · 계획 ${c.planned} · 완료 ${c.done} · 지연 ${c.late} · 막힘 ${c.blocked} · 예상 ${c.estimated_minutes} · 실제 ${c.actual_minutes} · 차이 ${signed(c.diff_minutes)}` }),
      h('p', { css: { margin: '0 0 12px', fontSize: '16px' } }, h('span', { class: 'hl pre', text: rv.improvement })),
      rv.next_plan_id
        ? h('a', { href: `#/plan/${rv.next_plan_id}`, text: `→ 다음 계획 #${rv.next_plan_id}(으)로 넘어갔습니다` })
        : h('a', { class: 'btn primary', href: `#/new-plan?from_review=${rv.id}`, text: '이 한 줄로 다음 계획 세우기 →' }));
  }));
}

async function drillPage(planId, metric, query) {
  const m = METRICS[metric];
  if (!m) throw new Error('없는 집계 항목입니다.');
  const qs = periodQS(query);
  const r = await api('GET', `/plans/${planId}/review${qs ? '?' + qs : ''}`);
  const c = r.counts;
  const byId = new Map(r.tasks.map((t) => [t.id, t]));
  const execByTask = new Map();
  for (const e of r.executions) execByTask.set(e.task_id, (execByTask.get(e.task_id) || 0) + e.actual_minutes);

  let body;
  if (metric === 'actual') {
    body = r.executions.length
      ? h('div', { class: 'card flush table-wrap' }, executionTable(r.executions, false, true),
          h('p', { class: 'sum-line mono', css: { margin: '0' }, text: `합계 ${r.executions.map((e) => e.actual_minutes).join(' + ')} = ${c.actual_minutes}분` }))
      : h('p', { class: 'empty', text: '실행 기록이 없어 0분입니다.' });
  } else {
    const ids = { estimated: r.ids.planned, diff: r.ids.planned }[metric] || r.ids[metric];
    const rows = ids.map((i) => byId.get(i));
    const showTime = metric === 'estimated' || metric === 'diff';
    body = rows.length
      ? [h('div', { class: 'card flush table-wrap' },
          h('table', {},
            h('thead', {}, h('tr', {},
              ['할 일', '상태', '마감일', '우선순위', '예상 시간', showTime && '실제 시간(실행 기록 합)', showTime && '차이']
                .filter(Boolean).map((t) => h('th', { text: t })))),
            h('tbody', {}, rows.map((t) => {
              const act = execByTask.get(t.id) || 0;
              return h('tr', {},
                h('td', {}, h('a', { href: `#/task/${t.id}`, text: `#${t.id} ${t.title} →` })),
                h('td', {}, t.status === 'done' ? h('span', { class: 'chip done', text: '완료' }) : h('span', { class: 'chip ghost', text: '진행 중' })),
                h('td', { class: 'mono', text: t.due_date || '없음' }),
                h('td', { text: PRIORITY[t.priority] }),
                h('td', { class: 'mono', text: fmtMin(t.estimated_minutes) }),
                showTime && h('td', { class: 'mono', text: fmtMin(act) }),
                showTime && h('td', { class: 'mono', text: `${signed(act - (t.estimated_minutes || 0))}분` }));
            }))),
          metric === 'estimated' && h('p', { class: 'sum-line mono', css: { margin: '0' }, text:
            `합계 ${rows.map((t) => t.estimated_minutes || 0).join(' + ')} = ${c.estimated_minutes}분` }),
          metric === 'diff' && h('p', { class: 'sum-line mono', css: { margin: '0' }, text:
            `실제 ${c.actual_minutes}분 − 예상 ${c.estimated_minutes}분 = ${signed(c.diff_minutes)}분` })),
        metric === 'blocked' && h('h2', { text: '막힌 이유가 적힌 실행 기록' }),
        metric === 'blocked' && h('div', { class: 'card flush table-wrap' },
          executionTable(r.executions.filter((e) => e.blocker && e.blocker.trim()), false, true))]
      : h('p', { class: 'empty', text: '해당하는 할 일이 없어 0입니다.' });
  }

  render(
    crumbs(h('a', { href: `#/plan/${planId}`, text: `계획 #${planId} ${r.plan.title}` }),
      h('a', { href: `#/review/${planId}${qs ? '?' + qs : ''}`, text: '돌아보기' }), `근거 기록 · ${m.label}`),
    h('section', { class: 'hero' },
      h('span', { class: 'stamp', text: '근거 기록' }),
      h('h1', {}, h('span', { class: 'hl', text: `${m.label} ${metric === 'diff' ? signed(c.diff_minutes) : metricValue(metric, c)}${m.unit || ''}` })),
      h('p', { text: `계산 규칙 — ${m.rule}. 오늘(서울) ${r.today}.` })),
    body
  );
}
