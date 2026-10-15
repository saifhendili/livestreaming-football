// Kickoff Live service worker.
//
// It makes the app installable and lets it open without a connection, nothing more:
//  - the app shell (index.html plus the built JS and CSS) is cached, so the app starts offline;
//  - live data is never cached: /api/*, other sites (the API host, streams, logos) and media
//    range requests all go straight to the network.
//
// The two placeholders below are filled in by the build (see vite.config.js).
const BUILD_ID = '__BUILD_ID__';
const PRECACHE = JSON.parse('__PRECACHE__');
const CACHE = `kickoff-${BUILD_ID}`;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      // "reload" skips the browser's HTTP cache, so the shell and its assets always match.
      .then((cache) => cache.addAll(PRECACHE.map((url) => new Request(url, { cache: 'reload' }))))
      .then(() => self.skipWaiting()),
  );
});

// A new deploy has a new build id, so the previous deploy's cache is dropped here.
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith('kickoff-') && key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || request.headers.has('range')) return;
  const url = new URL(request.url);
  // Not responding means the browser handles the request as if there were no service worker.
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;

  if (request.mode === 'navigate') event.respondWith(openApp(request));
  else if (PRECACHE.includes(url.pathname)) event.respondWith(fromCache(request));
});

// Every page of the app is the same shell, so a page load falls back to the cached "/".
async function openApp(request) {
  try {
    const response = await fetch(request);
    if (response.ok && response.headers.get('content-type')?.includes('text/html')) {
      const cache = await caches.open(CACHE);
      await cache.put('/', response.clone());
    }
    return response;
  } catch {
    return (await caches.match('/')) ?? Response.error();
  }
}

async function fromCache(request) {
  return (await caches.match(request)) ?? fetch(request);
}
