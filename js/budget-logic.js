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
        if (rec.endCycle && cycleKey > rec.endCycle) continue; // הסתיימה (תשלומים / עד חודש)
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
            ...(rec.createdBy ? { createdBy: rec.createdBy } : {}),
            ...(rec.type === 'expense' ? { expenseType: rec.expenseType || 'קבועות', budgetClassification: 'צרכים' } : {})
          }
        });
      }
    });
    return out;
  }


  /**
   * מחזור הסיום של תנועה קבועה.
   * mode: 'none' | 'until' (endMonth = 'YYYY-MM') | 'count' (count = מספר תשלומים כולל הראשון)
   * firstCycle הוא המחזור של התשלום הראשון.
   */
  function recurringEndCycle({ mode, endMonth, count, firstCycle }) {
    if (mode === 'until' && /^\d{4}-\d{2}$/.test(endMonth || '')) return endMonth;
    if (mode === 'count' && Number.isInteger(count) && count >= 1) return shiftMonth(firstCycle, count - 1);
    return null;
  }

  // התקרות של תתי-קטגוריות לחודש מסוים. אם לחודש אין תקרות משלו, נופלים אחורה לתקרות הישנות המשותפות.
  function getSubCaps(house, monthKey) {
    const plan = (house.monthlyPlans || {})[monthKey];
    if (plan && plan.subCaps) return plan.subCaps;
    return house.caps || {};
  }

  /**
   * התראה לפני הוספת הוצאה.
   * 'over'  - ההוצאה תעבור את הגבול
   * 'warn'  - ההוצאה תחצה את 80% מהגבול (פעם אחת, לא בכל הוצאה)
   */
  function budgetAlert({ spent, amount, limit }) {
    if (limit === undefined || limit === null || limit === '' || isNaN(Number(limit))) return { level: null };
    limit = Number(limit);
    const after = spent + amount;
    if (after > limit) return { level: 'over', pct: limit > 0 ? Math.round(after / limit * 100) : null };
    if (limit > 0 && after / limit >= 0.8 && spent / limit < 0.8) return { level: 'warn', pct: Math.round(after / limit * 100) };
    return { level: null };
  }

  function parseLocalDate(str) { const [y, m, d] = str.split('-').map(Number); return new Date(y, m - 1, d); }

  // כמה ימים נשארו במחזור (כולל היום). state: 'past' | 'current' | 'future'
  function daysLeftInCycle(today, cycleKey, cycleDay) {
    const { start, end } = cycleRange(cycleKey, cycleDay);
    const t = parseLocalDate(today);
    const endDay = new Date(end.getFullYear(), end.getMonth(), end.getDate());
    const totalDays = Math.round((endDay - start) / 864e5) + 1;
    if (t < start) return { state: 'future', left: totalDays, totalDays };
    if (t > endDay) return { state: 'past', left: 0, totalDays };
    return { state: 'current', left: Math.round((endDay - t) / 864e5) + 1, totalDays };
  }

  // נתוני כרטיס "איפה אני עומד"
  function monthStatus({ today, cycleKey, cycleDay, plan, catTotals, totalExpenses }) {
    const d = daysLeftInCycle(today, cycleKey, cycleDay);
    const budgets = (plan && plan.categoryBudgets) || {};
    const names = Object.keys(budgets);
    const totalBudget = names.reduce((s, c) => s + (budgets[c] || 0), 0);
    const budgetedSpent = names.reduce((s, c) => s + ((catTotals || {})[c] || 0), 0);
    const remaining = totalBudget - budgetedSpent;
    const perDay = d.state === 'current' && d.left > 0 ? Math.max(0, remaining) / d.left : null;
    const near = names.map(cat => {
      const budget = budgets[cat] || 0, spent = (catTotals || {})[cat] || 0;
      return { cat, budget, spent, pct: budget > 0 ? Math.round(spent / budget * 100) : (spent > 0 ? 999 : 0) };
    }).filter(x => x.pct >= 80).sort((a, b) => b.pct - a.pct);
    return {
      state: d.state, daysLeft: d.left, totalDays: d.totalDays,
      hasBudget: totalBudget > 0, totalBudget, budgetedSpent, remaining, perDay, near,
      unbudgetedSpent: Math.max(0, (totalExpenses || 0) - budgetedSpent)
    };
  }

  // צפי אפקטיבי לכל קטגוריה: הצפי השמור, ואם אין כזה, סכום התקרות של תתי-הקטגוריות (גם כשנשמרו רק תקרות)
  function effectiveBudgets(plan, caps) {
    const out = { ...((plan && plan.categoryBudgets) || {}) };
    Object.keys(caps || {}).forEach(key => {
      const cat = key.split(' > ')[0];
      if (out[cat] !== undefined) return;
      out.__sum = out.__sum || {};
      out.__sum[cat] = (out.__sum[cat] || 0) + (Number(caps[key]) || 0);
    });
    const sums = out.__sum || {}; delete out.__sum;
    Object.keys(sums).forEach(cat => { if (sums[cat] > 0) out[cat] = sums[cat]; });
    return out;
  }

  // ---------- דוחות לפי תקופה ----------
  const PERIOD_LEN = { month: 1, quarter: 3, half: 6, year: 12 };

  // מחזורי החיוב (מפתחות YYYY-MM) שנכללים בתקופה שבה נמצא anchorKey. רבעון/מחצית/שנה לפי לוח שנה.
  function periodCycles(anchorKey, period) {
    const len = PERIOD_LEN[period] || 1;
    const [y, m] = anchorKey.split('-').map(Number);
    const startM = len === 1 ? m : Math.floor((m - 1) / len) * len + 1;
    const first = `${y}-${pad(startM)}`;
    return Array.from({ length: len }, (_, i) => shiftMonth(first, i));
  }

  function shiftPeriod(anchorKey, period, delta) {
    const len = PERIOD_LEN[period] || 1;
    return shiftMonth(periodCycles(anchorKey, period)[0], delta * len);
  }

  // סיכום תנועות בתקופה. המחזור נקבע לפי התאריך והגדרת תחילת המחזור הנוכחית.
  function aggregateTransactions(transactions, cycleKeys, cycleDay) {
    const set = new Set(cycleKeys);
    const out = { income: 0, expense: 0, byCategory: {}, byCycle: {}, count: 0 };
    cycleKeys.forEach(k => { out.byCycle[k] = { income: 0, expense: 0 }; });
    (transactions || []).forEach(t => {
      if (!t || !t.date) return;
      const key = cycleKeyForDate(t.date, cycleDay);
      if (!set.has(key)) return;
      const amt = Number(t.amount) || 0;
      out.count++;
      if (t.type === 'income') { out.income += amt; out.byCycle[key].income += amt; }
      else { out.expense += amt; out.byCycle[key].expense += amt; out.byCategory[t.mainCategory] = (out.byCategory[t.mainCategory] || 0) + amt; }
    });
    return out;
  }

  // שינוי לכל קטגוריה מול תקופה קודמת. pct הוא null כשלא היו הוצאות בתקופה הקודמת (חדש).
  function compareCategories(curMap, prevMap) {
    const names = [...new Set([...Object.keys(curMap || {}), ...Object.keys(prevMap || {})])];
    return names.map(cat => {
      const cur = (curMap || {})[cat] || 0, prev = (prevMap || {})[cat] || 0, diff = cur - prev;
      return { cat, cur, prev, diff, pct: prev > 0 ? Math.round(diff / prev * 100) : null, isNew: prev === 0 && cur > 0 };
    }).sort((a, b) => b.cur - a.cur);
  }

  // "לאן הכסף נעלם": העליות והירידות הגדולות ביותר, בלי רעש של שינויים קטנים
  function topChanges(rows, { n = 3, minDiff = 50 } = {}) {
    const up = rows.filter(r => r.diff >= minDiff).sort((a, b) => b.diff - a.diff).slice(0, n);
    const down = rows.filter(r => r.diff <= -minDiff).sort((a, b) => a.diff - b.diff).slice(0, n);
    return { up, down };
  }

  // כמה להפקיד בחודש כדי להגיע ליעד עד חודש מסוים (כולל החודש הנוכחי)
  function savingsPlan({ target, saved, deadline, today }) {
    const remaining = Math.max(0, (Number(target) || 0) - (Number(saved) || 0));
    if (remaining === 0) return { status: 'done', remaining: 0 };
    if (!/^\d{4}-\d{2}$/.test(deadline || '')) return { status: 'nodeadline', remaining };
    const [ty, tm] = today.split('-').map(Number), [dy, dm] = deadline.split('-').map(Number);
    const monthsLeft = (dy * 12 + dm) - (ty * 12 + tm) + 1;
    if (monthsLeft <= 0) return { status: 'overdue', remaining };
    return { status: 'ok', remaining, monthsLeft, perMonth: Math.ceil(remaining / monthsLeft) };
  }

  return { pad, shiftMonth, cycleKeyForDate, cycleRange, dueDateForCycle, recurringTxId, planRecurringGenerations, recurringEndCycle, getSubCaps, budgetAlert, daysLeftInCycle, monthStatus, effectiveBudgets, periodCycles, shiftPeriod, aggregateTransactions, compareCategories, topChanges, savingsPlan };
});
