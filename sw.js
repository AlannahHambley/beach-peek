// Beach Peek service worker — makes it installable + work offline.
// Shell: cache-first. Conditions (out/*.json): network-first, fall back to last saved.
const V = 'beachpeek-v1';
const SHELL = ['./', 'index.html', 'manifest.webmanifest'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(V).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()).catch(() => {}));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== V).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (u.origin !== location.origin) return; // let fonts etc. pass through
  if (u.pathname.includes('/out/')) {
    // conditions: try network, cache the fresh copy, fall back to last saved
    e.respondWith(
      fetch(e.request).then(r => { const c = r.clone(); caches.open(V).then(ca => ca.put(e.request, c)); return r; })
        .catch(() => caches.match(e.request))
    );
  } else {
    // app shell: serve from cache, update in background
    e.respondWith(
      caches.match(e.request).then(r => r || fetch(e.request).then(res => {
        const c = res.clone(); caches.open(V).then(ca => ca.put(e.request, c)); return res;
      }))
    );
  }
});
