'use strict';
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const admin = require('firebase-admin');
const { isHouseMember, validateRequest, usageDocId, withinLimit, DAILY_LIMIT } = require('./lib/guard');
const { generateSmart, describeGeminiError } = require('./lib/gemini');

admin.initializeApp();
const db = admin.firestore();
const GEMINI_API_KEY = defineSecret('GEMINI_API_KEY');

// פרוקסי מאובטח ל-Gemini: המפתח נשאר בשרת, ורק חברי בית מחוברים עם מייל מאומת יכולים להשתמש בו.
exports.askGemini = onCall(
  { region: 'europe-west1', secrets: [GEMINI_API_KEY], maxInstances: 3, timeoutSeconds: 90, memory: '256MiB' },
  async (request) => {
    const { auth, data } = request;
    if (!auth || !auth.token.email || auth.token.email_verified !== true) {
      throw new HttpsError('unauthenticated', 'יש להתחבר עם מייל מאומת.');
    }
    const problem = validateRequest(data);
    if (problem) throw new HttpsError('invalid-argument', problem);

    const snap = await db.doc(`registered_houses/${data.houseCode}`).get();
    if (!snap.exists || !isHouseMember(snap.data(), auth.token.email)) {
      throw new HttpsError('permission-denied', 'אין הרשאה לבית הזה.');
    }

    // הגבלת שימוש יומית למשתמש, כדי להגן מפני לולאות או שימוש לרעה
    const usageRef = db.doc(`ai_usage/${usageDocId(auth.uid)}`);
    await db.runTransaction(async tx => {
      const u = await tx.get(usageRef);
      const count = u.exists ? (u.data().count || 0) : 0;
      if (!withinLimit(count)) throw new HttpsError('resource-exhausted', `הגעתם למגבלה היומית (${DAILY_LIMIT} בקשות). אפשר לנסות שוב מחר.`);
      tx.set(usageRef, { count: count + 1, uid: auth.uid, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
    });

    try {
      const { text, model } = await generateSmart({ apiKey: GEMINI_API_KEY.value(), parts: data.parts, log: (...a) => console.log('gemini:', ...a) });
      return { text, model };
    } catch (e) {
      const d = describeGeminiError(e);
      console.error('Gemini failed', d.status, e.code, e.message); // בלי תוכן הבקשה, כדי לא לשמור נתונים פיננסיים בלוגים
      throw new HttpsError('failed-precondition', d.text, { reason: d.status });
    }
  }
);
