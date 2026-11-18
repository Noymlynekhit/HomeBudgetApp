/*
 * budget-logic.js
 * לוגיקה טהורה (בלי DOM ובלי Firebase) של מחזורי חיוב ותנועות קבועות.
 * רצה גם בדפדפן (window.BudgetLogic) וגם ב-Node (בדיקות אוטומטיות).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BudgetLogic = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const pad = n => String(n).padStart(2, '0');

  function shiftMonth(key, delta) {
    let [y, m] = key.split('-').map(Number);
    m += delta;
    while (m < 1) { m += 12; y--; }
    while (m > 12) { m -= 12; y++; }
    return `${y}-${pad(m)}`;
  }

  // מחזור שמתחיל ב-10 לחודש נקרא על שם החודש שבו הוא מתחיל
  function cycleKeyForDate(dateStr, cycleDay) {
    const [y, m, d] = dateStr.split('-').map(Number);
    const key = `${y}-${pad(m)}`;
    return (cycleDay > 1 && d < cycleDay) ? shiftMonth(key, -1) : key;
  }

  function cycleRange(monthKey, cycleDay) {
    const [y, m] = monthKey.split('-').map(Number);
    if (cycleDay === 1) return { start: new Date(y, m - 1, 1), end: new Date(y, m, 0, 23, 59, 59) };
    return { start: new Date(y, m - 1, cycleDay), end: new Date(y, m, cycleDay - 1, 23, 59, 59) };
  }

  function daysInMonth(y, m) { return new Date(y, m, 0).getDate(); }

  /**
   * התאריך שבו תנועה קבועה (יום X בחודש) נופלת בתוך מחזור נתון.
   * מחזור שמתחיל ב-10: יום 15 -> אותו חודש, יום 5 -> החודש הבא.
   * יום שלא קיים בחודש (31 בפברואר) מוקטן ליום האחרון בחודש.
   */
  function dueDateForCycle(cycleKey, cycleDay, dayOfMonth) {
    let [y, m] = cycleKey.split('-').map(Number);
    if (cycleDay > 1 && dayOfMonth < cycleDay) {
      const next = shiftMonth(cycleKey, 1).split('-').map(Number);
      y = next[0]; m = next[1];
    }
    const d = Math.min(dayOfMonth, daysInMonth(y, m));
    return `${y}-${pad(m)}-${pad(d)}`;
  }

  // מזהה קבוע לתנועה שנוצרה מהגדרה קבועה: אותו מזהה בכל מכשיר, ולכן אין כפילויות
  function recurringTxId(recId, cycleKey) { return `rec_${recId}_${cycleKey}`; }

  /**
   * מחזירה רשימת תנועות שצריך ליצור עכשיו.
   * - רק למחזור הנוכחי ולמחזורים שקדמו לו (עד lookback), כדי לא למלא היסטוריה ארוכה
   * - רק אם תאריך התנועה הגיע (<= today)
   * - לא אם כבר קיימת, ולא אם המשתמש מחק אותה (skip)
   */
  function planRecurringGenerations({ recurring = [], existingIds = [], today, cycleDay, lookback = 2 }) {
    const have = new Set(existingIds);
    const currentCycle = cycleKeyForDate(today, cycleDay);
    const out = [];
    recurring.forEach(rec => {
      if (!rec || rec.active === false || !(rec.amount > 0)) return;
      const skip = new Set(rec.skip || []);
      for (let i = lookback; i >= 0; i--) {
        const cycleKey = shiftMonth(currentCycle, -i);
        if (rec.startCycle && cycleKey < rec.startCycle) continue;
        if (skip.has(cycleKey)) continue;
        const id = recurringTxId(rec.id, cycleKey);
        if (have.has(id)) continue;
        const date = dueDateForCycle(cycleKey, cycleDay, rec.dayOfMonth);
        if (date > today) continue;
        out.push({
          id,
          data: {
            type: rec.type,
            amount: rec.amount,
            paymentMethod: rec.type === 'expense' ? (rec.paymentMethod || 'הוראת קבע') : 'העברה בנקאית',
            mainCategory: rec.mainCategory,
            subCategory: rec.subCategory,
            date,
            description: rec.description || '-',
            monthKey: cycleKey,
            recurringId: rec.id,
            ...(rec.type === 'expense' ? { expenseType: rec.expenseType || 'קבועות', budgetClassification: 'צרכים' } : {})
          }
        });
      }
    });
    return out;
  }

  return { pad, shiftMonth, cycleKeyForDate, cycleRange, dueDateForCycle, recurringTxId, planRecurringGenerations };
});
