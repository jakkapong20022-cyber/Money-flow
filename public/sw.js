/* Service worker: network-first (always the newest version when online), cached copy when offline.
   the version placeholder below is replaced by the server with a hash of the app files → a deploy changes this file → auto update. */
const CACHE = 'fb-__VERSION__';
const SHELL = ['/', '/app.js', '/app.css', '/ics.js', '/qr.js', '/icon.svg', '/manifest.webmanifest'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', (e) => {
  const r = e.request, u = new URL(r.url);
  if (r.method !== 'GET' || u.origin !== location.origin || /^\/(api|webhook|auth|calendar|healthz)\b/.test(u.pathname)) return;
  e.respondWith(fetch(r, { cache: 'no-store' }).then(res => { if (res.ok) { const c = res.clone(); caches.open(CACHE).then(x => x.put(r, c)); } return res; })
    .catch(() => caches.match(r, { ignoreSearch: true }).then(m => m || caches.match('/'))));
});
