/**
 * Тесты расчёта. Запуск: npm test  (или: node --test)
 *
 * Каждый тест — маленькая задача с ответом, который можно проверить на бумаге.
 * Хороший способ учиться: сначала посчитайте ответ сами, потом откройте тест и сверьтесь.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { calculate, explain, deadlines, toNumber } = require('./calc.js');

// Заготовка настроек. В каждом тесте меняем только то, что проверяем.
const base = (over) => ({
  mode: 'd', rate: '6', payer: 'ip0', loss: '',
  inc: ['', '', '', ''], exp: ['', '', '', ''], con: ['', '', '', ''],
  ...over,
});

test('«Доходы» 6%: нарастающий итог и авансы', () => {
  const M = calculate(base({
    inc: ['1450000', '1820000', '2100000', ''],
    con: ['14348', '14348', '14347', ''],
  }));
  // 1 кв.: 1 450 000 × 6% = 87 000, вычет 14 348 → 72 652
  // полугодие: 3 270 000 × 6% = 196 200, взносы 28 696 → 167 504, аванс 167 504 − 72 652 = 94 852
  // 9 мес.: 5 370 000 × 6% = 322 200, взносы 43 043 → 279 157, аванс 279 157 − 167 504 = 111 653
  assert.deepEqual(M.cols.map((c) => c.taxNet), [72652, 167504, 279157, 279157]);
  assert.deepEqual(M.cols.map((c) => c.pay), [72652, 94852, 111653, 0]);
});

test('ИП с работниками: вычет не больше 50% налога', () => {
  const M = calculate(base({ payer: 'ip1', inc: ['100000', '', '', ''], con: ['5000', '', '', ''] }));
  // Налог 6 000, предел 3 000, взносы 5 000 → вычитаем только 3 000
  assert.equal(M.cols[0].taxRate, 6000);
  assert.equal(M.cols[0].ded, 3000);
  assert.equal(M.cols[0].taxNet, 3000);
});

test('«Доходы минус расходы» 15%: взносы идут в расходы', () => {
  const M = calculate(base({
    mode: 'dr', rate: '15',
    inc: ['1000000', '', '', ''], exp: ['400000', '', '', ''], con: ['10000', '', '', ''],
  }));
  // база = 1 000 000 − (400 000 + 10 000) = 590 000; налог = 590 000 × 15% = 88 500
  assert.equal(M.cols[0].base, 590000);
  assert.equal(M.cols[0].taxNet, 88500);
});

test('Минимальный налог 1% применяется только по итогам года', () => {
  const s = base({
    mode: 'dr', rate: '15',
    inc: ['250000', '250000', '250000', '250000'],
    exp: ['248000', '248000', '248000', '248000'],
  });
  const M = calculate(s);
  // Год: база 8 000, налог 15% = 1 200, минимальный 1% от 1 000 000 = 10 000 → платим 10 000
  assert.equal(M.cols[3].taxRate, 1200);
  assert.equal(M.cols[3].minTax, 10000);
  assert.equal(M.cols[3].taxNet, 10000);
  assert.equal(M.cols[3].minApplied, true);
  // В квартальных периодах минимального налога нет
  assert.equal(M.cols[0].minTax, null);
});

test('Убыток прошлых лет уменьшает базу только за год', () => {
  const M = calculate(base({
    mode: 'dr', rate: '15', loss: '100000',
    inc: ['500000', '500000', '500000', '500000'],
    exp: ['200000', '200000', '200000', '200000'],
  }));
  // Квартальные периоды: убыток не учитывается
  assert.equal(M.cols[0].taxNet, 45000);
  // Год: база 1 200 000 − 100 000 = 1 100 000; налог 165 000
  assert.equal(M.cols[3].taxNet, 165000);
});

test('Если налог за период меньше уже начисленных авансов, платить 0', () => {
  const M = calculate(base({
    mode: 'dr', rate: '15',
    inc: ['1000000', '0', '', ''], exp: ['200000', '700000', '', ''],
  }));
  // 1 кв.: база 800 000 → аванс 120 000. Полугодие: база 100 000 → налог 15 000, это меньше уже начисленных 120 000
  assert.equal(M.cols[0].pay, 120000);
  assert.equal(M.cols[1].pay, 0);
  assert.equal(M.cols[1].cut, 105000);
});

test('Пустой 4 квартал не включает правила года', () => {
  const M = calculate(base({ mode: 'dr', rate: '15', inc: ['100000', '', '', ''], exp: ['99000', '', '', ''] }));
  assert.equal(M.cols[3].has, false);
  assert.equal(M.cols[3].minTax, null);
});

test('Числа с пробелами и запятой читаются верно', () => {
  assert.equal(toNumber('1 450 000'), 1450000);
  assert.equal(toNumber('1 450 000,50'), 1450000.5);
  assert.equal(toNumber(''), 0);
});

test('Срок, выпавший на выходной, переносится на понедельник', () => {
  // 28 марта 2027 — воскресенье, налог организации за 2026 год платится 29 марта
  const d = deadlines(2026, 'org')[3];
  assert.equal(d.getMonth(), 2);
  assert.equal(d.getDate(), 29);
});

test('Объяснение содержит формулы с подставленными числами', () => {
  const s = base({ inc: ['1450000', '', '', ''], con: ['14348', '', '', ''] });
  const M = calculate(s);
  const steps = explain(s, M, 0, deadlines(2026, 'ip0')[0]);
  assert.ok(steps.length >= 5);
  const tax = steps.find((x) => x.title === 'Налог по ставке');
  assert.match(tax.calc, /1\s450\s000 × 6% = 87\s000/);
  assert.equal(steps[steps.length - 1].title, 'К уплате за период');
});
