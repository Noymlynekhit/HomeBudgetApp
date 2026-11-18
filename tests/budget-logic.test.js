const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../js/budget-logic.js');

test('cycleKeyForDate: מחזור שמתחיל ב-10', () => {
  assert.equal(L.cycleKeyForDate('2026-11-09', 10), '2026-10');
  assert.equal(L.cycleKeyForDate('2026-11-10', 10), '2026-11');
  assert.equal(L.cycleKeyForDate('2026-01-05', 10), '2025-12'); // חציית שנה
  assert.equal(L.cycleKeyForDate('2026-11-09', 1), '2026-11');
});

test('shiftMonth: חציית שנה בשני הכיוונים', () => {
  assert.equal(L.shiftMonth('2026-01', -1), '2025-12');
  assert.equal(L.shiftMonth('2026-12', 1), '2027-01');
  assert.equal(L.shiftMonth('2026-05', -14), '2025-03');
});

test('dueDateForCycle: יום אחרי תחילת המחזור נשאר באותו חודש', () => {
  assert.equal(L.dueDateForCycle('2026-11', 10, 15), '2026-11-15');
  assert.equal(L.dueDateForCycle('2026-11', 10, 10), '2026-11-10');
});

test('dueDateForCycle: יום לפני תחילת המחזור עובר לחודש הבא', () => {
  assert.equal(L.dueDateForCycle('2026-11', 10, 5), '2026-12-05');
  assert.equal(L.dueDateForCycle('2026-12', 10, 1), '2027-01-01'); // חציית שנה
});

test('dueDateForCycle: יום 31 בחודש קצר מוקטן ליום האחרון', () => {
  assert.equal(L.dueDateForCycle('2026-02', 1, 31), '2026-02-28');
  assert.equal(L.dueDateForCycle('2028-02', 1, 31), '2028-02-29'); // שנה מעוברת
  assert.equal(L.dueDateForCycle('2026-01', 10, 31), '2026-01-31');
});

const rent = { id: 'r1', type: 'expense', amount: 4000, mainCategory: 'הוצאות בית', subCategory: 'דיור', dayOfMonth: 1, startCycle: '2026-09', description: 'שכר דירה', skip: [] };

test('planRecurringGenerations: לא יוצרת לפני שהתאריך הגיע', () => {
  // מחזור 2026-11 מתחיל ב-10/11; יום 1 נופל ב-01/12
  const plan = L.planRecurringGenerations({ recurring: [rent], existingIds: [], today: '2026-11-20', cycleDay: 10 });
  const ids = plan.map(p => p.id);
  assert.ok(!ids.includes('rec_r1_2026-11'));
  assert.ok(ids.includes('rec_r1_2026-10')); // 01/11 כבר עבר
});

test('planRecurringGenerations: אידמפוטנטית, לא יוצרת מה שכבר קיים', () => {
  const first = L.planRecurringGenerations({ recurring: [rent], existingIds: [], today: '2026-12-02', cycleDay: 10 });
  const again = L.planRecurringGenerations({ recurring: [rent], existingIds: first.map(p => p.id), today: '2026-12-02', cycleDay: 10 });
  assert.equal(again.length, 0);
});

test('planRecurringGenerations: מכבדת מחיקה (skip) והתחלה (startCycle)', () => {
  const r = { ...rent, skip: ['2026-10'], startCycle: '2026-10' };
  const plan = L.planRecurringGenerations({ recurring: [r], existingIds: [], today: '2026-12-02', cycleDay: 10 });
  const ids = plan.map(p => p.id);
  assert.ok(!ids.includes('rec_r1_2026-10'));
  assert.ok(ids.includes('rec_r1_2026-11'));
  assert.ok(!ids.includes('rec_r1_2026-09')); // לפני startCycle
});

test('planRecurringGenerations: לא ממלאת היסטוריה ארוכה', () => {
  const old = { ...rent, startCycle: '2020-01' };
  const plan = L.planRecurringGenerations({ recurring: [old], existingIds: [], today: '2026-12-15', cycleDay: 10 });
  assert.ok(plan.length <= 3);
});

test('planRecurringGenerations: הוצאה מקבלת סוג הוצאה והכנסה לא', () => {
  const salary = { id: 's1', type: 'income', amount: 9000, mainCategory: 'הכנסות מעבודה', subCategory: 'משכורת 1', dayOfMonth: 10, startCycle: '2026-11' };
  const [exp] = L.planRecurringGenerations({ recurring: [rent], existingIds: [], today: '2026-11-20', cycleDay: 10 });
  const [inc] = L.planRecurringGenerations({ recurring: [salary], existingIds: [], today: '2026-11-20', cycleDay: 10 });
  assert.equal(exp.data.expenseType, 'קבועות');
  assert.equal(inc.data.expenseType, undefined);
  assert.equal(inc.data.recurringId, 's1');
});

test('planRecurringGenerations: מדלגת על הגדרה לא פעילה או בלי סכום', () => {
  const plan = L.planRecurringGenerations({ recurring: [{ ...rent, active: false }, { ...rent, id: 'x', amount: 0 }], existingIds: [], today: '2026-12-15', cycleDay: 10 });
  assert.equal(plan.length, 0);
});

test('recurringEndCycle: ללא סיום, עד חודש, ומספר תשלומים', () => {
  assert.equal(L.recurringEndCycle({ mode: 'none', firstCycle: '2026-11' }), null);
  assert.equal(L.recurringEndCycle({ mode: 'until', endMonth: '2027-03', firstCycle: '2026-11' }), '2027-03');
  assert.equal(L.recurringEndCycle({ mode: 'count', count: 12, firstCycle: '2026-11' }), '2027-10');
  assert.equal(L.recurringEndCycle({ mode: 'count', count: 1, firstCycle: '2026-11' }), '2026-11');
  assert.equal(L.recurringEndCycle({ mode: 'count', count: 0, firstCycle: '2026-11' }), null);
});

test('planRecurringGenerations: לא יוצרת אחרי endCycle', () => {
  const inst = { ...rent, startCycle: '2026-08', endCycle: '2026-10' };
  const ids = L.planRecurringGenerations({ recurring: [inst], existingIds: [], today: '2026-12-15', cycleDay: 10, lookback: 4 }).map(p => p.id);
  assert.ok(ids.includes('rec_r1_2026-10'));
  assert.ok(!ids.includes('rec_r1_2026-11'));
  assert.ok(!ids.includes('rec_r1_2026-12'));
});

test('getSubCaps: תקרות לחודש, ונפילה אחורה לתקרות הישנות', () => {
  const house = { caps: { 'א > ב': 100 }, monthlyPlans: { '2026-11': { subCaps: { 'א > ב': 250 } }, '2026-10': {} } };
  assert.equal(L.getSubCaps(house, '2026-11')['א > ב'], 250);
  assert.equal(L.getSubCaps(house, '2026-10')['א > ב'], 100); // לתכנון אין subCaps
  assert.equal(L.getSubCaps(house, '2026-09')['א > ב'], 100); // אין תכנון בכלל
});

test('budgetAlert: חריגה, אזהרת 80% חד-פעמית, ושקט', () => {
  assert.equal(L.budgetAlert({ spent: 900, amount: 200, limit: 1000 }).level, 'over');
  assert.equal(L.budgetAlert({ spent: 700, amount: 150, limit: 1000 }).level, 'warn');
  assert.equal(L.budgetAlert({ spent: 850, amount: 50, limit: 1000 }).level, null); // כבר מעל 80%
  assert.equal(L.budgetAlert({ spent: 100, amount: 100, limit: 1000 }).level, null);
  assert.equal(L.budgetAlert({ spent: 0, amount: 10, limit: undefined }).level, null);
  assert.equal(L.budgetAlert({ spent: 0, amount: 10, limit: 0 }).level, 'over'); // אפס מפורש
});

test('daysLeftInCycle: בתוך, לפני ואחרי המחזור', () => {
  // מחזור 2026-11 עם יום 10: 10/11 עד 09/12 (30 ימים)
  const cur = L.daysLeftInCycle('2026-11-18', '2026-11', 10);
  assert.equal(cur.state, 'current'); assert.equal(cur.totalDays, 30); assert.equal(cur.left, 22);
  assert.equal(L.daysLeftInCycle('2026-12-09', '2026-11', 10).left, 1); // היום האחרון
  assert.equal(L.daysLeftInCycle('2026-12-10', '2026-11', 10).state, 'past');
  assert.equal(L.daysLeftInCycle('2026-11-01', '2026-11', 10).state, 'future');
});

test('monthStatus: נותר לתקציב, ממוצע ליום וקטגוריות קרובות לתקרה', () => {
  const plan = { categoryBudgets: { 'אוכל': 2000, 'תחבורה': 500 } };
  const st = L.monthStatus({ today: '2026-11-18', cycleKey: '2026-11', cycleDay: 10, plan, catTotals: { 'אוכל': 1700, 'תחבורה': 100, 'בילויים': 300 }, totalExpenses: 2100 });
  assert.equal(st.hasBudget, true);
  assert.equal(st.totalBudget, 2500);
  assert.equal(st.remaining, 700);
  assert.equal(Math.round(st.perDay), 32); // 700 / 22
  assert.equal(st.near.length, 1); assert.equal(st.near[0].cat, 'אוכל'); assert.equal(st.near[0].pct, 85);
  assert.equal(st.unbudgetedSpent, 300);
});

test('monthStatus: בלי תקציב', () => {
  const st = L.monthStatus({ today: '2026-11-18', cycleKey: '2026-11', cycleDay: 10, plan: undefined, catTotals: {}, totalExpenses: 0 });
  assert.equal(st.hasBudget, false); assert.equal(st.perDay, 0);
});
