const { chromium } = require('playwright');
const path = require('path');
// שימוש: node tests/e2e/smoke.js [נתיב ל-index.html]  (דורש: npm i -D playwright)
const PAGE = 'file://' + path.resolve(process.argv[2] || path.join(__dirname, '..', '..', 'index.html'));

const fakeApp = `export const initializeApp = () => ({});`;
const fakeFirestore = `
const S = (window.__fake = window.__fake || { docs: new Map(), listeners: [], seq: 0 });
const notify = () => S.listeners.forEach(l => l());
export const getFirestore = () => ({});
export const collection = (db, col) => ({ col });
export const doc = (db, col, id) => ({ col, id });
export const query = (c, w) => ({ col: c.col, w });
export const where = (field, op, val) => ({ field, val });
const key = r => r.col + '/' + r.id;
export const getDoc = async r => { const d = S.docs.get(key(r)); return { exists: () => !!d, data: () => d && structuredClone(d) }; };
export const setDoc = async (r, data) => { S.docs.set(key(r), structuredClone(data)); notify(); };
export const updateDoc = async (r, patch) => { const k = key(r); if (!S.docs.has(k)) throw new Error('no doc'); S.docs.set(k, { ...S.docs.get(k), ...structuredClone(patch) }); notify(); };
export const addDoc = async (c, data) => { const id = 'auto' + (++S.seq); S.docs.set(c.col + '/' + id, structuredClone(data)); notify(); return { id }; };
export const deleteDoc = async r => { S.docs.delete(key(r)); notify(); };
export const onSnapshot = (ref, cb) => {
  const run = () => {
    if (ref.id) { const d = S.docs.get(key(ref)); cb({ exists: () => !!d, data: () => d && structuredClone(d) }); }
    else {
      const rows = [...S.docs].filter(([k, v]) => k.startsWith(ref.col + '/') && (!ref.w || v[ref.w.field] === ref.w.val));
      cb({ forEach: f => rows.forEach(([k, v]) => f({ id: k.split('/')[1], data: () => structuredClone(v) })) });
    }
  };
  const l = () => setTimeout(run, 0); S.listeners.push(l); run();
  return () => { S.listeners = S.listeners.filter(x => x !== l); };
};`;
const fakeAuth = `
const user = { email: 'test@example.com', emailVerified: true, reload: async () => {}, getIdToken: async () => 't' };
export const getAuth = () => ({});
export const onAuthStateChanged = (a, cb) => { setTimeout(() => cb(user), 0); return () => {}; };
export const signInWithEmailAndPassword = async () => {}; export const createUserWithEmailAndPassword = async () => ({ user });
export const sendEmailVerification = async () => {}; export const sendPasswordResetEmail = async () => {};
export class GoogleAuthProvider {} export const signInWithPopup = async () => {}; export const signOut = async () => {};`;

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('dialog', d => d.accept());

  await page.route('**/*', route => {
    const u = route.request().url();
    if (u.startsWith('file://')) return route.continue();
    const js = b => route.fulfill({ contentType: 'application/javascript', body: b });
    if (u.includes('firebase-app.js')) return js(fakeApp);
    if (u.includes('firebase-firestore.js')) return js(fakeFirestore);
    if (u.includes('firebase-auth.js')) return js(fakeAuth);
    if (u.includes('chart')) return js('window.Chart=function(){return{destroy(){}}};');
    if (u.includes('tailwind')) return js('');
    return route.fulfill({ contentType: 'text/css', body: '' });
  });

  // תאריך קבוע כדי שהבדיקה תהיה דטרמיניסטית: 18/11/2026
  await page.addInitScript(() => {
    const fixed = new Date(2026, 10, 18, 12, 0, 0).getTime();
    const RealDate = Date;
    // eslint-disable-next-line
    globalThis.Date = class extends RealDate { constructor(...a) { if (a.length) super(...a); else super(fixed); } static now() { return fixed; } };
    localStorage.setItem('budget_house_code', 'testhome');
    const S = (window.__fake = window.__fake || { docs: new Map(), listeners: [], seq: 0 });
    S.docs.set('registered_houses/testhome', {
      houseCode: 'testhome', memberEmails: ['test@example.com'], cycleStartDay: 10,
      caps: { 'תחבורה > דלק': 111 }, paymentMethods: ['אשראי', 'מזומן / העברה'],
      savingsGoals: [{ name: 'חופשה', target: 5000, saved: 0 }],
      memberProfiles: [{ email: 'test@example.com', name: 'נוי' }],
      monthlyPlans: { '2026-11': { expectedIncome: 10000, categoryBudgets: { 'אוכל וקניות': 2000 }, subCaps: { 'אוכל וקניות > סופרמרקט': 1500 }, manualCats: ['אוכל וקניות'] } },
      recurring: [{ id: 'r1', type: 'expense', amount: 4000, mainCategory: 'הוצאות בית', subCategory: 'דיור - שכר דירה / משכנתא', dayOfMonth: 1, startCycle: '2026-10', description: 'שכר דירה', skip: [], active: true, paymentMethod: 'הוראת קבע', expenseType: 'קבועות' }]
    });
  });

  await page.goto(PAGE);
  await page.waitForTimeout(800);

  const txs = () => page.evaluate(() => [...window.__fake.docs].filter(([k]) => k.startsWith('house_transactions/')).map(([k, v]) => ({ id: k.split('/')[1], ...v })));
  const house = () => page.evaluate(() => window.__fake.docs.get('registered_houses/testhome'));
  const check = (name, cond, extra = '') => { console.log((cond ? 'PASS ' : 'FAIL ') + name + (extra ? '  ' + extra : '')); if (!cond) process.exitCode = 1; };

  // 1. תנועה קבועה נוצרת אוטומטית (שכר דירה של 01/11, מחזור 2026-10)
  let t = await txs();
  check('נוצרה תנועה קבועה אחת', t.length === 1 && t[0].id === 'rec_r1_2026-10', JSON.stringify(t.map(x => [x.id, x.date])));
  check('תאריך התנועה 01/11', t[0] && t[0].date === '2026-11-01');

  // 2. הרצה חוזרת לא יוצרת כפילות
  await page.evaluate(() => runRecurringGenerator());
  await page.waitForTimeout(300);
  check('אין כפילות בהרצה חוזרת', (await txs()).length === 1);

  // 3. הפקדה לקופה נרשמת כהוצאה ומעדכנת את הקופה
  const dep = page.evaluate(() => promptDepositToGoal(0));
  await page.waitForSelector('#fm_amount');
  await page.fill('#fm_amount', '250');
  await page.click('#formModalSubmit');
  await dep; await page.waitForTimeout(500);
  t = await txs(); const sav = t.find(x => x.savingsGoal);
  check('הפקדה נרשמה כהוצאה בקטגוריית חיסכון', !!sav && sav.type === 'expense' && sav.mainCategory === 'חיסכון' && sav.amount === 250);
  let h = await house();
  check('הקופה עודכנה ל-250', h.savingsGoals[0].saved === 250);
  check('קטגוריית חיסכון נוספה לבית', !!h.categories && !!h.categories['חיסכון']);

  // 4. מחיקת הפקדה מחזירה את הסכום מהקופה
  await page.evaluate(id => deleteTransaction(id), sav.id);
  await page.waitForTimeout(500);
  h = await house();
  check('מחיקת הפקדה מורידה מהקופה', h.savingsGoals[0].saved === 0 && !(await txs()).some(x => x.savingsGoal));

  // 5. מחיקת תנועה קבועה שנוצרה לא מחייה אותה
  await page.evaluate(() => deleteTransaction('rec_r1_2026-10'));
  await page.waitForTimeout(500);
  await page.evaluate(() => runRecurringGenerator());
  await page.waitForTimeout(300);
  h = await house();
  check('מחיקה נרשמה ב-skip', (h.recurring[0].skip || []).includes('2026-10'));
  check('התנועה לא נוצרה מחדש', !(await txs()).some(x => x.id === 'rec_r1_2026-10'));

  // 6. תנועה קבועה חדשה מהטופס
  await page.evaluate(() => switchMainTab('add'));
  await page.fill('#amount', '300');
  await page.fill('#transactionDate', '2026-11-12');
  await page.check('#isRecurring');
  await page.evaluate(() => updateRecurringLabel());
  const label = await page.textContent('#recurringDayLabel');
  check('תווית היום מציגה 12', label === '12');
  await page.click('#transactionSubmitBtn');
  await page.waitForTimeout(700);
  h = await house();
  check('נשמרה הגדרה קבועה חדשה', h.recurring.length === 2 && h.recurring[1].dayOfMonth === 12 && h.recurring[1].amount === 300);
  check('והתנועה הראשונה נוצרה', (await txs()).some(x => x.recurringId === h.recurring[1].id && x.date === '2026-11-12'));

  // 7. שם תצוגה
  await page.evaluate(() => { openSettingsModal(); document.getElementById('settingsDisplayNameInput').value = 'משפחת בדיקה'; });
  await page.evaluate(() => saveHouseSettings());
  await page.waitForTimeout(400);
  check('שם תצוגה בברכה', (await page.textContent('#greetingTitle')).includes('משפחת בדיקה'));


  // ---------- סבב 2 ----------
  // 8. כרטיס "איפה אני עומד"
  await page.evaluate(() => switchMainTab('overview'));
  const status = await page.textContent('#statusCard');
  check('כרטיס מצב מוצג עם תקציב', status.includes('איפה אני עומד') && status.includes('נותר לתקציב') && status.includes('נותרו 22 ימים'), status.replace(/\s+/g, ' ').slice(0, 120));

  // 9. תקרות לחודש בנפרד, סכום אוטומטי לקטגוריה, ואפס מפורש
  await page.evaluate(() => openMonthlyPlanningModal());
  const setSub = (main, sub, v) => page.evaluate(([m, sb, val]) => { const el = document.querySelector(`.plan-sub-input[data-main="${m}"][data-sub="${sb}"]`); el.value = val; el.dispatchEvent(new Event('input', { bubbles: true })); }, [main, sub, v]);
  await setSub('תחבורה', 'דלק', '300');
  await setSub('תחבורה', 'חניה', '0');
  const autoSum = await page.evaluate(() => document.querySelector('.plan-cat-input[data-cat="תחבורה"]').value);
  check('סכום הקטגוריה מתעדכן אוטומטית', autoSum === '300', autoSum);
  await page.evaluate(() => saveMonthlyPlanning());
  await page.waitForTimeout(400);
  h = await house();
  const plan = h.monthlyPlans['2026-11'];
  check('תקרות נשמרו לחודש ולא נגעו בישנות', plan.subCaps['תחבורה > דלק'] === 300 && h.caps['תחבורה > דלק'] === 111);
  check('אפס מפורש נשמר', plan.subCaps['תחבורה > חניה'] === 0);
  check('סימון ידני נשמר בחודש', plan.manualCats.includes('אוכל וקניות') && !plan.manualCats.includes('תחבורה'));

  // 10. חודש בלי תקרות משלו נופל אחורה לתקרות הישנות
  await page.evaluate(() => { document.getElementById('selectedMonth').value = '2026-10'; openMonthlyPlanningModal(); });
  const legacy = await page.evaluate(() => document.querySelector('.plan-sub-input[data-main="תחבורה"][data-sub="דלק"]').value);
  check('נפילה אחורה לתקרה הישנה', legacy === '111', legacy);
  await page.evaluate(() => { closeMonthlyPlanningModal(); document.getElementById('selectedMonth').value = '2026-11'; });

  // 11. אזהרת 80% חד-פעמית
  await page.evaluate(() => showBudgetWarningIfNeeded('תחבורה', 'דלק', 250, '2026-11'));
  const warnTxt = await page.textContent('#budgetAlertMessage');
  check('אזהרה בחציית 80%', warnTxt.includes('83%'), warnTxt);
  await page.evaluate(() => closeBudgetAlert());

  // 12. "מי הוציא": הזנה חדשה נרשמת עם המייל, והסינון והשם מוצגים
  await page.evaluate(() => switchMainTab('add'));
  await page.fill('#amount', '120');
  await page.fill('#transactionDate', '2026-11-12');
  await page.click('#transactionSubmitBtn');
  await page.waitForTimeout(500);
  t = await txs(); const mine = t.find(x => x.amount === 120);
  check('createdBy נרשם', !!mine && mine.createdBy === 'test@example.com');
  const personOpts = await page.evaluate(() => [...document.querySelectorAll('#filterPerson option')].map(o => o.value));
  check('סינון לפי אדם כולל את בן הבית', personOpts.includes('test@example.com') && personOpts.includes('UNKNOWN'));
  await page.evaluate(() => switchMainTab('details'));
  const rowTxt = await page.textContent('#transactionsTableBody');
  check('שם האדם מוצג בטבלה', rowTxt.includes('נוי'));

  // 13. הפיכת תנועה קיימת לקבועה עם 3 תשלומים
  await page.evaluate(id => editTransaction(id), mine.id);
  check('תיבת קבועה מוצגת בעריכה', await page.isVisible('#recurringFieldWrapper'));
  await page.check('#isRecurring');
  await page.selectOption('#recurringMode', 'count');
  await page.fill('#recurringCount', '3');
  await page.click('#transactionSubmitBtn');
  await page.waitForTimeout(600);
  h = await house();
  const conv = h.recurring[h.recurring.length - 1];
  check('הגדרה קבועה נוצרה עם סיום', conv.endCycle === '2027-01' && conv.startCycle === '2026-12' && conv.amount === 120, JSON.stringify([conv.startCycle, conv.endCycle]));
  t = await txs();
  check('התנועה הקיימת סומנה כקבועה', t.find(x => x.id === mine.id).recurringId === conv.id && t.filter(x => x.amount === 120).length === 1);

  // 14. ספירת תשלומים לא תקינה נחסמת
  await page.evaluate(() => switchMainTab('add'));
  await page.fill('#amount', '50'); await page.check('#isRecurring');
  await page.selectOption('#recurringMode', 'count'); await page.fill('#recurringCount', '1');
  const before = (await house()).recurring.length;
  await page.click('#transactionSubmitBtn'); await page.waitForTimeout(300);
  check('מספר תשלומים לא תקין לא נשמר', (await house()).recurring.length === before);

  console.log(errors.length ? 'JS ERRORS:\n' + errors.join('\n') : 'no JS errors');
  if (errors.length) process.exitCode = 1;
  await browser.close();
})();
