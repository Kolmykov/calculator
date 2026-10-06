/**
 * calc.js — вся математика УСН в одном файле, без обращения к DOM.
 *
 * Зачем так: расчёт отделён от интерфейса, поэтому его можно читать отдельно,
 * проверять тестами (calc.test.js) и не бояться, что правка вёрстки сломает формулы.
 *
 * В файле три части:
 *   1. Справочные данные и мелкие помощники (числа, деньги, даты).
 *   2. calculate()  — считает налог по четырём периодам нарастающим итогом.
 *   3. explain()    — превращает результат calculate() в пошаговый разбор для человека.
 *
 * Работает и в браузере (window.UsnCalc), и в Node (require).
 */
(function (root) {
  'use strict';

  /* ------------------------------------------------------------------ */
  /* 1. Справочные данные                                               */
  /* ------------------------------------------------------------------ */

  // fixed — фиксированные взносы ИП за год; cap — потолок взноса 1% с дохода сверх 300 000 ₽;
  // vat — порог дохода, после которого на УСН появляется НДС; limit — лимит дохода для УСН.
  const YEARS = {
    2025: { fixed: 53658, cap: 300888, vat: 60e6, limit: null },
    2026: { fixed: 57390, cap: 321818, vat: 20e6, limit: 490.5e6 },
  };

  // Ставка по умолчанию для каждого объекта: d — «Доходы», dr — «Доходы минус расходы».
  const DEFAULT_RATE = { d: '6', dr: '15' };

  const PERIODS = [
    { name: '1 квартал', short: '1 кв.', range: 'янв – март' },
    { name: 'полугодие', short: 'полугодие', range: 'янв – июнь' },
    { name: '9 месяцев', short: '9 мес.', range: 'янв – сент' },
    { name: 'год', short: 'год', range: 'янв – дек' },
  ];

  const nf0 = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 });
  const nf1 = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 });
  const nf2 = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 });
  const dateFmt = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });

  /** Строка из поля ввода → число. Понимает пробелы и запятую: «1 450 000,50» → 1450000.5 */
  function toNumber(v) {
    const t = String(v == null ? '' : v).replace(/\s/g, '').replace(',', '.').replace(/[^0-9.]/g, '');
    const n = parseFloat(t);
    return Number.isFinite(n) ? n : 0;
  }

  /** Заполнено ли поле (пустая строка и «0» — разные вещи: пустое значит «данных ещё нет»). */
  function isFilled(v) {
    return String(v == null ? '' : v).trim() !== '';
  }

  /** Налог округляется до целого рубля: 50 копеек и больше — вверх (ст. 52 НК РФ). */
  function roundRub(n) {
    return Math.round(n);
  }

  const money = (n) => nf0.format(Math.round(n)) + ' ₽'; // 1 450 000 ₽
  const plain = (n) => nf2.format(n); // число внутри формулы, без «₽»
  const percent = (n) => nf1.format(n) + '%';

  function formatDate(d) {
    return dateFmt.format(d).replace(/\s?г\.$/, '');
  }

  /** Если срок выпал на выходной, платить можно в ближайший понедельник. Праздники не учитываются. */
  function shiftFromWeekend(d) {
    const w = d.getDay();
    if (w === 6) d.setDate(d.getDate() + 2);
    else if (w === 0) d.setDate(d.getDate() + 1);
    return d;
  }

  /**
   * Сроки уплаты: аванс за 1 кв. — до 28 апреля, за полугодие — до 28 июля,
   * за 9 месяцев — до 28 октября. Налог за год: ИП — до 28 апреля, организации — до 28 марта следующего года.
   */
  function deadlines(year, payer) {
    const y = Number(year);
    return [
      shiftFromWeekend(new Date(y, 3, 28)),
      shiftFromWeekend(new Date(y, 6, 28)),
      shiftFromWeekend(new Date(y, 9, 28)),
      shiftFromWeekend(payer === 'org' ? new Date(y + 1, 2, 28) : new Date(y + 1, 3, 28)),
    ];
  }

  /* ------------------------------------------------------------------ */
  /* 2. Расчёт                                                          */
  /* ------------------------------------------------------------------ */

  /**
   * @param {object} s настройки и ввод пользователя:
   *   mode  'd' | 'dr'           объект налогообложения
   *   rate  строка               ставка в процентах
   *   payer 'ip0' | 'ip1' | 'org' ИП без работников / ИП с работниками / организация
   *   loss  строка               убыток прошлых лет (только «Доходы минус расходы»)
   *   inc, exp, con  массивы из 4 строк — доходы, расходы и взносы ЗА КВАРТАЛ
   * @returns {{cols: object[], rate: number, isD: boolean, share: number}}
   *   cols[0..3] — результаты по периодам: 1 кв., полугодие, 9 мес., год
   */
  function calculate(s) {
    const isD = s.mode === 'd';
    const rate = Math.min(100, toNumber(s.rate));
    // Доля налога, на которую можно уменьшить налог взносами («Доходы»):
    // ИП без работников — 100%, остальные — 50%.
    const share = s.payer === 'ip0' ? 1 : 0.5;

    // Накопители: каждый квартал мы ДОБАВЛЯЕМ его цифры к уже накопленным. Это и есть «нарастающий итог».
    let cumInc = 0;
    let cumExp = 0;
    let cumCon = 0;
    let advancesBefore = 0; // сумма авансов, начисленных за прошлые периоды
    const cols = [];

    for (let q = 0; q < 4; q++) {
      const hasData = isFilled(s.inc[q]) || isFilled(s.con[q]) || (!isD && isFilled(s.exp[q]));
      cumInc += toNumber(s.inc[q]);
      cumCon += toNumber(s.con[q]);
      if (!isD) cumExp += toNumber(s.exp[q]);

      const c = { q, has: hasData, cInc: cumInc, cCon: cumCon, prev: advancesBefore };
      // Итоговые правила года (минимальный налог, убыток прошлых лет) включаем только когда за 4 квартал есть данные.
      const isFinalYear = q === 3 && hasData;

      if (isD) {
        // «Доходы»: налог = доходы × ставка, потом вычитаем взносы, но не больше предела.
        c.taxRate = roundRub((cumInc * rate) / 100);
        c.limit = roundRub(c.taxRate * share);
        c.ded = Math.min(roundRub(cumCon), c.limit);
        c.taxNet = c.taxRate - c.ded;
      } else {
        // «Доходы минус расходы»: взносы входят в расходы, база = доходы − расходы.
        c.cExp = cumExp + cumCon;
        c.base = cumInc - c.cExp;
        let lossUsed = 0;
        if (isFinalYear && c.base > 0) lossUsed = Math.min(toNumber(s.loss), c.base);
        c.lossUsed = isFinalYear ? lossUsed : null;
        c.baseTaxable = Math.max(0, c.base - lossUsed);
        c.taxRate = roundRub((c.baseTaxable * rate) / 100);
        if (isFinalYear) {
          // Минимальный налог — 1% доходов. Платим большее из двух чисел.
          c.minTax = roundRub(cumInc * 0.01);
          c.minApplied = c.minTax > c.taxRate;
          c.taxNet = Math.max(c.taxRate, c.minTax);
        } else {
          c.minTax = null;
          c.taxNet = c.taxRate;
        }
      }

      // К уплате за период = налог нарастающим итогом − то, что уже начислено авансами.
      const raw = c.taxNet - advancesBefore;
      c.raw = raw;
      c.pay = Math.max(0, raw); // отрицательной суммы к уплате не бывает
      c.cut = raw < 0 ? -raw : 0; // аванс получился больше налога, его можно уменьшить
      advancesBefore += c.pay;

      // Цифры, из которых сложился накопленный итог — они нужны для объяснения.
      c.incList = s.inc.slice(0, q + 1).map(toNumber);
      c.conList = s.con.slice(0, q + 1).map(toNumber);
      c.expList = s.exp.slice(0, q + 1).map(toNumber);
      cols.push(c);
    }
    return { cols, rate, isD, share };
  }

  /* ------------------------------------------------------------------ */
  /* 3. Объяснение                                                      */
  /* ------------------------------------------------------------------ */

  const sumLine = (list) => list.map(plain).join(' + ');

  /**
   * Пошаговый разбор расчёта за один период.
   * Шаг: { title, formula, calc, result, note }
   *   formula — правило словами и символами;
   *   calc    — то же правило с вашими числами;
   *   result  — итог шага;
   *   note    — зачем этот шаг нужен.
   */
  function explain(s, M, q, dueDate) {
    const c = M.cols[q];
    const p = PERIODS[q];
    const steps = [];
    if (!c.has) return steps;

    const hasPrev = q > 0;
    const incCalc = hasPrev ? `${sumLine(c.incList)} = ${money(c.cInc)}` : money(c.cInc);

    steps.push({
      title: 'Доходы нарастающим итогом',
      formula: 'Доходы = доход 1 кв. + доход 2 кв. + … до конца периода',
      calc: incCalc,
      result: money(c.cInc),
      note: 'Берём все доходы с 1 января, а не только за последний квартал. В этом смысл «нарастающего итога».',
    });

    if (M.isD) {
      const conSum = hasPrev ? `${sumLine(c.conList)} = ${money(c.cCon)}` : money(c.cCon);
      steps.push({
        title: 'Налог по ставке',
        formula: 'Налог по ставке = Доходы × ставка',
        calc: `${plain(c.cInc)} × ${percent(M.rate)} = ${money(c.taxRate)}`,
        result: money(c.taxRate),
        note: 'На «Доходах» расходы не вычитаются, ставка берётся от всех доходов. Результат округляется до рубля.',
      });
      steps.push({
        title: 'Взносы нарастающим итогом',
        formula: 'Взносы = взнос 1 кв. + взнос 2 кв. + …',
        calc: conSum,
        result: money(c.cCon),
        note: 'Учитываются только взносы, которые вы уплатили в этом периоде (ст. 346.21 НК РФ).',
      });
      steps.push({
        title: 'Предел вычета',
        formula: 'Предел = Налог по ставке × 100% (ИП без работников) или × 50% (остальные)',
        calc: `${plain(c.taxRate)} × ${M.share * 100}% = ${money(c.limit)}`,
        result: money(c.limit),
        note: 'Налог нельзя уменьшить взносами сильнее, чем позволяет этот предел.',
      });
      steps.push({
        title: 'Вычет',
        formula: 'Вычет = меньшее из двух: взносы или предел',
        calc: `меньшее из ${plain(c.cCon)} и ${plain(c.limit)} = ${money(c.ded)}`,
        result: money(c.ded),
        note:
          c.cCon > c.limit
            ? 'Взносов больше, чем разрешённый предел, поэтому вычет упёрся в предел.'
            : 'Взносы меньше предела, поэтому вычитаем их полностью.',
      });
      steps.push({
        title: 'Налог за период',
        formula: 'Налог за период = Налог по ставке − Вычет',
        calc: `${plain(c.taxRate)} − ${plain(c.ded)} = ${money(c.taxNet)}`,
        result: money(c.taxNet),
        note: 'Это весь налог с начала года по конец периода. Он ещё включает авансы, которые вы платили раньше.',
      });
    } else {
      const expWithCon = c.expList.map((e, i) => e + c.conList[i]);
      steps.push({
        title: 'Расходы и взносы нарастающим итогом',
        formula: 'Расходы = расходы + страховые взносы за все кварталы до конца периода',
        calc: `${sumLine(expWithCon)} = ${money(c.cExp)}`,
        result: money(c.cExp),
        note: 'На «Доходах минус расходы» страховые взносы уменьшают налог не вычетом, а попадают в расходы.',
      });
      steps.push({
        title: 'Налоговая база',
        formula: 'База = Доходы − Расходы',
        calc: `${plain(c.cInc)} − ${plain(c.cExp)} = ${money(c.base)}`,
        result: money(c.base),
        note: c.base < 0 ? 'База отрицательная: это убыток, налога по ставке нет.' : 'С этой суммы считается налог.',
      });
      if (q === 3 && c.lossUsed != null && c.lossUsed > 0) {
        steps.push({
          title: 'Убыток прошлых лет',
          formula: 'База после убытка = База − меньшее из двух: убыток или база',
          calc: `${plain(c.base)} − ${plain(c.lossUsed)} = ${money(c.baseTaxable)}`,
          result: money(c.baseTaxable),
          note: 'Убыток прошлых лет уменьшает базу только по итогам года, в авансах он не участвует.',
        });
      }
      steps.push({
        title: 'Налог по ставке',
        formula: 'Налог по ставке = База × ставка',
        calc: `${plain(c.baseTaxable)} × ${percent(M.rate)} = ${money(c.taxRate)}`,
        result: money(c.taxRate),
        note: 'Результат округляется до рубля.',
      });
      if (q === 3 && c.minTax != null) {
        steps.push({
          title: 'Минимальный налог',
          formula: 'Минимальный налог = Доходы × 1%; платим большее из двух налогов',
          calc: `${plain(c.cInc)} × 1% = ${money(c.minTax)}; большее из ${plain(c.taxRate)} и ${plain(c.minTax)} = ${money(c.taxNet)}`,
          result: money(c.taxNet),
          note: c.minApplied
            ? 'Налог по ставке получился меньше 1% доходов, поэтому платим минимальный. Разницу можно учесть в расходах следующих лет.'
            : 'Налог по ставке больше минимального, поэтому минимальный налог платить не нужно.',
        });
      }
    }

    steps.push({
      title: 'К уплате за период',
      formula: 'К уплате = Налог за период − авансы, начисленные за прошлые периоды',
      calc: hasPrev
        ? `${plain(c.taxNet)} − ${plain(c.prev)} = ${money(c.raw)}`
        : `${plain(c.taxNet)} − 0 = ${money(c.raw)} (авансов ещё не было)`,
      result: money(c.pay),
      note:
        c.raw < 0
          ? `Разность отрицательная: платить ничего не нужно, а аванс можно уменьшить на ${money(c.cut)}.`
          : `Заплатить нужно до ${formatDate(dueDate)}.`,
    });
    return steps;
  }

  /* ------------------------------------------------------------------ */

  const api = {
    YEARS, DEFAULT_RATE, PERIODS,
    toNumber, isFilled, roundRub, money, plain, percent, formatDate,
    deadlines, calculate, explain,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.UsnCalc = api;
})(typeof window !== 'undefined' ? window : globalThis);
