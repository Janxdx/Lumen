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

/* The shell document is fetched from `/`, never from `/index.html`.

   Cloudflare's asset router runs `html_handling: auto-trailing-slash`, so
   `/index.html` answers 301 → `/`. `cache.add()` follows that and stores the
   final response with its `redirected` flag set, and a response carrying that
   flag may not be returned for a navigation — WebKit refuses the whole page
   with "Response served by service worker has redirections". `/` itself does
   not redirect, so it is the only URL the shell is ever read from. */
const SHELL_DOC = '/';

const SHELL = [
  SHELL_DOC,
  '/manifest.webmanifest',
  '/icon-180.png',
  '/icon-192.png',
  '/icon-512.png',
  // the placeholder survives in dev, where the service worker is never registered
  ...ASSETS.filter((a) => !a.startsWith('__')),
];

/* Rebuilding a response from its body clears the `redirected` flag — the flag
   is a property of the Response object, not of anything in the payload. Cheap
   insurance in case a future route learns to redirect. */
function flatten(res) {
  if (!res || !res.redirected) return res;
  return new Response(res.body, {
    status: res.status,
    statusText: res.statusText,
    headers: res.headers,
  });
}

/* `cache: 'reload'` matters more than it looks. Without it the precache is
   filled from the HTTP cache, which on a deploy can still be holding the
   previous shell — the new worker would then install the build it is
   replacing and the update would appear to do nothing. Hashed assets are
   immune, the document is not. */
async function precache(cache, url) {
  try {
    const res = await fetch(new Request(url, { cache: 'reload' }));
    if (res.ok) await cache.put(url, flatten(res));
  } catch {
    /* one missing file must not fail the whole install */
  }
}

/* Is some other generation holding a shell that can never answer a
   navigation? Then its page is showing WebKit's error and cannot tap
   anything — there is no running app to break and nobody who could ask, so
   this worker takes over uninvited. Reading the flag rather than a list of
   bad build ids means this cannot misfire on a healthy install, and needs no
   maintenance once the poisoned generations are gone. */
async function strandedGeneration() {
  for (const key of await caches.keys()) {
    if (key === CACHE) continue;
    const c = await caches.open(key);
    for (const url of ['/index.html', SHELL_DOC]) {
      const hit = await c.match(url);
      if (hit && hit.redirected) return true;
    }
  }
  return false;
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      await Promise.all(SHELL.map((url) => precache(cache, url)));
      if (await strandedGeneration()) await self.skipWaiting();
    })()
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
       shell and chunks together.

       Everything leaving here goes through flatten(): a navigation response
       that has been redirected is rejected by the browser outright, and the
       page that gets rejected is the whole app. */
    event.respondWith(
      caches
        .open(CACHE)
        .then((c) => c.match(SHELL_DOC))
        .then((cached) => cached ?? fetch(request))
        .then(flatten)
        .catch(() => Response.error())
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
