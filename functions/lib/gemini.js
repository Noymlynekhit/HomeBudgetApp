'use strict';
const MODELS = ['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-flash-latest', 'gemini-2.0-flash'];

// קורא ל-Gemini עם גיבוי למודלים אחרים אם המודל לא זמין. fetchFn מוזרק כדי שאפשר יהיה לבדוק.
async function generateWithFallback({ apiKey, parts, fetchFn = fetch, models = MODELS }) {
  let lastError = null;
  for (const model of models) {
    let data;
    const res = await fetchFn(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: 'POST',
      // המפתח נשלח בכותרת ולא בכתובת, כדי שלא יישמר בלוגים
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({ contents: [{ parts }] })
    });
    data = await res.json();
    if (data.error) {
      lastError = new Error(data.error.message || 'Gemini error');
      lastError.code = data.error.code;
      const gone = data.error.code === 404 || /not found|not supported|deprecated/i.test(data.error.message || '');
      if (gone) continue;
      throw lastError;
    }
    const text = (data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts || []).map(p => p.text || '').join('');
    if (!text) throw new Error('EMPTY_RESPONSE');
    return { text, model };
  }
  throw lastError || new Error('NO_MODEL');
}

// הודעה ברורה בעברית לפי סוג השגיאה מ-Gemini, כדי שיהיה אפשר להבין מה קרה בלי לקרוא לוגים
function describeGeminiError(e) {
  const code = Number(e && e.code) || 0;
  const msg = String((e && e.message) || '');
  if (code === 402 || /prepayment|credits are depleted|billing/i.test(msg)) return { status: 'billing', text: 'לפרויקט של מפתח ה-Gemini נגמרה היתרה (שגיאה 402). צריך מפתח מפרויקט בשכבה החינמית, או להוסיף יתרה ב-AI Studio.' };
  if (code === 429 || /quota|rate.?limit|exhausted/i.test(msg)) return { status: 'quota', text: 'עברתם את מגבלת השימוש של Gemini (שגיאה 429). נסו שוב בעוד דקה.' };
  if (code === 401 || code === 403 || (code === 400 && /api key/i.test(msg))) return { status: 'key', text: 'מפתח ה-Gemini לא תקין או חסרה לו הרשאה (שגיאה ' + (code || 400) + '). צריך ליצור מפתח חדש ולשמור אותו בשרת.' };
  if (code === 404) return { status: 'model', text: 'מודל ה-AI לא זמין כרגע (שגיאה 404).' };
  if (code === 503 || code === 500) return { status: 'overloaded', text: 'שרתי Gemini עמוסים כרגע (שגיאה ' + code + '). נסו שוב בעוד רגע.' };
  if (msg === 'EMPTY_RESPONSE') return { status: 'empty', text: 'Gemini לא החזיר תשובה (ייתכן שהתוכן נחסם). נסו לנסח אחרת.' };
  if (/fetch failed|ENOTFOUND|ETIMEDOUT|ECONNRESET/i.test(msg)) return { status: 'network', text: 'הייתה בעיית רשת בין השרת ל-Gemini. נסו שוב.' };
  return { status: 'unknown', text: 'שגיאה בתקשורת מול ה-AI' + (code ? ' (קוד ' + code + ')' : '') + '. נסו שוב.' };
}

module.exports = { generateWithFallback, describeGeminiError, MODELS };
