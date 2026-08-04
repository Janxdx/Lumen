/* The offline shell, run against a stand-in for the service worker globals.
 *
 * public/sw.js is plain script, not a module, so it is read and evaluated
 * inside a function whose arguments are the globals it expects. That is
 * enough to drive install, activate and fetch and to assert on what came
 * back — which is the only way to catch the class of bug that produced
 * "Response served by service worker has redirections" in production: it is
 * invisible in a type checker and invisible in a build, and shows up as a
 * blank page on somebody's iPad.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';

let fails = 0;
const ok = (name: string, cond: boolean, detail = '') => {
  if (cond) console.log(`ok   ${name}`);
  else {
    fails++;
    console.log(`FAIL ${name}${detail ? `: ${detail}` : ''}`);
  }
};

/* ── the fakes ──────────────────────────────────────────────────── */

/** A Response as the platform hands it back after following a 301. */
class Redirected extends Response {
  get redirected() {
    return true;
  }
}

class FakeCache {
  store = new Map<string, Response>();
  async put(key: string | Request, res: Response) {
    this.store.set(typeof key === 'string' ? key : key.url, res);
  }
  async match(key: string | Request) {
    return this.store.get(typeof key === 'string' ? key : key.url);
  }
  async add() {
    throw new Error('cache.add() follows redirects — the worker must not use it');
  }
}

class FakeCaches {
  map = new Map<string, FakeCache>();
  async open(name: string) {
    let c = this.map.get(name);
    if (!c) this.map.set(name, (c = new FakeCache()));
    return c;
  }
  async keys() {
    return [...this.map.keys()];
  }
  async delete(name: string) {
    return this.map.delete(name);
  }
  async match(key: string | Request) {
    for (const c of this.map.values()) {
      const hit = await c.match(key);
      if (hit) return hit;
    }
    return undefined;
  }
}

interface Harness {
  caches: FakeCaches;
  skipWaited: boolean;
  run(event: 'install' | 'activate'): Promise<void>;
  navigate(url: string): Promise<Response>;
}

/** Evaluate public/sw.js against fresh fakes. `serve` answers its fetches. */
function load(serve: (url: string) => Response): Harness {
  const src = readFileSync(fileURLToPath(new URL('../public/sw.js', import.meta.url)), 'utf8')
    // stand in for what the vite plugin stamps at build time
    .replace("'__BUILD__'", JSON.stringify('testbuild'))
    .replace("['__ASSETS__']", JSON.stringify(['/assets/app-abc123.js']));

  const handlers: Record<string, ((e: never) => void)[]> = {};
  const cacheStore = new FakeCaches();
  const state = { skipWaited: false };

  const self = {
    location: { origin: 'https://readsoluna.com' },
    addEventListener(type: string, fn: (e: never) => void) {
      (handlers[type] ??= []).push(fn);
    },
    skipWaiting() {
      state.skipWaited = true;
      return Promise.resolve();
    },
    clients: { claim: () => Promise.resolve() },
  };

  const fetchImpl = (req: Request | string) =>
    Promise.resolve(serve(typeof req === 'string' ? req : req.url));

  /* In a worker a relative URL resolves against the scope, and `cache` is a
     valid init option. Node's Request has neither, so the shim supplies the
     origin and drops what undici will not take. */
  class ScopedRequest extends Request {
    constructor(input: RequestInfo, init?: RequestInit & { cache?: string }) {
      const url =
        typeof input === 'string' ? new URL(input, 'https://readsoluna.com').href : input;
      const { cache: _cache, ...rest } = init ?? {};
      super(url as RequestInfo, rest);
    }
  }

  // eslint-disable-next-line no-new-func
  new Function('self', 'caches', 'fetch', 'Request', 'Response', 'URL', src)(
    self,
    cacheStore,
    fetchImpl,
    ScopedRequest,
    Response,
    URL
  );

  const fire = async (type: 'install' | 'activate') => {
    const waits: Promise<unknown>[] = [];
    for (const fn of handlers[type] ?? []) {
      (fn as (e: unknown) => void)({ waitUntil: (p: Promise<unknown>) => waits.push(p) });
    }
    await Promise.all(waits);
  };

  return {
    caches: cacheStore,
    get skipWaited() {
      return state.skipWaited;
    },
    run: fire,
    async navigate(url: string) {
      let responded: Promise<Response> | undefined;
      const request = new Request(url);
      Object.defineProperty(request, 'mode', { value: 'navigate' });
      for (const fn of handlers['fetch'] ?? []) {
        (fn as (e: unknown) => void)({
          request,
          respondWith: (p: Promise<Response>) => (responded = p),
        });
      }
      if (!responded) throw new Error('the worker did not answer the navigation');
      return responded;
    },
  };
}

/* The server Soluna actually deploys onto: Cloudflare's asset router, which
   redirects /index.html to / and serves everything else straight. */
const cloudflare = (url: string) => {
  const path = new URL(url).pathname;
  if (path === '/index.html') return new Redirected('<!doctype html>shell', { status: 200 });
  return new Response(path === '/' ? '<!doctype html>shell' : `body of ${path}`, { status: 200 });
};

/* ── the shell is never taken from a redirecting URL ─────────────── */

{
  const h = load(cloudflare);
  await h.run('install');
  const cache = await h.caches.open('soluna-testbuild');

  ok('the shell document is precached', Boolean(await cache.match('/')));
  ok(
    '/index.html is not precached — it is the URL that redirects',
    !(await cache.match('/index.html'))
  );
  ok('the hashed bundle is precached', Boolean(await cache.match('/assets/app-abc123.js')));

  const doc = await cache.match('/');
  ok('what was stored is a plain response', doc?.redirected === false);
  ok('and it still has the body', (await doc!.text()) === '<!doctype html>shell');
}

/* ── a navigation may never be answered with a redirected response ── */

{
  const h = load(cloudflare);
  await h.run('install');
  await h.run('activate');

  const res = await h.navigate('https://readsoluna.com/');
  ok('a navigation is answered from the cache', res.status === 200);
  ok('and the response carries no redirect flag', res.redirected === false);

  // deep links are the same page — the reader is one document
  const deep = await h.navigate('https://readsoluna.com/#/account');
  ok('a deep link gets the same shell', (await deep.text()) === '<!doctype html>shell');
}

/* Even if the cache is empty and the answer has to come from the network —
   the path a brand-new install takes — the redirect flag must not leak. */
{
  const h = load(() => new Redirected('<!doctype html>shell', { status: 200 }));
  const res = await h.navigate('https://readsoluna.com/');
  ok('a network fallback is flattened too', res.redirected === false);
}

/* ── rescuing an install that cannot ask to be rescued ───────────── */

{
  const h = load(cloudflare);
  // a generation left behind by the build that shipped the bug
  const poisoned = await h.caches.open('soluna-broken');
  await poisoned.put('/index.html', new Redirected('<!doctype html>shell', { status: 200 }));

  await h.run('install');
  ok('a stranded generation makes the new worker take over unasked', h.skipWaited);

  await h.run('activate');
  ok('and activating clears the generation that stranded it', !h.caches.map.has('soluna-broken'));
}

{
  const h = load(cloudflare);
  const healthy = await h.caches.open('soluna-older');
  await healthy.put('/', new Response('<!doctype html>shell', { status: 200 }));

  await h.run('install');
  ok('an ordinary older generation is left to the reader to accept', !h.skipWaited);
}

{
  const h = load(cloudflare);
  await h.run('install');
  ok('and a first install waits like any other', !h.skipWaited);
}

/* ── the API is never cached ─────────────────────────────────────── */

{
  const h = load(cloudflare);
  await h.run('install');
  const cache = await h.caches.open('soluna-testbuild');
  ok('nothing under /api was precached', !(await cache.match('/api/pull')));
}

console.log(fails ? `\n${fails} failing` : '\nall passing');
process.exit(fails ? 1 : 0);
