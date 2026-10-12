'use strict';
// 내 계정·5일 기록 화면. app.js의 h·api·render·flash·ME 등을 함께 쓴다(app.js보다 먼저 불러온다).
// 사용자가 적은 글은 모두 textContent로만 넣는다.

// ---------- 내 계정 ----------

function accountPage() {
  const pwForm = h('form', { class: 'grid' },
    h('label', {}, '지금 비밀번호', h('input', { name: 'current_password', type: 'password', required: true, autocomplete: 'current-password' })),
    h('label', {}, h('span', {}, '새 비밀번호 ', h('span', { class: 'hint', text: '10자 이상' })),
      h('input', { name: 'new_password', type: 'password', required: true, minLength: 10, maxLength: 128, autocomplete: 'new-password' })),
    h('label', {}, '새 비밀번호 확인', h('input', { name: 'new_password2', type: 'password', required: true, autocomplete: 'new-password' })),
    h('div', { class: 'full row' }, h('button', { class: 'primary', type: 'submit', text: '비밀번호 바꾸기' })));
  pwForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(pwForm));
    if (d.new_password !== d.new_password2) { flash('새 비밀번호 두 개가 다릅니다.', true); return; }
    try {
      await api('POST', '/auth/password', { current_password: d.current_password, new_password: d.new_password });
      pwForm.reset();
      flash('비밀번호를 바꿨습니다. 이전에 로그인해 둔 다른 브라우저는 모두 로그아웃되었습니다.');
    } catch (err) {
      flash(err.message, true);
    }
  });

  const delForm = h('form', { class: 'grid' },
    h('label', { class: 'full' }, '비밀번호 확인', h('input', { name: 'password', type: 'password', required: true, autocomplete: 'current-password' })),
    h('div', { class: 'full row' }, h('button', { class: 'danger', type: 'submit', text: '계정과 내 자료 모두 지우기' })));
  delForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!confirm(`${ME.username} 계정과 모든 자료를 지울까요? 되돌릴 수 없습니다.`)) return;
    try {
      await api('DELETE', '/auth/account', { password: new FormData(delForm).get('password') });
      ME = null;
      renderNav();
      flash('계정과 자료를 모두 지웠습니다.');
      location.hash = '#/signup';
      router();
    } catch (err) {
      flash(err.message, true);
    }
  });

  render(
    crumbs('내 계정'),
    h('section', { class: 'hero' },
      h('span', { class: 'stamp', text: '내 계정' }),
      h('h1', {}, h('span', { class: 'hl', text: `${ME.username} 님` }))),
    h('section', { class: 'card' },
      h('h3', { text: '내 자료 내보내기' }),
      h('p', { class: 'small muted', text: '계획·할 일·실행 기록·돌아보기·5일 기록을 JSON 파일 하나로 받습니다. 비밀번호(해시 포함)와 세션 값은 들어 있지 않습니다.' }),
      h('a', { class: 'btn primary', href: '/api/export', download: '', text: '내 자료 전체 내보내기' })),
    h('section', { class: 'card' },
      h('h3', { text: '비밀번호 바꾸기' }),
      h('p', { class: 'small muted', text: '바꾸면 이 계정으로 로그인해 둔 모든 브라우저의 세션이 서버에서 끊깁니다. 지금 브라우저만 새로 로그인된 상태로 남습니다.' }),
      pwForm),
    h('section', { class: 'card danger-zone' },
      h('h3', { text: '계정 지우기' }),
      h('p', { css: { margin: '0 0 12px' } },
        h('strong', { class: 'plus', text: '계정을 지우면 내 계획·할 일·실행 기록·완료 기록·돌아보기·5일 기록이 모두 함께 지워지고, 되돌릴 수 없습니다.' }),
        ' 필요하면 먼저 내보내기로 파일을 받아 두세요.'),
      delForm)
  );
}

// ---------- 5일 기록 ----------

const WEEKDAY = ['일', '월', '화', '수', '목', '금', '토'];
const dayLabel = (d) => `${d} (${WEEKDAY[new Date(d + 'T00:00:00Z').getUTCDay()]})`;
const fmtVal = (v, unit) => (v === null || v === undefined ? '빠짐' : `${v}${unit}`);

const EXP_FIELDS = [
  ['question', '1일차에 답하려는 질문', '예: 운동을 아침에 하도록 계획하면, 계획한 운동을 실제로 더 오래 하게 될까?'],
  ['metric', '관찰 지표 (하나)', '예: 그날 실제로 운동한 시간'],
  ['unit', '단위', '예: 분'],
  ['calc_rule', '계산 규칙', '예: 그날(서울 날짜) 실행 기록의 실제 시간을 모두 더한 값'],
  ['plan_rule', '1~2일차에 따를 계획 규칙', '예: 운동은 퇴근 뒤 저녁 8시에 시작한다'],
];
const RULE_FIELDS = [
  ['missing_rule', '값이 빠졌을 때'],
  ['duplicate_rule', '값이 중복될 때'],
  ['outlier_rule', '값이 유난히 튈 때'],
  ['rounding_rule', '반올림'],
  ['week_start', '주 시작 요일'],
];

async function experimentPage() {
  const st = await api('GET', '/experiment');
  if (!st.experiment) return experimentSetup(st);
  const x = st.experiment;
  const unit = x.unit;

  let action;
  if (st.next === 'log' || st.next === 'wait') {
    const editing = st.next === 'wait' ? st.today_log : null;
    const valIn = h('input', { class: 'mono', type: 'number', step: '0.1', name: 'value', value: editing && editing.value !== null ? editing.value : '' });
    const missIn = h('input', { type: 'checkbox', name: 'missing', checked: !!editing && editing.value === null });
    const noteIn = h('input', { name: 'note', maxLength: 1000, value: editing ? editing.note : '' });
    const f = h('form', { class: 'grid' },
      h('label', {}, `${x.metric} (${unit})`, valIn),
      h('label', { class: 'check-label' }, missIn, '오늘은 값을 못 적었다(빠짐)'),
      h('label', { class: 'full' }, h('span', {}, '메모 ', h('span', { class: 'hint', text: '튀는 값이면 이유를 적어 두세요' })), noteIn),
      h('div', { class: 'full row' }, h('button', { class: 'primary', type: 'submit',
        text: editing ? `오늘(${editing.day_no}일차) 기록 고치기` : `${st.logs.length + 1}일차 기록 저장 · 오늘 ${st.today}` })));
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      const payload = { value: valIn.value === '' ? null : valIn.value, missing: missIn.checked, note: noteIn.value };
      if (!payload.missing && payload.value === null) { flash('값을 적거나 "빠짐"을 골라 주세요.', true); return; }
      try {
        if (editing) await api('PUT', `/experiment/logs/${editing.id}`, payload);
        else await api('POST', '/experiment/logs', payload);
        flash(editing ? '오늘 기록을 고쳤습니다.' : '오늘 기록을 저장했습니다.');
        router();
      } catch (err) { flash(err.message, true); }
    });
    action = h('section', { class: 'card tape' },
      h('h3', { text: editing ? `오늘은 이미 ${editing.day_no}일차를 기록했습니다` : `오늘 기록하기 — ${st.logs.length + 1}일차` }),
      h('p', { class: 'small muted', text: editing
        ? `같은 날 두 번째 기록은 받지 않습니다. 오늘(${st.today}) 안에는 고칠 수 있고, ${st.logs.length < 5 ? `다음 날 ${st.logs.length + 1}일차를 적을 수 있습니다.` : '5일을 모두 채웠습니다.'}`
        : `날짜는 서버가 서울 기준 오늘(${dayLabel(st.today)})로 정합니다. 지금 따르는 계획 규칙: ${st.current_rule}` }),
      f);
  } else if (st.next === 'change_rule') {
    const f = h('form', { class: 'grid' },
      h('label', { class: 'full' }, '지금 규칙', h('input', { value: x.plan_rule, disabled: true })),
      h('label', { class: 'full' }, '새 계획 규칙 (하나만 바꿉니다)', h('input', { name: 'new_rule', required: true, maxLength: 500, placeholder: '예: 운동은 출근 전 아침 7시에 시작한다' })),
      h('label', { class: 'full' }, '바꾼 이유', h('textarea', { name: 'reason', required: true, maxLength: 500, placeholder: '1~2일차 기록을 보고 왜 바꾸는지' })),
      h('div', { class: 'full row' }, h('button', { class: 'primary', type: 'submit', text: '계획 규칙 바꾸기' })));
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!confirm('계획 규칙은 한 번만 바꿀 수 있습니다. 바꿀까요?')) return;
      try {
        await api('POST', '/experiment/rule-change', Object.fromEntries(new FormData(f)));
        flash('계획 규칙을 바꿨습니다. 3일차는 다음 날짜부터 기록할 수 있습니다.');
        router();
      } catch (err) { flash(err.message, true); }
    });
    action = h('section', { class: 'card tape' },
      h('h3', { text: '3일차 전에 계획 규칙 바꾸기' }),
      h('p', { class: 'small muted', text: `1일차(${dayLabel(st.logs[0].log_date)})와 2일차(${dayLabel(st.logs[1].log_date)}) 기록을 보고 계획 규칙을 하나만 바꿉니다. 바꾸기 전에는 3일차를 적을 수 없습니다.` }),
      f);
  } else {
    action = h('section', { class: 'card soft' }, h('h3', { text: '5일 기록을 모두 마쳤습니다' }),
      h('p', { class: 'small', text: '아래 비교표가 규칙을 바꾸기 전(1~2일차)과 뒤(3~5일차)를 같은 지표·같은 단위·같은 계산 규칙으로 비교한 결과입니다.' }));
  }

  // 날짜별 기록(2일차 뒤에 규칙 변경을 끼워 넣는다)
  const items = [];
  for (const l of st.logs) {
    items.push(h('li', {},
      h('div', { class: 'row' }, h('strong', { text: `${l.day_no}일차` }), h('span', { class: 'mono', text: dayLabel(l.log_date) }),
        h('span', { class: 'chip' + (l.value === null ? ' late' : ''), text: fmtVal(l.value, unit) })),
      h('p', { class: 'small tight', text: `따른 규칙: ${l.plan_rule}` }),
      l.note ? h('p', { class: 'small muted pre tight', text: `메모: ${l.note}` }) : null,
      h('p', { class: 'small muted mono tight', text: `기록 #${l.id} · 저장 ${fmtInstant(l.created_at)}${l.updated_at !== l.created_at ? ` · 고침 ${fmtInstant(l.updated_at)}` : ''}` })));
    if (l.day_no === 2 && st.rule_change) {
      const rc = st.rule_change;
      items.push(h('li', { class: 'current' },
        h('div', { class: 'row' }, h('strong', { text: '계획 규칙 변경' }), h('span', { class: 'mono small', text: fmtInstant(rc.changed_at) })),
        h('dl', { class: 'rev-grid' },
          h('dt', { text: '바꾸기 전' }), h('dd', {}, h('del', { text: rc.old_rule })),
          h('dt', { text: '바꾼 뒤' }), h('dd', {}, h('ins', { text: rc.new_rule })),
          h('dt', { text: '이유' }), h('dd', { text: rc.reason }),
          h('dt', { text: '가리키는 기록' }), h('dd', { class: 'mono', text: `1일차 기록 #${rc.day1_log_id} · 2일차 기록 #${rc.day2_log_id} 뒤, 3일차 앞` }))));
    }
  }

  const s = st.summary;
  const expr = (p) => (p.counted ? `${p.values.join(' + ')} = ${p.sum}` : '—');
  const avgExpr = (p) => (p.counted ? `${p.sum} ÷ ${p.counted} = ${p.average}` : '—');
  const row = (label, p) => h('tr', {},
    h('td', { text: label }),
    h('td', { class: 'mono', text: p.days.length ? p.days.map((d) => `${d}일차`).join(', ') : '—' }),
    h('td', { class: 'mono', text: `${p.counted}일${p.missing ? ` (빠짐 ${p.missing}일)` : ''}` }),
    h('td', { class: 'mono', text: expr(p) }),
    h('td', { class: 'mono', text: avgExpr(p) }));

  render(
    crumbs('5일 기록'),
    h('section', { class: 'hero' },
      h('span', { class: 'stamp', text: `5일 기록 · 오늘(서울) ${dayLabel(st.today)} · ${st.logs.length}/5일` }),
      h('h1', { class: 'question' }, h('span', { class: 'hl', text: x.question }))),
    h('section', { class: 'card' },
      h('h3', { text: '1일차에 고정한 것' }),
      h('dl', { class: 'rev-grid' },
        h('dt', { text: '질문' }), h('dd', { text: x.question }),
        h('dt', { text: '관찰 지표' }), h('dd', { text: x.metric }),
        h('dt', { text: '단위' }), h('dd', { text: x.unit }),
        h('dt', { text: '계산 규칙' }), h('dd', { text: x.calc_rule }),
        h('dt', { text: '처음 계획 규칙' }), h('dd', { text: x.plan_rule }),
        RULE_FIELDS.map(([k, label]) => [h('dt', { text: label }), h('dd', { text: x[k] })]),
        h('dt', { text: '정한 시각' }), h('dd', { class: 'mono', text: fmtInstant(x.created_at) }))),
    action,
    h('h2', { text: '날짜별 기록' }),
    st.logs.length ? h('ol', { class: 'timeline' }, items) : h('p', { class: 'empty', text: '아직 기록이 없습니다. 오늘이 1일차입니다.' }),
    h('h2', { text: '규칙을 바꾸기 전과 뒤' }),
    h('p', { class: 'small muted', text: `같은 지표(${x.metric}) · 같은 단위(${unit}) · 같은 계산 규칙으로 비교합니다. 빠진 날은 합계와 평균에서 뺍니다. 평균은 소수 둘째 자리에서 반올림합니다.` }),
    h('div', { class: 'card flush table-wrap' },
      h('table', {},
        h('thead', {}, h('tr', {}, ['구간', '일차', '값이 있는 날', `합계 (${unit})`, `평균 (${unit})`].map((t) => h('th', { text: t })))),
        h('tbody', {}, row('바꾸기 전 (1~2일차)', s.before), row('바꾼 뒤 (3~5일차)', s.after), row('전체 5일', s.all))),
      h('p', { class: 'sum-line', text: s.change_of_average === null
        ? '평균 변화: 아직 비교할 수 없습니다.'
        : `평균 변화(뒤 − 전): ${s.after.average} − ${s.before.average} = ${s.change_of_average > 0 ? '+' : ''}${s.change_of_average}${unit}` }))
  );
}

function experimentSetup(st) {
  const weekdays = ['월', '화', '수', '목', '금', '토', '일'];
  const f = h('form', { class: 'grid' },
    EXP_FIELDS.map(([k, label, ph]) => h('label', { class: k === 'unit' ? '' : 'full' }, label,
      k === 'unit'
        ? h('input', { name: k, required: true, maxLength: 20, placeholder: ph })
        : h('textarea', { name: k, required: true, maxLength: 500, placeholder: ph, class: 'short' }))),
    h('h3', { class: 'full', text: '계산 규칙의 세부 (그대로 써도 되고 고쳐도 됩니다)' }),
    RULE_FIELDS.map(([k, label]) => h('label', { class: k === 'week_start' ? '' : 'full' }, label,
      k === 'week_start'
        ? h('select', { name: k }, weekdays.map((d) => h('option', { value: `${d}요일`, text: `${d}요일`, selected: `${d}요일` === st.defaults.week_start })))
        : h('textarea', { name: k, maxLength: 500, value: st.defaults[k], class: 'short' }))),
    h('div', { class: 'full row' }, h('button', { class: 'primary', type: 'submit', text: '1일차에 고정하기' })));
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!confirm('저장하면 질문·지표·단위·규칙을 다시 고칠 수 없습니다. 고정할까요?')) return;
    try {
      await api('POST', '/experiment', Object.fromEntries(new FormData(f)));
      flash('1일차 내용을 고정했습니다. 이제 오늘 기록을 적어 주세요.');
      router();
    } catch (err) { flash(err.message, true); }
  });
  render(
    crumbs('5일 기록'),
    h('section', { class: 'hero' },
      h('span', { class: 'stamp', text: `1일차 · ${dayLabel(st.today)}` }),
      h('h1', {}, h('span', { class: 'hl', text: '5일 기록 시작하기' })),
      h('p', { text: '질문 하나, 지표 하나와 단위, 계산 규칙, 계획 규칙을 오늘 한 번만 정합니다. 2일차를 적은 뒤, 3일차 앞에 계획 규칙을 하나만 바꿉니다.' })),
    h('section', { class: 'card tape' }, f));
}
