'use strict';
const MODELS = ['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-flash-latest', 'gemini-2.0-flash'];

// קורא ל-Gemini עם גיבוי למודלים אחרים אם המודל לא זמין. fetchFn מוזרק כדי שאפשר יהיה לבדוק.
async function generateWithFallback({ apiKey, parts, fetchFn = fetch, models = MODELS }) {
  let lastError = null, bestError = null;
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
      // אם כל המודלים נכשלו, מחזירים את השגיאה המשמעותית (עומס, מכסה) ולא את ה-404 האחרון
      if (data.error.code !== 404 && !bestError) bestError = lastError;
      // מודל שלא קיים, עמוס או חרג מהמכסה שלו: עוברים למודל הבא (לכל מודל יש עומס ומכסה משלו)
      const tryNext = [404, 429, 500, 503].includes(data.error.code) || /not found|not supported|deprecated|overloaded|unavailable/i.test(data.error.message || '');
      if (tryNext) continue;
      throw lastError;
    }
    const text = (data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts || []).map(p => p.text || '').join('');
    if (!text) throw new Error('EMPTY_RESPONSE');
    return { text, model };
  }
  throw bestError || lastError || new Error('NO_MODEL');
}


// ---------- בחירת מודלים דינמית: שמות המודלים משתנים עם הזמן, אז שואלים את Gemini מה זמין למפתח ----------
const STABLE_FLASH = /^gemini-(\d+(?:\.\d+)?)-flash(-lite)?$/;

async function listModels({ apiKey, fetchFn = fetch }) {
  const res = await fetchFn('https://generativelanguage.googleapis.com/v1beta/models?pageSize=200', { headers: { 'x-goog-api-key': apiKey } });
  const data = await res.json();
  if (data.error) { const e = new Error(data.error.message || 'ListModels error'); e.code = data.error.code; throw e; }
  return (data.models || [])
    .filter(m => (m.supportedGenerationMethods || []).includes('generateContent'))
    .map(m => String(m.name || '').replace(/^models\//, ''));
}

// מועדפים שקיימים קודם, אחריהם מודלי flash יציבים בסדר גרסה יורד (בלי preview/exp), עד max מודלים
function pickModels(available, preferred = MODELS, max = 4) {
  const have = new Set(available);
  const out = preferred.filter(m => have.has(m));
  const extra = available
    .filter(n => STABLE_FLASH.test(n) && !out.includes(n))
    .sort((a, b) => parseFloat(b.match(STABLE_FLASH)[1]) - parseFloat(a.match(STABLE_FLASH)[1]) || (a.includes('lite') ? 1 : -1));
  return [...out, ...extra].slice(0, max);
}

let modelCache = { at: 0, models: null };
const CACHE_MS = 60 * 60 * 1000;

async function generateSmart({ apiKey, parts, fetchFn = fetch, now = Date.now(), log = () => {} }) {
  let models = null;
  if (modelCache.models && now - modelCache.at < CACHE_MS) models = modelCache.models;
  else {
    try {
      const available = await listModels({ apiKey, fetchFn });
      const picked = pickModels(available);
      log('available models', available.length, 'picked', picked.join(','));
      if (picked.length) { models = picked; modelCache = { at: now, models }; }
    } catch (e) {
      if ([400, 401, 403].includes(e.code)) throw e; // מפתח לא תקין: אין טעם להמשיך
      log('listModels failed', e.code, e.message);
    }
  }
  try {
    return await generateWithFallback({ apiKey, parts, fetchFn, models: models || MODELS });
  } catch (e) {
    if (e.code === 404) modelCache = { at: 0, models: null }; // הרשימה כנראה התיישנה
    throw e;
  }
}

function resetModelCache() { modelCache = { at: 0, models: null }; }

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

module.exports = { generateWithFallback, generateSmart, listModels, pickModels, resetModelCache, describeGeminiError, MODELS };
