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

module.exports = { generateWithFallback, MODELS };
