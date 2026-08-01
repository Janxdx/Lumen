/* The Lumen Worker.

   One entry point, three kinds of request:

     /auth/…   sign in, sign out, passkeys
     /api/…    sync and files, all requiring a session
     anything  the built front-end, served from the ASSETS binding

   The last of those is why the API lives on the same origin as the app.
   Same origin means the session cookie is simply present on every fetch —
   no bearer tokens in JavaScript, no CORS preflights, and no token sitting
   in localStorage where a script injected by a malformed EPUB could read
   it. The cookie is HttpOnly and unreachable to script by construction. */

import {
  completeLogin,
  currentUser,
  destroySession,
  listPasskeys,
  passkeyLoginOptions,
  passkeyLoginVerify,
  passkeyRegisterOptions,
  passkeyRegisterVerify,
  removePasskey,
  requestLogin,
  requireUser,
} from './auth';
import { pull, push, type Changes } from './data';
import { SESSION_TTL, type Env } from './env';
import {
  HttpError,
  bad,
  clearSessionCookie,
  json,
  readJson,
  requireSameOrigin,
  setSessionCookie,
  toResponse,
} from './http';

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname;

    if (!path.startsWith('/api/') && !path.startsWith('/auth/')) {
      return env.ASSETS.fetch(req);
    }

    try {
      /* Every state-changing call is same-origin only. GETs are exempt
         because they change nothing, and the magic-link callback is a
         top-level navigation from an email client — which reports
         `cross-site` and would be refused. */
      if (req.method !== 'GET') requireSameOrigin(req);

      return await route(req, env, url, path);
    } catch (e) {
      return toResponse(e);
    }
  },
} satisfies ExportedHandler<Env>;

async function route(req: Request, env: Env, url: URL, path: string): Promise<Response> {
  const post = (p: string) => req.method === 'POST' && path === p;
  const get = (p: string) => req.method === 'GET' && path === p;

  /* ── who am I ────────────────────────────────────────────────────
     The client calls this on boot. Answering "nobody" is a normal answer,
     not an error — the reader works signed out. */
  if (get('/auth/me')) {
    const user = await currentUser(env, req);
    return json({ user: user ? { id: user.id, email: user.email } : null });
  }

  /* ── magic link ──────────────────────────────────────────────── */

  if (post('/auth/request')) {
    const { email } = await readJson<{ email?: string }>(req);
    if (!email) throw bad('An email address is required.');
    await requestLogin(env, req, email);
    /* Always the same answer, whether or not the address has an account.
       Differing would turn this endpoint into a way to ask "is this person
       a user here", which is not ours to disclose. */
    return json({ sent: true });
  }

  /* Arrives as a click in a mail client, so it must be a GET that renders
     something — hence a redirect into the app rather than a JSON body. */
  if (get('/auth/callback')) {
    const token = url.searchParams.get('token');
    if (!token) return Response.redirect(`${env.APP_ORIGIN}/#/account?error=link`, 302);

    try {
      const { sessionToken } = await completeLogin(env, req, token);
      return new Response(null, {
        status: 302,
        headers: {
          location: `${env.APP_ORIGIN}/#/account?welcome=1`,
          'set-cookie': setSessionCookie(sessionToken, SESSION_TTL, env.APP_ORIGIN),
        },
      });
    } catch (e) {
      /* "Expired" and "already used" are different situations and lead to
         different next steps — one means ask again, the other means you may
         already be signed in on another tab. Collapsing them into one word
         would be the kind of small lie that wastes somebody's afternoon. */
      const message = e instanceof HttpError ? e.message : '';
      const reason = /already been used/i.test(message)
        ? 'used'
        : /expired/i.test(message)
          ? 'expired'
          : 'failed';
      return Response.redirect(`${env.APP_ORIGIN}/#/account?error=${reason}`, 302);
    }
  }

  if (post('/auth/signout')) {
    await destroySession(env, req);
    return json(
      { ok: true },
      { headers: { 'set-cookie': clearSessionCookie(env.APP_ORIGIN) } }
    );
  }

  /* ── passkeys ────────────────────────────────────────────────── */

  if (post('/auth/passkey/register/options')) {
    const user = await requireUser(env, req);
    return json(await passkeyRegisterOptions(env, user));
  }

  if (post('/auth/passkey/register/verify')) {
    const user = await requireUser(env, req);
    const body = await readJson<{ response?: unknown; label?: string }>(req);
    if (!body.response) throw bad('Missing passkey response.');
    await passkeyRegisterVerify(env, user, body.response as never, body.label ?? null);
    return json({ ok: true, passkeys: await listPasskeys(env, user) });
  }

  if (post('/auth/passkey/login/options')) {
    return json(await passkeyLoginOptions(env));
  }

  if (post('/auth/passkey/login/verify')) {
    const body = await readJson<{ response?: unknown }>(req);
    if (!body.response) throw bad('Missing passkey response.');
    const { user, sessionToken } = await passkeyLoginVerify(env, req, body.response as never);
    return json(
      { user: { id: user.id, email: user.email } },
      {
        headers: {
          'set-cookie': setSessionCookie(sessionToken, SESSION_TTL, env.APP_ORIGIN),
        },
      }
    );
  }

  if (get('/auth/passkeys')) {
    const user = await requireUser(env, req);
    return json({ passkeys: await listPasskeys(env, user) });
  }

  if (req.method === 'DELETE' && path.startsWith('/auth/passkeys/')) {
    requireSameOrigin(req);
    const user = await requireUser(env, req);
    await removePasskey(env, user, decodeURIComponent(path.slice('/auth/passkeys/'.length)));
    return json({ ok: true, passkeys: await listPasskeys(env, user) });
  }

  /* ── sync ────────────────────────────────────────────────────── */

  if (get('/api/pull')) {
    const user = await requireUser(env, req);
    const cursor = Number(url.searchParams.get('cursor') ?? 0);
    return json(await pull(env, user, Number.isFinite(cursor) ? cursor : 0));
  }

  if (post('/api/push')) {
    const user = await requireUser(env, req);
    const changes = await readJson<Partial<Changes>>(req);
    return json({ cursor: await push(env, user, changes) });
  }

  /* ── files ───────────────────────────────────────────────────── */

  /* Paths are built here from the session's user id and never taken from
     the request, so `../` in a book id cannot walk out of the folder — the
     id only ever appears as one component of a name we construct. */
  const fileMatch = /^\/api\/files\/(epub|cover)\/(.+)$/.exec(path);
  if (fileMatch) {
    const user = await requireUser(env, req);
    const [, kind, rawId] = fileMatch;
    const bookId = decodeURIComponent(rawId);
    if (bookId.includes('/') || bookId.includes('..')) throw bad('Bad book id.');
    const key = `${user.id}/${bookId}.${kind === 'epub' ? 'epub' : 'cover'}`;

    if (req.method === 'PUT') {
      if (!req.body) throw bad('Empty upload.');
      await env.BOOKS.put(key, req.body, {
        httpMetadata: {
          contentType:
            req.headers.get('content-type') ??
            (kind === 'epub' ? 'application/epub+zip' : 'application/octet-stream'),
        },
      });
      return json({ path: key });
    }

    if (req.method === 'GET') {
      const object = await env.BOOKS.get(key);
      if (!object) throw new HttpError(404, 'Not stored.');
      const headers = new Headers();
      object.writeHttpMetadata(headers);
      headers.set('etag', object.httpEtag);
      // the object never changes for a given id, but it is private data,
      // so it may only be held by the browser and never by a shared cache
      headers.set('cache-control', 'private, max-age=31536000, immutable');
      return new Response(object.body, { headers });
    }

    if (req.method === 'DELETE') {
      await env.BOOKS.delete(key);
      return json({ ok: true });
    }
  }

  throw new HttpError(404, 'No such endpoint.');
}
