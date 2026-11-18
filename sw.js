// Service worker: מאפשר התקנה ופתיחה מהירה. הנתונים עצמם תמיד מגיעים חיים מ-Firebase ולא נשמרים כאן.
const CACHE = 'budget-shell-v1';
const SHELL = ['./', 'index.html', 'js/budget-logic.js', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
// רשת קודם (כדי שתמיד תקבלו את הגרסה העדכנית), ומטמון רק כשאין חיבור. בקשות לדומיינים אחרים (Firebase וכו') לא נוגעים בהן.
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(
    fetch(req).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req).then(r => r || caches.match('index.html')))
  );
});
