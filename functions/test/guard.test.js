'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { isHouseMember, validateRequest, usageDocId, withinLimit } = require('../lib/guard');
const { generateWithFallback, describeGeminiError } = require('../lib/gemini');

test('isHouseMember: רשימת חברים, אותיות גדולות וקטנות, ובית ישן', () => {
  assert.equal(isHouseMember({ memberEmails: ['a@x.com', 'B@x.com'] }, 'b@X.com'), true);
  assert.equal(isHouseMember({ memberEmails: ['a@x.com'] }, 'c@x.com'), false);
  assert.equal(isHouseMember({ email: 'Old@x.com' }, 'old@x.com'), true); // בית ישן בלי memberEmails
  assert.equal(isHouseMember(null, 'a@x.com'), false);
  assert.equal(isHouseMember({ memberEmails: ['a@x.com'] }, ''), false);
});

test('validateRequest: קלט תקין ולא תקין', () => {
  assert.equal(validateRequest({ houseCode: 'home1', parts: [{ text: 'שלום' }] }), null);
  assert.equal(validateRequest({ houseCode: 'home1', parts: [{ inline_data: { mime_type: 'application/pdf', data: 'AAA' } }, { text: 'x' }] }), null);
  assert.ok(validateRequest(null));
  assert.ok(validateRequest({ houseCode: 'a/b', parts: [{ text: 'x' }] }));      // תו אסור בנתיב
  assert.ok(validateRequest({ houseCode: '', parts: [{ text: 'x' }] }));
  assert.ok(validateRequest({ houseCode: 'h', parts: [] }));
  assert.ok(validateRequest({ houseCode: 'h', parts: [{ foo: 1 }] }));
  assert.ok(validateRequest({ houseCode: 'h', parts: [{ text: 'x'.repeat(8 * 1024 * 1024) }] })); // גדול מדי
});

test('usageDocId ו-withinLimit', () => {
  assert.equal(usageDocId('u1', new Date('2026-11-22T10:00:00Z')), 'u1_20261122');
  assert.equal(withinLimit(59), true);
  assert.equal(withinLimit(60), false);
});

test('generateWithFallback: עובר למודל הבא כשהראשון לא נמצא, ושולח את המפתח בכותרת', async () => {
  const calls = [];
  const fetchFn = async (url, opts) => {
    calls.push({ url, key: opts.headers['x-goog-api-key'] });
    if (calls.length === 1) return { json: async () => ({ error: { code: 404, message: 'model not found' } }) };
    return { json: async () => ({ candidates: [{ content: { parts: [{ text: 'שלום' }, { text: '!' }] } }] }) };
  };
  const r = await generateWithFallback({ apiKey: 'SECRET', parts: [{ text: 'x' }], fetchFn, models: ['m1', 'm2'] });
  assert.equal(r.text, 'שלום!'); assert.equal(r.model, 'm2');
  assert.ok(calls.every(c => c.key === 'SECRET' && !c.url.includes('SECRET')));
});

test('generateWithFallback: שגיאת מפתח או בקשה לא מנסה מודל נוסף', async () => {
  let n = 0;
  const fetchFn = async () => { n++; return { json: async () => ({ error: { code: 400, message: 'API key not valid' } }) }; };
  await assert.rejects(generateWithFallback({ apiKey: 'k', parts: [], fetchFn, models: ['a', 'b'] }), /API key/);
  assert.equal(n, 1);
});

test('generateWithFallback: תשובה ריקה נכשלת', async () => {
  const fetchFn = async () => ({ json: async () => ({ candidates: [] }) });
  await assert.rejects(generateWithFallback({ apiKey: 'k', parts: [], fetchFn, models: ['a'] }), /EMPTY_RESPONSE/);
});

test('describeGeminiError: הודעה ברורה לפי סוג השגיאה', () => {
  assert.equal(describeGeminiError({ code: 402, message: 'Your prepayment credits are depleted' }).status, 'billing');
  assert.equal(describeGeminiError({ code: 429, message: 'quota' }).status, 'quota');
  assert.equal(describeGeminiError({ code: 400, message: 'API key not valid' }).status, 'key');
  assert.equal(describeGeminiError({ code: 403, message: 'denied' }).status, 'key');
  assert.equal(describeGeminiError({ code: 404, message: 'x' }).status, 'model');
  assert.equal(describeGeminiError({ code: 503, message: 'x' }).status, 'overloaded');
  assert.equal(describeGeminiError(new Error('EMPTY_RESPONSE')).status, 'empty');
  assert.equal(describeGeminiError(new TypeError('fetch failed')).status, 'network');
  assert.match(describeGeminiError({ code: 418, message: 'x' }).text, /418/);
  assert.equal(describeGeminiError(null).status, 'unknown');
});

test('generateWithFallback: מודל עמוס (503) עובר למודל הבא', async () => {
  const seen = [];
  const fetchFn = async (url) => {
    seen.push(url);
    if (seen.length === 1) return { json: async () => ({ error: { code: 503, message: 'The model is overloaded' } }) };
    return { json: async () => ({ candidates: [{ content: { parts: [{ text: 'בסדר' }] } }] }) };
  };
  const r = await generateWithFallback({ apiKey: 'k', parts: [], fetchFn, models: ['a', 'b'] });
  assert.equal(r.text, 'בסדר'); assert.equal(r.model, 'b');
});

test('generateWithFallback: אם כל המודלים עמוסים מחזירים את השגיאה האחרונה', async () => {
  const fetchFn = async () => ({ json: async () => ({ error: { code: 503, message: 'overloaded' } }) });
  await assert.rejects(generateWithFallback({ apiKey: 'k', parts: [], fetchFn, models: ['a', 'b'] }), e => e.code === 503);
});
