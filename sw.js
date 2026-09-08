/* Cat Ski service worker
 *
 * Strategy:
 * - On install: precache the app shell + icons.
 * - On fetch:
 *     - Navigation requests / HTML -> network-first, fall back to cache
 *       (so code changes propagate on the next online load without the
 *       user getting stuck on a stale index.html).
 *     - Static assets (scripts, images, manifest) -> cache-first, update in
 *       background after response is served.
 *     - Cross-origin requests (analytics) pass through directly.
 * - On activate: delete this app's older caches.
 *
 * When shipping a breaking change, bump CACHE_NAME (e.g. v2 -> v3) to
 * force all old caches to clear on next visit.
 */

const CACHE_NAME = 'cat-ski-v24';
const APP_SHELL = [
  '/',
  '/index.html',
  '/readme.html',
  '/storage.js?v=24',
  '/consent.js?v=24',
  '/manifest.json',
  '/preview.png?v=19',
  '/favicon.ico?v=19',
  '/favicon-16.png?v=19',
  '/favicon-32.png?v=19',
  '/favicon-48.png?v=19',
  '/apple-touch-icon.png?v=19',
  '/icon-192.png?v=19',
  '/icon-512.png?v=19',
  '/icon-maskable-512.png?v=19',
  '/fonts/press-start-2p.woff2',
  '/fonts/vt323.woff2',
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
        keys.filter(k => k.startsWith('cat-ski-') && k !== CACHE_NAME).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

async function healthyCached(request) {
  try {
    const cache = await caches.open(CACHE_NAME);
    const response = await cache.match(request);
    return response && response.ok ? response : null;
  } catch (_) { return null; }
}

async function cacheHealthy(request, response) {
  if (!response || !response.ok) return;
  try {
    const cache = await caches.open(CACHE_NAME);
    await cache.put(request, response.clone());
  } catch (_) { /* A full/blocked cache must not discard a healthy response. */ }
}

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Let cross-origin (analytics) pass through; the browser caches those
  // itself and we don't want to complicate the SW.
  if (url.origin !== self.location.origin) return;

  // HTML / navigation requests: network-first so deploys surface right
  // away when the user is online. Fall back to cached index when offline.
  const isNavigation = req.mode === 'navigate' ||
                       (req.headers.get('accept') || '').includes('text/html');

  if (isNavigation) {
    const navigation = (async () => {
      let response;
      try { response = await fetch(req); } catch (_) {}
      if (response && response.ok) {
        await cacheHealthy(req, response);
        return response;
      }
      // HTTP failures are recoverable too, and never replace a working shell.
      return await healthyCached(req) || await healthyCached('/') || response || Response.error();
    })();
    event.respondWith(navigation);
    event.waitUntil(navigation.then(() => {}, () => {}));
    return;
  }

  // Everything else (images, manifest, fonts that slip through): cache-
  // first with background refresh. Serving from cache makes the app feel
  // instant; the background fetch keeps the cache warm.
  const cached = healthyCached(req);
  const refresh = (async () => {
    try {
      const response = await fetch(req);
      await cacheHealthy(req, response);
      return response;
    } catch (_) { return null; }
  })();
  // Register the lifetime promise while handling the event, even when a
  // cached response is sent before the refresh and cache write finish.
  event.waitUntil(refresh.then(() => {}, () => {}));
  event.respondWith(cached.then(response => response || refresh.then(fresh => fresh || Response.error())));
});
