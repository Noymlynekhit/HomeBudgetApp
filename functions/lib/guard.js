'use strict';
// לוגיקה טהורה (בלי Firebase) כדי שאפשר יהיה לבדוק אותה. משקפת את firestore.rules.

const HOUSE_CODE_RE = /^[^\/\s]{1,100}$/;
const MAX_PARTS_BYTES = 7 * 1024 * 1024; // מגבלת הקריאה היא 10MB, משאירים מרווח לבסיס64
const DAILY_LIMIT = 60;

function isHouseMember(house, email) {
  if (!house || !email) return false;
  const me = String(email).toLowerCase();
  const members = Array.isArray(house.memberEmails) ? house.memberEmails : [String(house.email || '').toLowerCase()];
  return members.map(e => String(e).toLowerCase()).includes(me);
}

// מחזיר הודעת שגיאה, או null אם הקלט תקין
function validateRequest(data) {
  if (!data || typeof data !== 'object') return 'בקשה ריקה';
  if (typeof data.houseCode !== 'string' || !HOUSE_CODE_RE.test(data.houseCode)) return 'קוד בית לא תקין';
  if (!Array.isArray(data.parts) || data.parts.length === 0 || data.parts.length > 5) return 'תוכן הבקשה לא תקין';
  for (const p of data.parts) {
    if (!p || typeof p !== 'object') return 'תוכן הבקשה לא תקין';
    const isText = typeof p.text === 'string';
    const isFile = p.inline_data && typeof p.inline_data.data === 'string' && typeof p.inline_data.mime_type === 'string';
    if (!isText && !isFile) return 'תוכן הבקשה לא תקין';
  }
  if (JSON.stringify(data.parts).length > MAX_PARTS_BYTES) return 'הקובץ גדול מדי';
  return null;
}

function usageDocId(uid, now = new Date()) {
  const d = now.toISOString().slice(0, 10).replace(/-/g, '');
  return `${uid}_${d}`;
}

function withinLimit(count, limit = DAILY_LIMIT) { return count < limit; }

module.exports = { isHouseMember, validateRequest, usageDocId, withinLimit, DAILY_LIMIT, HOUSE_CODE_RE };
