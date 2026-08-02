/* Request and response plumbing.

   Small on purpose. The Worker has one job — answer a handful of JSON
   endpoints and otherwise hand the request to the static assets — so a
   routing dependency would be more code to audit than it saves. */

/** Anything thrown with this shape becomes its status; everything else 500s. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
  }
}

export const bad = (msg: string) => new HttpError(400, msg);
export const unauthorized = (msg = 'Sign in first.') => new HttpError(401, msg);
export const tooMany = (msg = 'Too many attempts. Try again shortly.') =>
  new HttpError(429, msg);

export function json(data: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      // API answers are per-user and per-moment; a shared cache holding one
      // would be handing someone else's library to the next request
      'cache-control': 'no-store',
      ...(init.headers ?? {}),
    },
  });
}

export async function readJson<T>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    throw bad('Expected a JSON body.');
  }
}

/* ── cookies ───────────────────────────────────────────────────────

   The session cookie is HttpOnly, so script cannot read it — including any
   script that finds its way onto the page through a book. EPUBs are
   untrusted input rendered in the app, which makes that more than a
   formality.

   SameSite=Lax rather than Strict: Strict would drop the cookie on the
   navigation *into* the app from a magic link in Mail, which is the one
   moment the flow depends on. Lax keeps top-level navigations and still
   refuses cross-site form posts, which is the attack it exists to stop. */

export const SESSION_COOKIE = 'soluna_session';

/* `Secure` is set for https and omitted for http.

   Not a weakening: a Secure cookie is simply never stored over plain http,
   so leaving it on unconditionally means `wrangler dev` on localhost can
   sign in and then immediately appear signed out — with nothing in any log
   to say why. Deployed traffic is https, so the flag is present everywhere
   it matters, and the only origin that loses it is the one on your own
   machine. */
const secure = (origin: string): string =>
  origin.startsWith('https:') ? '; Secure' : '';

export function setSessionCookie(
  token: string,
  maxAgeMs: number,
  origin: string
): string {
  return (
    `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax` +
    secure(origin) +
    `; Max-Age=${Math.floor(maxAgeMs / 1000)}`
  );
}

export const clearSessionCookie = (origin: string): string =>
  `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax${secure(origin)}; Max-Age=0`;

export function readCookie(req: Request, name: string): string | null {
  const header = req.headers.get('cookie');
  if (!header) return null;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return null;
}

/* ── cross-site request forgery ────────────────────────────────────

   With a cookie-authenticated API, a page on another origin can make the
   browser send an authenticated request. It cannot *read* the answer, but
   it can cause the write.

   The defence is that browsers now label every request with where it came
   from. `same-origin` and `none` (a direct navigation, or a fetch from the
   app itself) are ours; `cross-site` is not. The header is set by the
   browser and cannot be forged by script, which is what makes it worth
   trusting — and any client old enough to omit it entirely predates
   passkeys, so it could not have signed in anyway. */

export function requireSameOrigin(req: Request): void {
  const site = req.headers.get('sec-fetch-site');
  if (site && site !== 'same-origin' && site !== 'none') {
    throw new HttpError(403, 'Cross-site request refused.');
  }
}

/** Render a thrown error as a response, keeping internals out of the body. */
export function toResponse(e: unknown): Response {
  if (e instanceof HttpError) return json({ error: e.message }, { status: e.status });

  /* One 500 is worth naming rather than hiding: a database whose schema
     predates a feature. SQLite says "no such table: ratings", which means
     "schema.sql has gained a table since you last applied it" — and nothing
     else in the app is in a position to work that out. Left generic it
     surfaces as "Something went wrong." on the account screen the moment
     you sign in, with the real sentence only in the Worker's own log.

     Safe to disclose: a table name from our own schema tells an attacker
     nothing they could not read in the repository. */
  const message = e instanceof Error ? e.message : String(e);
  if (/no such (table|column)/i.test(message)) {
    console.error('schema out of date', e);
    return json(
      {
        error:
          `The database is missing part of its schema — ${message}. ` +
          'Apply worker/schema.sql: `npm run db:local`, or `npm run db:remote` for the deployed database.',
      },
      { status: 500 }
    );
  }

  console.error('unhandled', e);
  return json({ error: 'Something went wrong.' }, { status: 500 });
}
