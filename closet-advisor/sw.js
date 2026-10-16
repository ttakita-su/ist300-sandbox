// App-shell service worker: same-origin files are served from cache and refreshed in the
// background (stale-while-revalidate), so the prototype opens offline after one visit.
// Cross-origin requests (the optional OCR engine) and the local server's api/ answers (live
// status, store lookups) are never cached or replayed here.
const CACHE = 'rotation-v2';
const API_PATH = new URL('./api/', self.location).pathname;
const SHELL = ['./', './index.html', './css/tokens.css', './css/base.css', './css/components.css', './css/screens/account.css', './css/screens/add.css', './css/screens/collection.css', './css/screens/discover.css', './css/screens/workspace.css', './js/app.js', './fonts/archivo-latin-wdth.woff2', './icons/icon.svg', './manifest.webmanifest'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith(API_PATH)) return;
  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(request, { ignoreSearch: request.mode === 'navigate' });
      const network = fetch(request)
        .then((response) => {
          if (response.ok) cache.put(request, response.clone());
          return response;
        })
        .catch(() => cached);
      return cached ?? network;
    }),
  );
});
