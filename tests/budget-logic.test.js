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
