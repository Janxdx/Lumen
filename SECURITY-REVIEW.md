# Soluna — data access & attack surface review

**Date:** 2026-08-02 · **Branch:** `develop` @ `286f00a` · **Scope:** every path that reads or writes
persisted data — Cloudflare D1, R2, Supabase Postgres + Storage, and the on-device Dexie/IndexedDB
database — plus the code paths that decide *who* is allowed to do so.

---

## 1. Summary

The server-side tenant isolation is **solid**. I checked all 16 D1 statements in `worker/data.ts`
and every statement in `worker/auth.ts`: each one filters by a `user_id` (or a token hash) that
comes from the session, never from the request body, and every value is bound rather than
interpolated. There is no SQL injection here and no way to read another account's rows through the
API. The Supabase path is protected a second time by row-level security. The account model
(no passwords, hashed tokens, single-use magic links, WebAuthn challenges kept server-side) is
carefully built and the comments show the reasoning was deliberate.

**The real exposure is not the database — it is the EPUB parser.** An imported EPUB can get
JavaScript running on the app's own origin. Once that happens every server-side control listed
above is bypassed, not broken: the attacker's script simply calls `/api/pull` with the browser
attaching the HttpOnly cookie for it. The cookie being unreadable buys nothing when the script is
already same-origin.

| # | Severity | Finding |
|---|----------|---------|
| 1 | **Critical** | Sanitizer allowlist bypass — a malicious EPUB executes script on the app origin |
| 2 | **High** | `javascript:` and `data:` URLs survive into `<a href>` |
| 3 | **High** | Supabase backend keeps the session JWT in `localStorage` — XSS becomes portable account takeover |
| 4 | **High** | No Content-Security-Policy anywhere |
| 5 | Medium | R2 downloads echo a client-supplied `Content-Type` on the app origin, no `nosniff` |
| 6 | Medium | Unauthenticated, unlimited DB writes via `/auth/passkey/login/options` |
| 7 | Medium | No size or row-count cap on `/api/push` or on file uploads |
| 8 | Medium | Login CSRF via `/auth/callback` |
| 9 | Medium | 180-day sessions, no rotation, no revocation UI |
| 10 | Low | CSRF defence is one fail-open signal |
| 11 | Low | Server never deletes R2 objects — `forgetBookFiles` is dead code |
| 12 | Low | Session cookie lacks the `__Host-` prefix |
| 13 | Low | The one un-parameterised SQL fragment |

`npm audit` is clean (0 vulnerabilities across all severities). No secrets appear anywhere in the
33 commits of git history — the only hits for `service_role` are the README and `.env.example`
warning *not* to use it. `.gitignore` correctly covers `.env`, `.env.*`, and `.wrangler/`.

---

## 2. Map of every data access point

### 2.1 Cloudflare D1 (`env.DB`) — the only SQL in the app

Reached exclusively from the Worker. There is no direct client access, no connection string in the
browser, no ORM.

| File:line | Statement | Auth gate | Scoped by |
|---|---|---|---|
| `data.ts:50` | `update users set seq = seq + 1 … returning seq` | `requireUser` | `id = session user` |
| `data.ts:66` | `select * from <8 tables> where user_id = ? and row_seq > ?` (batched) | `requireUser` | session user |
| `data.ts:158` | upsert `books` | `requireUser` | `uid` bound from session |
| `data.ts:196` | upsert `progress` | `requireUser` | session |
| `data.ts:222` | upsert `read_sessions` | `requireUser` | session |
| `data.ts:243` | upsert `bookmarks` | `requireUser` | session |
| `data.ts:264` | upsert `device_books` | `requireUser` | session |
| `data.ts:293` | upsert `device_sessions` | `requireUser` | session |
| `data.ts:322` | upsert `ratings` | `requireUser` | session |
| `data.ts:352` | upsert `settings` | `requireUser` | session |
| `auth.ts:56` | 3× `delete … where expires_at < ?` (sweep) | **none** | — (housekeeping) |
| `auth.ts:76` | `select … from rate_limits where key = ?` | **none** | key |
| `auth.ts:81/93` | insert/update `rate_limits` | **none** | key |
| `auth.ts:110` | insert `auth_sessions` | post-verification | — |
| `auth.ts:124` | `select … auth_sessions join users where token_hash = ?` | cookie | token hash |
| `auth.ts:137/151` | `delete from auth_sessions where token_hash = ?` | cookie | token hash |
| `auth.ts:180` | insert `login_tokens` | **none** (rate-limited) | — |
| `auth.ts:203` | `delete from login_tokens where token_hash = ? returning …` | token | token hash |
| `auth.ts:221/228` | `select` / `insert` `users` | valid token | `email_key` |
| `auth.ts:253` | insert `challenges` | **none** on the login path | — |
| `auth.ts:267` | `delete from challenges where challenge = ? and purpose = ?` | — | challenge |
| `auth.ts:281` | `select id, transports from credentials where user_id = ?` | `requireUser` | session |
| `auth.ts:331` | upsert `credentials` | `requireUser` + challenge ownership | session |
| `auth.ts:380` | `select … credentials join users where c.id = ?` | signed assertion | credential id |
| `auth.ts:415` | `update credentials set counter …` | verified assertion | credential id |
| `auth.ts:424` | `select … credentials where user_id = ?` | `requireUser` | session |
| `auth.ts:436` | `delete from credentials where id = ? and user_id = ?` | `requireUser` | **both** — correct |

**Verified:** every value is passed through `.bind()`. The only string interpolation into SQL text
is the table name at `data.ts:66`, and it is drawn from a hardcoded list of eight literals — see
finding 13.

**Verified:** the `where excluded.updated_at >= <table>.updated_at` guard on each upsert means a
stale device cannot overwrite newer data merely by pushing last. `read_sessions` deliberately omits
it because history is append-only.

### 2.2 R2 (`env.BOOKS`) — EPUB files and covers

`worker/index.ts:180–215`. One route, `/api/files/(epub|cover)/:id`, PUT/GET/DELETE, all behind
`requireUser`. The object key is built as `` `${user.id}/${bookId}.${kind}` `` — the user id comes
from the session and the `kind` is pinned to one of two literals, so a caller cannot address
another user's namespace. `bookId` is decoded and then rejected if it contains `/` or `..`. That
check is correct in this order (decode-then-validate, not the reverse). See findings 5, 7, 11.

### 2.3 Supabase (alternative backend)

`src/sync/adapters/supabase.ts` talks to Postgres directly from the browser with the anon key.
Safety rests entirely on `supabase/schema.sql`, which is well done: RLS is enabled on all eight
tables, each policy requires `user_id = auth.uid() **and** public.email_verified()`, and the
`email_verified()` helper is `security definer` with a pinned `search_path` and a body narrow
enough that it cannot leak anything but a boolean. Storage is a private bucket with per-user
folder policies keyed on `(storage.foldername(name))[1] = auth.uid()::text` and a 200 MB file cap.
The `.env.example` warning against the `service_role` key is correct and important. See finding 3.

### 2.4 On-device (Dexie / IndexedDB, `src/db/index.ts`)

Dexie v5, tables: books, files, covers, progress, bookmarks, sessions, deviceBooks,
deviceSessions, ratings, settings, passages. **This is the largest concentration of personal data
in the system** — full book files, every reading session, bookmarks with excerpts, ratings and
private notes — and it is protected only by browser origin policy. Anything running on the origin
can read all of it. That is the reason finding 1 is rated Critical rather than High.

---

## 3. What is already right

Worth stating plainly, because it is unusual to see this much of it done correctly:

- **No token in JavaScript on the Worker backend.** Same-origin API + HttpOnly cookie, by design.
- **Tokens are stored hashed.** `auth_sessions`, `login_tokens` hold SHA-256 only; a leaked
  database backup yields no working sessions. Plain SHA-256 is the right call for 256-bit CSPRNG
  values, and `crypto.ts` explains why it would be wrong for a password.
- **Magic links are genuinely single-use** — `delete … returning` in one statement closes the race
  a read-then-delete would leave open for mail scanners that pre-fetch URLs.
- **WebAuthn is implemented correctly.** Challenges are server-generated, stored server-side,
  single-use, TTL-bounded; the challenge is read out of `clientDataJSON` rather than trusted from a
  sibling field; registration checks that the challenge belongs to the presenting session
  (`auth.ts:311`); `removePasskey` scopes by `user_id` as well as `id`.
- **No user enumeration** on `/auth/request` — the response is identical either way.
- **Rate limiting on the email path**, both per-address and per-IP, using `cf-connecting-ip`
  (trustworthy behind Cloudflare).
- **`cache-control: no-store`** on every JSON response, and `private` on R2 objects.
- **The service worker explicitly refuses to cache `/api/` and `/auth/`** — and the comment
  correctly notes the Cache API ignores `Cache-Control`, which is the mistake that would otherwise
  have been made.
- **Error messages don't leak internals** — `toResponse` collapses everything except a deliberately
  named schema error whose disclosure is genuinely harmless.

---

## 4. Findings

### 1. Critical — sanitizer allowlist bypass: a malicious EPUB runs script on the app origin

**Where:** `src/engine/sanitize.ts:75–78`, consumed at `src/ui/Reader.tsx:236` (`el.innerHTML = chapter.html`).

`sanitizeChapter` walks the parsed chapter and, for any tag not on the 40-entry allowlist, unwraps
it:

```ts
if (!ALLOWED.has(tag)) {
  child.replaceWith(...Array.from(child.childNodes));   // keep the text, drop the wrapper
  continue;                                             // ← never recurses into what was promoted
}
```

The loop iterates a snapshot (`Array.from(node.children)`) taken *before* the promotion, so the
promoted descendants are never visited — they land in the output with **every attribute intact**.

I ran the sanitizer's logic against a set of probes to confirm rather than infer. Results:

```
A) handler under unknown wrapper   <foo><img src=x onerror="steal()"></foo>
   =>  <img src="x" onerror="steal()">                    ← handler survives
E) nested under custom element     <custom-el><p onclick="steal()">x</p></custom-el>
   =>  <p onclick="steal()">x</p>                          ← handler survives
H) unknown > unknown > img         <a-b><c-d><img src=x onerror="steal()"></c-d></a-b>
   =>  <c-d><img src="x" onerror="steal()"></c-d>          ← handler survives
G) allowed element (control)       <p onclick="steal()" style="x">ok</p>
   =>  <p>ok</p>                                           ← stripped correctly
```

`<img src=x onerror=…>` fires the moment `innerHTML` inserts it and the load fails. No user
interaction needed. `<script>` blocks also survive the unwrap, but those are inert via `innerHTML`
per spec — the event handlers are the live vector.

This is not an exotic trigger. The allowlist omits tags that appear in ordinary EPUB3 files —
`nav`, `main`, `footer`, `abbr`, `time`, `ruby`, `bdi`, `caption`, `col`, `tfoot`, `template`, and
the `epub:` namespaced elements — so any of them works as the wrapper.

**Impact.** Script on the app origin can:

- `fetch('/api/pull?cursor=0', {credentials:'same-origin'})` — the whole account: every book row,
  bookmark, note, rating, and reading session. The HttpOnly cookie is attached by the browser
  automatically; it prevents the script *reading* the cookie, which is irrelevant here.
- `GET /api/files/epub/<id>` for every book and exfiltrate the files.
- `POST /api/push` with `deleted: 1` on every row — destructive, and it propagates to every device.
- Read the entire IndexedDB directly (§2.4).
- On the Supabase backend, read the JWT out of `localStorage` — see finding 3.

The threat model here is not hypothetical: importing EPUBs from arbitrary sources is the app's
primary function.

**Fix — do all three:**

1. Recurse into promoted children. Minimal change: replace the unwrap branch with one that visits
   the promoted nodes, e.g. move the children into a fragment, run `clean` over it, then splice it
   in. Alternatively, strip attributes on *every* element before the allowlist decision.
2. Belt and braces — after `clean(body)`, sweep the whole tree once more and remove any attribute
   not in `{src, alt, href, target, rel, colspan}`:
   ```ts
   for (const el of body.querySelectorAll('*'))
     for (const a of [...el.attributes])
       if (!KEEP.has(a.name.toLowerCase())) el.removeAttribute(a.name);
   ```
   A single final pass like this is what makes the sanitizer robust against the *next* structural
   bug, not just this one.
3. Add a unit test file (`tests/sanitize.test.mts`) with the probes above as regression cases. The
   test harness is already in place.

Consider also rendering chapters inside a `<iframe sandbox="allow-same-origin">`-less frame, which
would contain any future bypass. That is a larger change and points 1–3 close the hole.

### 2. High — `javascript:` and `data:` URLs survive into `<a href>`

**Where:** `src/engine/sanitize.ts:88–92`.

```ts
if (/^[a-z]+:/i.test(href) && !href.startsWith('file:')) {
  child.setAttribute('href', href);
  child.setAttribute('target', '_blank');
```

The regex is a *scheme detector*, not an allowlist — it matches `javascript:`, `data:`, `vbscript:`
and `blob:` just as happily as `https:`. Confirmed:

```
C) <a href="javascript:steal()">tap me</a>
   =>  <a href="javascript:steal()" target="_blank" rel="noreferrer noopener">tap me</a>
D) <a href="data:text/html,…">tap</a>
   =>  <a href="data:text/html,…" target="_blank" rel="noreferrer noopener">tap</a>
```

`target="_blank"` does not neutralise `javascript:` — the URL still evaluates in the current
document's context. Requires one tap on a link in the book, which is exactly what a footnote or a
"read more" looks like.

**Fix:** invert to an allowlist.

```ts
const SAFE = /^https?:\/\//i;
if (SAFE.test(href)) { … }   // otherwise leave the anchor inert
```
Parse with `new URL(href, base)` and check `protocol` if you want to be stricter about tricks like
`java\tscript:` (the HTML parser strips control characters inside attribute values, so a raw regex
on the attribute string can be fooled).

### 3. High — the Supabase session JWT sits in `localStorage`

**Where:** `src/sync/adapters/supabase.ts:47–52` — `persistSession: true, storageKey: 'soluna.auth'`.

On this backend the access token is readable by any script on the origin. Combined with finding 1,
an XSS is no longer confined to the device: the attacker walks away with a bearer token they can
use against the Supabase REST API from anywhere until it expires, and a refresh token that renews
it. On the Worker backend the equivalent attack is limited to the compromised browser session,
because the cookie can't leave it.

**Fix:** primarily, fix findings 1 and 2. Beyond that — if the Worker is the intended production
backend (`wrangler.jsonc` and `CLAUDE.md` suggest it is), consider whether the Supabase adapter
still needs to ship in the client bundle at all. Keeping it as a port is a good decision
architecturally; shipping it enabled by default when unconfigured is a different question. Note
that `src/sync/client.ts:29` prefers Supabase whenever its env vars are present, even with no
explicit `VITE_BACKEND`.

### 4. High — no Content-Security-Policy

**Where:** absent from `index.html`, `public/_headers`, and `worker/http.ts`.

`public/_headers` sets `X-Content-Type-Options: nosniff` and `Referrer-Policy: same-origin`, which
is a good start, but there is no CSP. A CSP would have downgraded finding 1 from "full account
compromise" to "inert markup in the page" — inline event handlers are precisely what
`script-src 'self'` blocks.

Two gaps to be aware of:

- `_headers` applies to **static asset responses**. Responses the Worker constructs itself — every
  JSON body from `http.ts:json()` and every R2 file body in `index.ts` — carry only the headers set
  in that code, so they get neither `nosniff` nor anything else from `_headers`.
- Vite's dev server does not apply `_headers` at all.

**Fix:** set a CSP. A starting point that fits this app:

```
default-src 'self';
script-src 'self';
style-src 'self' 'unsafe-inline';
img-src 'self' data: blob:;
font-src 'self';
connect-src 'self' https://cdn.jsdelivr.net;
frame-ancestors 'none';
base-uri 'none';
form-action 'none';
object-src 'none';
```

`connect-src` needs jsdelivr because `src/ocr/recognize.ts` fetches the tesseract WASM core and
`eng.traineddata` from it at runtime. If you later vendor those into `public/`, drop it.
`img-src blob:` is required by `sanitize.ts`'s object URLs and the cover pipeline.

Apply it in `_headers` **and** add the same headers to `json()` and the R2 GET response in
`index.ts`, so both halves of the origin are covered. Add `frame-ancestors 'none'` (or
`X-Frame-Options: DENY`) while you are there — nothing in the app should be framable.

### 5. Medium — R2 downloads echo a client-supplied Content-Type on the app origin

**Where:** `worker/index.ts:190–195` (PUT) and `:203–210` (GET).

The upload stores whatever `content-type` the request carried:

```ts
contentType: req.headers.get('content-type') ?? (kind === 'epub' ? 'application/epub+zip' : …)
```

and the download replays it via `object.writeHttpMetadata(headers)` with no `nosniff` and no
`Content-Disposition`. A file stored as `text/html` is therefore served as a document **on the app's
own origin** at `/api/files/epub/<id>`.

Only the account owner can write and read its own namespace, so this is not cross-tenant on its
own. It matters as an escalation surface: it turns "can upload a file" into "has a same-origin HTML
page", which is a useful primitive to chain, and it is trivially cheap to close.

**Fix:**
```ts
// PUT — ignore the client's claim, derive from the route
contentType: kind === 'epub' ? 'application/epub+zip' : 'application/octet-stream',
// GET
headers.set('x-content-type-options', 'nosniff');
headers.set('content-disposition', 'attachment');
```
The client only ever consumes these as blobs (`adapters/soluna.ts:130`, `:139`), so neither change
affects behaviour.

### 6. Medium — unauthenticated, unrate-limited database writes

**Where:** `worker/index.ts:139` → `auth.ts:249` (`passkeyLoginOptions` → `issueChallenge`).

`POST /auth/passkey/login/options` requires no session — correctly, since you cannot know who is
signing in yet — and inserts a row into `challenges` on every call. There is no rate limit on it,
and `sweep()` only runs from `requestLogin`, so nothing prunes the table unless somebody happens to
request a magic link. Anyone can grow the `challenges` table without bound. On D1 that is a billing
and performance problem rather than a data-disclosure one, but it is a free lever for a stranger.

`sweep()` at `auth.ts:169` also runs its three deletes *before* the rate-limit check in
`requestLogin`, so each unauthenticated request costs three writes before the ceiling applies.

**Fix:** rate-limit `/auth/passkey/login/options` per IP (the `limit()` helper already exists — e.g.
`limit(env, 'pk:ip:' + clientIp(req), 30, 60_000)`), call `sweep()` from that path too, and move
`sweep()` in `requestLogin` to *after* the two `limit()` calls. A scheduled `cron` trigger doing the
sweep would be tidier still; the current comment argues against depending on one, which is fair, but
both can coexist.

### 7. Medium — no cap on push size or upload size

**Where:** `worker/index.ts:167–171` (`/api/push`) and `:188–196` (file PUT).

`push()` builds one `D1PreparedStatement` per row in the request and batches the lot. Nothing
bounds the number of rows, and nothing bounds the length of a string field — `str()` coerces the
type but does not truncate. A signed-in account can push arbitrarily large payloads and store
arbitrarily long titles, notes, and bookmark excerpts.

File uploads are worse: the Supabase bucket enforces 200 MB per object; the R2 path enforces
nothing. `req.body` is streamed straight into R2.

Authenticated-only, so the blast radius is one account abusing your Cloudflare bill rather than a
stranger doing it — but accounts are free to create, so "authenticated" is a low bar here.

**Fix:** reject a push whose arrays exceed a sane count (say 2,000 rows total) with a 413; truncate
free-text columns in `str()` (`note`, `excerpt`, `title`, `author`); check `content-length` against
a limit before the R2 `put` and reject beyond ~200 MB to match the Supabase policy.

Also, a robustness nit in the same file: `data.ts:212` and `:337` use bare `Number(…)` for `percent`
and `overall` rather than the `num()` helper used everywhere else, so a non-numeric string yields
`NaN` and D1 will reject the bind — a client-triggerable 500. Use `num()` for consistency.

### 8. Medium — login CSRF via `/auth/callback`

**Where:** `worker/index.ts:52` exempts GET from `requireSameOrigin`, and `/auth/callback`
(`:88–116`) is a GET that spends a token and sets a session cookie.

The exemption is documented and reasonable — a magic link opened from Mail reports `cross-site` and
would otherwise be refused. The consequence is that an attacker can request a link to *their own*
address and then get a victim to open that URL. The victim's browser silently swaps to the
attacker's session; books imported afterwards sync into the attacker's account.

Low-likelihood (needs the victim to open a link and not notice the account screen changed), but the
standard mitigation is cheap.

**Fix:** make the callback an interstitial rather than an automatic swap — redirect to
`/#/account?confirm=<token>` and have the app POST the token to a same-origin endpoint after the
user confirms. Failing that, at minimum refuse to swap when a valid session for a *different* user
is already present, and surface which address was just signed in on the welcome screen.

### 9. Medium — 180-day sessions, no rotation, no revocation

**Where:** `worker/env.ts:47` (`SESSION_TTL = 180 days`), `auth.ts:104–117`, `src/ui/Account.tsx`.

The long TTL is a defensible product decision for a reading app on a personal iPad, and the
reasoning in the comment is sound. Two things do not follow from it, though:

- `auth_sessions.user_agent` is collected, and `schema.sql` says it is "shown on the account screen
  so a stolen session is something you can notice and revoke". **It is not** — `Account.tsx` renders
  passkeys only. There is no session list, no revoke button, and no "sign out everywhere". A stolen
  session is valid for six months with no way to see or kill it short of clearing the D1 table by
  hand.
- The session token is never rotated. There is no re-issue on privilege change (registering a
  passkey, for example).

**Fix:** either build the session list the schema promises — a `GET /auth/sessions` and
`DELETE /auth/sessions/:hash` scoped by `user_id`, plus a "sign out everywhere" that clears all rows
for the user — or delete the `user_agent` column and the comment, so the schema stops describing a
control that does not exist. The first is better; either is better than the current mismatch.

### 10. Low — the CSRF defence is a single fail-open signal

**Where:** `worker/http.ts:110–115`.

```ts
const site = req.headers.get('sec-fetch-site');
if (site && site !== 'same-origin' && site !== 'none') throw new HttpError(403, …);
```

If the header is absent the request is allowed. The comment argues any client old enough to omit it
predates passkeys and so could not have signed in — true for passkeys, but the magic-link path has
no such requirement, and header-stripping intermediaries exist. It is a reasonable primary defence
and a poor sole one.

**Fix:** add a second, independent check — verify the `Origin` header against `APP_ORIGIN` on every
state-changing request, and reject when *both* signals are missing. That is two lines and removes
the fail-open.

### 11. Low — deleted books' files are never removed from R2

**Where:** `worker/data.ts:414` — `forgetBookFiles` is exported and, per a repo-wide grep, called
from nowhere.

Deletions arrive as tombstones (`deleted: 1`) and the client calls `DELETE /api/files/...` itself
(`adapters/soluna.ts:145`), so in the normal path the object does get removed. But nothing on the
server enforces it: if the client is offline, closed, or crashes between pushing the tombstone and
issuing the deletes, the EPUB stays in R2 indefinitely with no UI that will ever offer to remove it
again. From a privacy standpoint, "delete" should mean the bytes are gone.

**Fix:** call `forgetBookFiles` from `push()` whenever a book row arrives with `deleted` set, and
add an account-deletion path — right now there is no way to delete an account at all, and the
`on delete cascade` foreign keys are never exercised because nothing ever deletes from `users`.

### 12. Low — session cookie lacks the `__Host-` prefix

**Where:** `worker/http.ts:64` (`SESSION_COOKIE = 'soluna_session'`), `:70–79`.

`HttpOnly` and `SameSite=Lax` are both right, and the conditional `Secure` is well-reasoned for
localhost. Naming the cookie `__Host-soluna_session` in production would additionally guarantee it
cannot be set by a sibling subdomain — relevant if Soluna ever shares a registrable domain with
anything else. `__Host-` requires `Secure` and no `Domain`, both of which already hold over https.

**Fix:** derive the name from the scheme the same way `secure()` does — `__Host-soluna_session` over
https, plain name over http for dev.

### 13. Low — the one un-parameterised SQL fragment

**Where:** `worker/data.ts:66`.

```ts
const q = (table: string) =>
  env.DB.prepare(`select * from ${table} where user_id = ? and row_seq > ? …`)
```

Safe today: `q` is called eight times with eight string literals. It is flagged only because it is
the single place in the codebase where a value reaches SQL text, so it is where a future change —
"let the client ask for one table" — turns into injection. A `const TABLES = [...] as const` with the
parameter typed to that union costs nothing and makes the safety structural rather than incidental.

---

## 5. Suggested order of work

1. **Finding 1** — sanitizer recursion + a final attribute sweep + regression tests. Everything else
   is secondary to this.
2. **Finding 2** — anchor scheme allowlist. Same file, same test run.
3. **Finding 4** — CSP in `_headers` *and* in the Worker's own responses. This is the safety net
   that limits the damage of whatever the sanitizer misses next.
4. **Findings 5, 6, 7** — small, self-contained Worker changes (fixed content type + `nosniff`;
   rate-limit the passkey options endpoint; cap payload and upload size).
5. **Findings 9, 11** — session list / revocation, and server-side file cleanup on delete.
6. **Findings 8, 10, 12, 13** — hardening.

Items 1–3 are the ones that change the risk profile. The rest are good hygiene.

---

## 6. What this review did not cover

- No dynamic testing against a running instance — findings are from source review, plus a local
  harness that replayed the sanitizer's logic against crafted input (§4.1, §4.2).
- The Supabase RLS policies were read, not executed. Worth confirming against the live project that
  the policies in `supabase/schema.sql` are actually applied and that `books` bucket `public` is
  `false` — the file is idempotent but only takes effect if it has been run.
- No review of Cloudflare account configuration: API token scopes, who can `wrangler deploy`, R2
  bucket public-access settings, D1 backup retention.
- `tesseract.js` and its WASM core are fetched from jsdelivr at runtime (`src/ocr/recognize.ts`)
  with no subresource integrity. A CDN compromise would execute code on the origin. Vendoring them
  into `public/` — already noted in `CLAUDE.md` as a ~15 MB tradeoff — would close that and let you
  drop jsdelivr from `connect-src`.
- Dependency review is limited to `npm audit` (clean); no supply-chain or transitive-maintainer
  analysis.
