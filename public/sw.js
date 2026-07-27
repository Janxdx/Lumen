/* Offline shell.

   Everything the app needs to boot is precached at install, so the first
   launch after a deploy is already offline-capable — the reader does not have
   to have fetched each chunk once before. Navigations are network-first (with
   a short timeout, so a flaky connection doesn't hang the splash) and fall
   back to the cached shell. Hashed build assets are immutable: cache-first.

   Books never touch this cache — they live in IndexedDB. */

const BUILD = '__BUILD__'; // replaced at build time
const ASSETS = ['__ASSETS__']; // replaced at build time

const CACHE = `lumen-${BUILD}`;
const NAV_TIMEOUT_MS = 2500;

const SHELL = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/icon-180.png',
  '/icon-192.png',
  '/icon-512.png',
  // the placeholder survives in dev, where the service worker is never registered
  ...ASSETS.filter((a) => !a.startsWith('__')),
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      // one missing file must not fail the whole install
      .then((c) => Promise.all(SHELL.map((url) => c.add(url).catch(() => undefined))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

/** network, but never hang: falls back once the timeout elapses */
function fromNetwork(request, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms);
    fetch(request).then(
      (response) => {
        clearTimeout(timer);
        resolve(response);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fromNetwork(request, NAV_TIMEOUT_MS)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE).then((c) => c.put('/index.html', copy));
          return response;
        })
        .catch(() =>
          caches
            .match('/index.html')
            .then((r) => r ?? caches.match('/'))
            .then((r) => r ?? Response.error())
        )
    );
    return;
  }

  event.respondWith(
    caches.match(request).then(
      (cached) =>
        cached ??
        fetch(request)
          .then((response) => {
            if (response.ok) {
              const copy = response.clone();
              caches.open(CACHE).then((c) => c.put(request, copy));
            }
            return response;
          })
          .catch(() => Response.error())
    )
  );
});
