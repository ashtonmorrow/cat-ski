/* Cat Ski service worker
 *
 * Strategy:
 * - On install: precache the app shell + icons.
 * - On fetch:
 *     - Navigation requests / HTML -> network-first, fall back to cache
 *       (so code changes propagate on the next online load without the
 *       user getting stuck on a stale index.html).
 *     - Static assets (images, manifest) -> cache-first, update in
 *       background after response is served.
 *     - Cross-origin requests (e.g. Google Fonts) pass through directly.
 * - On activate: delete old caches with different names.
 *
 * When shipping a breaking change, bump CACHE_NAME (e.g. v2 -> v3) to
 * force all old caches to clear on next visit.
 */

const CACHE_NAME = 'cat-ski-v10';
const APP_SHELL = [
  '/',
  '/index.html',
  '/readme.html',
  '/manifest.json',
  '/preview.png',
  '/favicon.ico',
  '/favicon-16.png',
  '/favicon-32.png',
  '/favicon-48.png',
  '/apple-touch-icon.png',
  '/icon-192.png',
  '/icon-512.png',
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())  // activate immediately on next load
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Let cross-origin (Google Fonts, etc) pass through; the browser will
  // cache those itself and we don't want to complicate the SW.
  if (url.origin !== self.location.origin) return;

  // HTML / navigation requests: network-first so deploys surface right
  // away when the user is online. Fall back to cached index when offline.
  const isNavigation = req.mode === 'navigate' ||
                       (req.headers.get('accept') || '').includes('text/html');

  if (isNavigation) {
    event.respondWith(
      fetch(req)
        .then(response => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(req, copy));
          return response;
        })
        .catch(() => caches.match(req).then(r => r || caches.match('/')))
    );
    return;
  }

  // Everything else (images, manifest, fonts that slip through): cache-
  // first with background refresh. Serving from cache makes the app feel
  // instant; the background fetch keeps the cache warm.
  event.respondWith(
    caches.match(req).then(cached => {
      const networkFetch = fetch(req).then(response => {
        if (response && response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(req, copy));
        }
        return response;
      }).catch(() => cached);  // offline + nothing cached = reject
      return cached || networkFetch;
    })
  );
});
