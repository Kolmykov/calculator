/**
 * app.js — интерфейс. Здесь нет формул: они живут в calc.js.
 * Задача этого файла: прочитать поля, вызвать calculate()/explain() и нарисовать результат.
 *
 * Порядок работы:
 *   state (S)  →  calculate(S)  →  render()  →  таблица, итог, подсказки, пошаговый разбор
 * Любое действие пользователя меняет state и снова вызывает render().
 */
(function () {
  'use strict';

  const C = window.UsnCalc;
  const { YEARS, DEFAULT_RATE, PERIODS, toNumber: num, isFilled: filled, money: rub, formatDate: fdate } = C;
  const $ = (id) => document.getElementById(id);
  const KEY = 'usn-nakopitelno-v1'; // под этим ключом ввод хранится в браузере (localStorage)

  const nf1 = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 });
  const nf0 = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 });
  const nf2 = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 });
  const TITLES = ['Аванс за 1 квартал', 'Аванс за полугодие', 'Аванс за 9 месяцев', 'Доплата по итогам года'];

  /* ---------- состояние ---------- */

  // Пример, который видно при первом открытии. Как только вы что-то введёте, он заменится вашими цифрами.
  function sample() {
    return {
      mode: 'd', rate: '6', payer: 'ip0', year: 2026, fixed: '57390', loss: '',
      inc: ['1450000', '1820000', '2100000', ''],
      exp: ['820000', '960000', '1100000', ''],
      con: ['14348', '14348', '14347', ''],
      example: true,
    };
  }
  function valid(s) {
    return s && DEFAULT_RATE[s.mode] != null && YEARS[s.year] && ['ip0', 'ip1', 'org'].includes(s.payer) &&
      ['inc', 'exp', 'con'].every((k) => Array.isArray(s[k]) && s[k].length === 4);
  }
  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) { const s = JSON.parse(raw); if (valid(s)) return s; }
    } catch (e) { /* localStorage может быть недоступен, тогда просто начинаем с примера */ }
    return sample();
  }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { /* не страшно */ } }

  const S = load();
  let chosenPeriod = null; // период, выбранный вручную во вкладках «Как это посчитано»

  /* ---------- таблица ---------- */

  // Описание строк. k — ключ поля в результате calculate(); show — показывать только в этом режиме.
  const ROWS = [
    { sec: 'Вводите по кварталам' },
    { k: 'inc', label: 'Доходы', sub: 'поступило за квартал', input: true },
    { k: 'exp', label: 'Расходы', sub: 'без страховых взносов', input: true, show: 'dr' },
    { k: 'con', label: 'Страховые взносы', sub: '', input: true },
    { sec: 'Нарастающим итогом с 1 января' },
    { k: 'cInc', label: 'Доходы' },
    { k: 'cExp', label: 'Расходы с учётом взносов', show: 'dr' },
    { k: 'base', label: 'Налоговая база', show: 'dr' },
    { k: 'lossUsed', label: 'Убыток прошлых лет', show: 'dr' },
    { k: 'taxRate', label: '' },
    { k: 'minTax', label: 'Минимальный налог, 1% доходов', show: 'dr' },
    { k: 'cCon', label: 'Взносы', show: 'd' },
    { k: 'ded', label: 'Вычет взносами', sub: '', show: 'd' },
    { k: 'taxNet', label: 'Налог за период' },
    { k: 'prev', label: 'Начислено авансов ранее' },
    { k: 'pay', label: 'К уплате', cls: 'pay' },
    { k: 'due', label: 'Срок уплаты' },
  ];
  const R = {}; // ссылки на DOM-элементы строк, чтобы обновлять их без перестроения таблицы

  function build() {
    const trh = document.createElement('tr');
    const c0 = document.createElement('th');
    c0.className = 'rl'; c0.scope = 'col'; c0.textContent = 'Показатель';
    trh.appendChild(c0);
    PERIODS.forEach((p, i) => {
      const th = document.createElement('th');
      th.scope = 'col'; th.className = 'ch'; th.id = 'ch-' + i;
      th.innerHTML = '<span class="t"></span><span class="sub"></span><span class="tag" hidden>ближайший срок</span>';
      trh.appendChild(th);
    });
    $('thead').appendChild(trh);

    ROWS.forEach((r) => {
      const tr = document.createElement('tr');
      const th = document.createElement('th');
      th.className = 'rl'; th.scope = 'row';
      if (r.sec) {
        tr.className = 'sec';
        th.textContent = r.sec;
        tr.appendChild(th);
        for (let i = 0; i < 4; i++) tr.appendChild(document.createElement('td'));
        $('tbody').appendChild(tr);
        return;
      }
      if (r.cls) tr.className = r.cls;
      const lt = document.createElement('span'); lt.textContent = r.label;
      const sub = document.createElement('span'); sub.className = 'sub'; sub.textContent = r.sub || '';
      th.append(lt, sub);
      tr.appendChild(th);
      const entry = { tr, lt, sub, tds: [] };
      for (let q = 0; q < 4; q++) {
        const td = document.createElement('td');
        if (r.input) {
          td.className = 'in';
          const inp = document.createElement('input');
          inp.className = 'num'; inp.id = r.k + '-' + q; inp.type = 'text';
          inp.setAttribute('inputmode', 'decimal'); inp.setAttribute('autocomplete', 'off');
          inp.setAttribute('aria-label', r.label + ', ' + PERIODS[q].name);
          inp.placeholder = '0';
          td.appendChild(inp);
          bindInput(inp, r.k, q);
        } else {
          td.className = 'v';
        }
        tr.appendChild(td);
        entry.tds.push(td);
      }
      R[r.k] = entry;
      $('tbody').appendChild(tr);
    });
  }

  function touched() {
    if (S.example) { S.example = false; $('example-note').hidden = true; }
  }
  function bindInput(el, k, q) {
    el.addEventListener('input', () => { S[k][q] = el.value; touched(); render(); save(); });
    el.addEventListener('blur', () => {
      if (filled(el.value)) { el.value = nf2.format(num(el.value)); S[k][q] = el.value; save(); }
    });
    el.addEventListener('focus', () => el.select());
  }

  function cellText(k, q, c, dueList) {
    if (k === 'due') return fdate(dueList[q]);
    if (k === 'pay') return c.has ? rub(c.pay) : '—';
    const v = c[k];
    return v == null ? '—' : rub(v);
  }

  function today() { const t = new Date(); t.setHours(0, 0, 0, 0); return t; }
  function nextIndex(dueList) {
    const t = today();
    return dueList.findIndex((d) => d >= t);
  }
  function plural(n, a, b, c) {
    const m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return a;
    if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return b;
    return c;
  }
  function msg(text, warn) {
    const d = document.createElement('div');
    d.className = 'msg' + (warn ? ' msg--warn' : '');
    d.textContent = text;
    return d;
  }

  /* ---------- главный рендер ---------- */

  function render() {
    const M = C.calculate(S);            // ← вся математика здесь, одной строкой
    const isD = M.isD, Y = YEARS[S.year];
    const dueList = C.deadlines(S.year, S.payer);
    const nextIdx = nextIndex(dueList);

    // Показываем и прячем поля и строки в зависимости от режима и плательщика.
    document.querySelectorAll('[data-show]').forEach((el) => {
      const v = el.getAttribute('data-show');
      el.hidden = !(v === 'ip' ? S.payer !== 'org' : v === S.mode);
    });
    ROWS.forEach((r) => { if (r.show) R[r.k].tr.hidden = r.show !== S.mode; });

    R.taxRate.lt.textContent = 'Налог по ставке ' + nf1.format(M.rate) + '%';
    R.ded.sub.textContent = 'не больше ' + (M.share === 1 ? '100' : '50') + '% налога';
    R.con.sub.textContent = isD ? 'уменьшают налог' : 'входят в расходы';

    M.cols.forEach((c, q) => {
      const th = $('ch-' + q);
      th.querySelector('.t').textContent = PERIODS[q].name === 'год' ? 'Год' : cap(PERIODS[q].name);
      th.querySelector('.sub').textContent = c.has ? PERIODS[q].range : 'нет данных';
      th.classList.toggle('is-next', q === nextIdx);
      th.querySelector('.tag').hidden = q !== nextIdx;
      ROWS.forEach((r) => {
        if (!r.k) return;
        const td = R[r.k].tds[q];
        td.classList.toggle('is-next', q === nextIdx);
        if (r.input) return;
        td.classList.toggle('is-muted', !c.has && r.k !== 'due');
        td.textContent = cellText(r.k, q, c, dueList);
        let extra = '';
        if (r.k === 'pay' && c.has && c.cut > 0) extra = 'к уменьшению ' + rub(c.cut);
        if (r.k === 'taxNet' && c.minApplied) extra = 'минимальный налог';
        if (extra) {
          const s = document.createElement('span');
          s.className = 'cut'; s.textContent = extra;
          td.appendChild(s);
        }
      });
    });

    renderSummary(M, dueList, nextIdx);
    renderHints(M, Y);
    renderExplain(M, dueList, nextIdx);

    $('fixed-hint').textContent = 'За ' + S.year + ' год ' + nf0.format(Y.fixed) + ' ₽. Сверх этого платится 1% с дохода больше 300 000 ₽.';
    $('example-note').hidden = !S.example;
  }

  function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

  function renderSummary(M, dueList, nextIdx) {
    const year = M.cols[3];
    if (nextIdx >= 0) {
      const nc = M.cols[nextIdx];
      const days = Math.round((dueList[nextIdx] - today()) / 86400000);
      $('next-label').textContent = TITLES[nextIdx] + ', срок ' + fdate(dueList[nextIdx]);
      $('next-amount').textContent = nc.has ? rub(nc.pay) : '—';
      $('next-meta').textContent = nc.has
        ? (days === 0 ? 'Срок сегодня.' : 'Осталось ' + days + ' ' + plural(days, 'день', 'дня', 'дней') + '.')
        : 'Введите данные за этот период, чтобы увидеть сумму.';
    } else {
      $('next-label').textContent = 'Все сроки за ' + S.year + ' год прошли';
      $('next-amount').textContent = rub(year.taxNet);
      $('next-meta').textContent = 'Налог за год по введённым данным.';
    }
    $('f-inc').textContent = rub(year.cInc);
    $('f-tax').textContent = rub(year.taxNet);
    $('f-con-l').textContent = M.isD ? 'Вычтено взносов' : 'Взносы в расходах';
    $('f-con').textContent = rub(M.isD ? year.ded : year.cCon);
    $('f-load').textContent = year.cInc > 0 ? nf1.format((year.taxNet / year.cInc) * 100) + '%' : '—';
  }

  function renderHints(M, Y) {
    const box = $('msgs');
    const year = M.cols[3];
    box.textContent = '';
    if (!M.isD && year.minApplied) {
      box.appendChild(msg('Налог по ставке ниже минимального, поэтому платить нужно минимальный налог: ' + rub(year.minTax) + '. Превышение над налогом по ставке (' + rub(year.minTax - year.taxRate) + ') можно учесть в расходах следующих лет.', true));
    }
    if (M.isD && year.cCon - year.ded > 0.5 && year.taxRate > 0) {
      box.appendChild(msg('Вычет ограничен ' + (M.share === 1 ? '100' : '50') + '% налога. Часть взносов (' + rub(year.cCon - year.ded) + ') налог уже не уменьшит.'));
    }
    if (S.payer !== 'org') {
      const expTotal = S.exp.reduce((a, v) => a + num(v), 0);
      const base1 = M.isD ? year.cInc : Math.max(0, year.cInc - expTotal);
      const one = Math.min(Math.max(0, base1 - 300000) * 0.01, Y.cap);
      if (one > 0) {
        box.appendChild(msg('Взнос 1% по текущим данным: ' + rub(one) + (M.isD ? '' : ' (считается с разницы доходов и расходов, без расходов на взносы)') + '. Его платят до 1 июля следующего года, и он уменьшает налог в том периоде, когда уплачен.'));
      }
    }
    if (year.cInc > Y.vat) {
      box.appendChild(msg('Доходы превысили ' + nf0.format(Y.vat / 1e6) + ' млн ₽. Для этого уровня доходов на УСН возникает обязанность платить НДС, калькулятор его не считает.', true));
    }
    if (Y.limit && year.cInc > Y.limit) {
      box.appendChild(msg('Доходы превысили лимит УСН (' + nf1.format(Y.limit / 1e6) + ' млн ₽). Право на спецрежим теряется.', true));
    }
  }

  /* ---------- «Как это посчитано» ---------- */

  function renderExplain(M, dueList, nextIdx) {
    // Какой период показывать: выбранный вручную, иначе ближайший срок, иначе последний период с данными.
    let q = chosenPeriod;
    if (q == null) {
      if (nextIdx >= 0 && M.cols[nextIdx].has) q = nextIdx;
      else {
        q = 0;
        M.cols.forEach((c, i) => { if (c.has) q = i; });
      }
    }

    const tabs = $('tabs');
    tabs.textContent = '';
    PERIODS.forEach((p, i) => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'tab'; b.textContent = cap(p.short);
      b.setAttribute('aria-pressed', String(i === q));
      b.addEventListener('click', () => { chosenPeriod = i; render(); });
      tabs.appendChild(b);
    });

    const list = $('steps');
    list.textContent = '';
    const steps = C.explain(S, M, q, dueList[q]);
    if (!steps.length) {
      const li = document.createElement('li');
      li.className = 'steps-empty';
      li.textContent = 'За этот период пока нет данных. Введите доходы или взносы, и здесь появится разбор.';
      list.appendChild(li);
      return;
    }
    steps.forEach((st, i) => {
      const li = document.createElement('li');
      li.className = 'step';
      const n = document.createElement('span'); n.className = 'step-n'; n.textContent = String(i + 1);
      const head = document.createElement('div'); head.className = 'step-head';
      const h = document.createElement('h3'); h.textContent = st.title;
      const res = document.createElement('span'); res.className = 'step-res'; res.textContent = st.result;
      head.append(h, res);
      li.append(n, head, line('Правило', st.formula), line('С вашими числами', st.calc));
      const note = document.createElement('p'); note.className = 'step-note'; note.textContent = st.note;
      li.appendChild(note);
      list.appendChild(li);
    });
  }
  function line(k, v) {
    const p = document.createElement('p'); p.className = 'step-line';
    const a = document.createElement('span'); a.className = 'k'; a.textContent = k;
    const b = document.createElement('span'); b.className = 'v'; b.textContent = v;
    p.append(a, b);
    return p;
  }

  /* ---------- параметры и кнопки ---------- */

  function syncParams() {
    $('mode-d').checked = S.mode === 'd';
    $('mode-dr').checked = S.mode === 'dr';
    $('rate').value = S.rate;
    $('payer').value = S.payer;
    $('year').value = String(S.year);
    $('fixed').value = filled(S.fixed) ? nf2.format(num(S.fixed)) : '';
    $('loss').value = filled(S.loss) ? nf2.format(num(S.loss)) : '';
    ['inc', 'exp', 'con'].forEach((k) => {
      for (let q = 0; q < 4; q++) $(k + '-' + q).value = filled(S[k][q]) ? nf2.format(num(S[k][q])) : '';
    });
  }

  function onChange() { touched(); render(); save(); }

  function wire() {
    ['mode-d', 'mode-dr'].forEach((id) => {
      $(id).addEventListener('change', () => {
        const old = S.mode, now = $(id).value;
        if (old === now) return;
        // Если ставка осталась «по умолчанию», меняем её на ставку нового режима. Свою ставку не трогаем.
        if (S.rate === DEFAULT_RATE[old] || !filled(S.rate)) S.rate = DEFAULT_RATE[now];
        S.mode = now;
        $('rate').value = S.rate;
        onChange();
      });
    });
    $('rate').addEventListener('input', () => { S.rate = $('rate').value; onChange(); });
    $('payer').addEventListener('change', () => { S.payer = $('payer').value; onChange(); });
    $('year').addEventListener('change', () => {
      const old = S.year, now = Number($('year').value);
      if (!filled(S.fixed) || num(S.fixed) === YEARS[old].fixed) {
        S.fixed = String(YEARS[now].fixed);
        $('fixed').value = nf2.format(YEARS[now].fixed);
      }
      S.year = now;
      onChange();
    });
    $('fixed').addEventListener('input', () => { S.fixed = $('fixed').value; onChange(); });
    $('loss').addEventListener('input', () => { S.loss = $('loss').value; onChange(); });
    ['fixed', 'loss'].forEach((id) => {
      $(id).addEventListener('blur', () => {
        if (filled($(id).value)) $(id).value = nf2.format(num($(id).value));
      });
    });

    // Делим годовые фиксированные взносы на 4 квартала; остаток копеек уходит в первые кварталы.
    $('btn-spread').addEventListener('click', () => {
      const total = Math.round(num(S.fixed)), part = Math.floor(total / 4), rest = total - part * 4;
      for (let q = 0; q < 4; q++) {
        const v = part + (q < rest ? 1 : 0);
        S.con[q] = String(v);
        $('con-' + q).value = nf2.format(v);
      }
      onChange();
    });

    $('btn-clear').addEventListener('click', () => {
      for (let q = 0; q < 4; q++) {
        ['inc', 'exp', 'con'].forEach((k) => { S[k][q] = ''; $(k + '-' + q).value = ''; });
      }
      S.loss = ''; $('loss').value = '';
      S.example = false;
      render(); save();
    });

    $('btn-copy').addEventListener('click', copyTable);
  }

  function copyTable() {
    const M = C.calculate(S), dueList = C.deadlines(S.year, S.payer), lines = [];
    lines.push('УСН «' + (M.isD ? 'Доходы' : 'Доходы минус расходы') + '», ставка ' + nf1.format(M.rate) + '%, ' + S.year + ' год');
    lines.push(['Показатель'].concat(PERIODS.map((p) => cap(p.short))).join('\t'));
    ROWS.forEach((r) => {
      if (!r.k || (r.show && r.show !== S.mode)) return;
      const label = r.k === 'taxRate' ? 'Налог по ставке ' + nf1.format(M.rate) + '%' : r.label;
      const cells = M.cols.map((c, q) => {
        if (r.input) return filled(S[r.k][q]) ? String(num(S[r.k][q])) : '';
        return cellText(r.k, q, c, dueList).replace(/ /g, ' ');
      });
      lines.push([label].concat(cells).join('\t'));
    });
    const text = lines.join('\n'), st = $('copy-status');
    const done = (ok) => {
      st.textContent = ok ? 'Скопировано' : 'Не удалось скопировать, выделите таблицу вручную';
      setTimeout(() => { st.textContent = ''; }, 2500);
    };
    const fallback = () => {
      const ta = document.createElement('textarea');
      ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { /* игнорируем */ }
      document.body.removeChild(ta);
      done(ok);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(() => done(true), fallback);
    else fallback();
  }

  build();
  syncParams();
  wire();
  render();
})();
