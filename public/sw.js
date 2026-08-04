/* Offline shell.

   Everything the app needs to boot is precached at install, so the first
   launch after a deploy is already offline-capable — the reader does not have
   to have fetched each chunk once before. Books never touch this cache; they
   live in IndexedDB.

   One cache per build, and a generation is only ever read as a whole. The
   `index.html` in `soluna-<BUILD>` names exactly the hashed bundles that were
   precached beside it, so serving a page out of it can never produce a shell
   asking for a chunk that generation does not have. That is why navigations
   read the cache rather than the network: the network's `index.html` belongs
   to a *newer* generation and names assets this one never fetched, so caching
   it here would leave a shell whose scripts only resolve while online — an
   offline app that quietly stops being one.

   Nothing here calls skipWaiting() on its own. A new worker installs, fills
   its cache and then waits, because taking over early is what actually breaks
   the app: the page that is open is running the *old* bundle, and the old
   bundle still resolves chunks by their old hashed names — `tesseract.js` on
   the first scan, for one. Activate deletes the old generation, and the
   filenames are gone from the server too. So the swap happens on our own
   terms: the page notices the waiting worker, offers it, and only a tap sends
   SKIP_WAITING. See src/pwa/update.ts. */

const BUILD = '__BUILD__'; // replaced at build time
const ASSETS = ['__ASSETS__']; // replaced at build time

const CACHE = `soluna-${BUILD}`;

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
      /* `cache: 'reload'` matters more than it looks. Without it the precache
         is filled from the HTTP cache, which on a deploy can still be holding
         the previous `index.html` — the new worker would then install a shell
         from the build it is replacing and the update would appear to do
         nothing. Hashed assets are immune, `index.html` is not. */
      .then((c) =>
        Promise.all(
          SHELL.map((url) =>
            // one missing file must not fail the whole install
            c.add(new Request(url, { cache: 'reload' })).catch(() => undefined)
          )
        )
      )
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

/* The page asking to be upgraded now. This is the only path to skipWaiting(),
   and it is reached only after somebody tapped. */
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') void self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  /* The API is never cached, and this exclusion has to live here.
     `/auth/me` answers "who is signed in", and the handler below stores any
     response that is `ok` — so the "nobody" served before sign-in would be
     replayed from the cache afterwards, leaving the app permanently signed
     out with the cookie sitting there unused. The `no-store` the Worker
     sends does not prevent it: the Cache API is not the HTTP cache and does
     not read Cache-Control at all.

     `/auth/` is excluded before the navigation branch too, so the magic-link
     callback is a plain browser navigation and its Set-Cookie is handled
     the ordinary way. */
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/auth/')) return;

  /* The worker script itself is never served from here. The browser's own
     update check fetches it, and answering that from a cache is answering
     "is there a new version?" with the old version — the app would never
     update again. */
  if (url.pathname === '/sw.js') return;

  if (request.mode === 'navigate') {
    /* Cache-first, and the boot is therefore instant and identical online and
       off. Freshness is not this handler's job — a newer build is picked up by
       the update check in the page, which is the only thing that can swap
       shell and chunks together. */
    event.respondWith(
      caches
        .match('/index.html', { cacheName: CACHE })
        .then((cached) => cached ?? fetch(request))
        .catch(() => caches.match('/').then((r) => r ?? Response.error()))
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
