# Lumen

An EPUB reader for iPad, iPhone and Mac. Web-first, installable, offline.
See [DESIGN.md](./DESIGN.md) for the design language and architecture.

## Run it

```bash
npm install
npm run dev        # then open the printed http://<your-mac-ip>:5173 on the iPad
```

`npm run dev` binds to `--host`, so the iPad can reach the dev server over your
local network. For the real thing:

```bash
npm run build      # typechecks, then bundles to dist/
npm run preview
```

To install on the iPad: open the URL in Safari → Share → **Add to Home Screen**.
This matters — installed PWAs get persistent storage, so Safari won't evict
your library after a week of not reading.

## Deploy (this is what makes it work offline)

Offline needs a service worker, and a service worker needs a secure context:
`https://` or `localhost`. Opening `http://<mac-ip>:5173` on the iPad gives
neither, so nothing is ever cached and the app dies with the dev server. The
fix is a static host — the build is just files.

**Cloudflare Workers, connected to this repo:**

| Setting | Value |
| --- | --- |
| Build command | `npm run build` |
| Deploy command | `npx wrangler deploy` |
| Node version | 20 or newer (`NODE_VERSION` env var) |

`wrangler.jsonc` is what makes that deploy command work: it declares an
assets-only Worker — no server code — pointing at `dist`, with
`not_found_handling: single-page-application` so every route serves the shell.
Locally the same thing runs as `npm run deploy`.

`public/_headers` keeps `index.html` and `sw.js` uncacheable so a new deploy is
actually picked up on a device that already has the app installed, and pins the
hashed assets for a year.

Then, once, on the iPad: open the `*.pages.dev` URL in Safari → Share → **Add to
Home Screen**, and launch it from that icon. Books stay on the device — the host
only ever serves the app itself.

## Accounts and sync

Optional, and off until you configure it. With no credentials set there is no
network traffic at all and the Account tab says so; the reader is unchanged.

**Set it up once:**

1. Create a project at [supabase.com](https://supabase.com) (free tier is plenty).
2. SQL Editor → paste [`supabase/schema.sql`](./supabase/schema.sql) → Run. That
   creates the tables, the row-level-security policies, and the private `books`
   storage bucket.
3. Authentication → Providers → Email: on. Turn *Confirm email* off while
   testing, on before anyone else uses it.
4. `cp .env.example .env.local` and fill in the project URL and the **anon** key
   (Project Settings → API). Never the `service_role` key — it bypasses RLS.
5. In Cloudflare, add the same two variables under Settings → Variables, then
   redeploy. Vite inlines them at build time, so a redeploy is required.

**What syncs:** the book list, the EPUB files themselves, reading position,
every session behind the statistics, bookmarks, and your reader settings.
Signing in on a device that already has books uploads them to the account.

**How conflicts resolve:** last write wins, per record. The cursor is the
server's clock (`synced_at`), never the device's, so two iPads with clocks a
minute apart can't take turns overwriting each other. Deletions leave a
tombstone locally so a deleted book doesn't reappear on the next pull.

**Files:** EPUBs go to `books/<user id>/<book id>.epub` in Supabase Storage,
private, readable only by that user. A book pulled from another device arrives
as metadata first and downloads its file the moment you open it — a fresh iPad
is usable in seconds rather than after the whole library transfers. *Account →
Download all* fetches everything up front for a flight.

### Moving to your own server

The Supabase pieces are deliberately shallow, so this stays a small job:

- `supabase/schema.sql` is plain PostgreSQL apart from `auth.uid()`. Point it at
  your own Postgres and swap that call for `current_setting('app.user_id')::uuid`,
  set per connection from your own JWT. Table shapes don't change.
- `src/sync/client.ts` is the only file that constructs a Supabase client.
  Self-hosting Supabase means changing the URL in `.env` and nothing else.
- `src/sync/sync.ts` and `src/sync/mapping.ts` are the only files that name
  tables or storage paths. Replacing the backend entirely means rewriting those
  three files; nothing in `ui/`, `store/` or `engine/` knows a server exists.
- Object storage is S3-compatible either way, so `books/<user>/<book>.epub`
  carries over to MinIO or R2 unchanged.

## Using it

- **Import** — drag an `.epub` onto the library, or *Add EPUB* to pick from Files.
- **Read** — tap the page edges or swipe to turn; tap the middle to show or hide the controls.
- **Pace** — press play in the bottom bar. Words highlight in sequence and the page turns itself when the highlight reaches the edge. Drag the slider or use ±25 to change speed; space bar toggles it.
- **Tune** — the sliders icon opens theme, text size, line spacing, margins, typeface, and the pacer's behaviour.

Keyboard: `←`/`→` turn pages, `space` toggles the pacer, `esc` closes.

## Layout

```
src/engine/     portable core — no React, no app state
  epub/         zip access, path resolution, package/nav/NCX parsing
  sanitize.ts   allowlist HTML, drop publisher CSS, resolve images
  tokenize.ts   wrap every word in a span
  paginate.ts   column geometry, page lookup, scroll tween
  pacer.ts      dwell modelling and the rAF scheduler
  stats.ts      session aggregation — pure functions over recorded sessions
src/db/         IndexedDB (Dexie): books, files, covers, progress, sessions
src/store/      settings, library and account state
src/sync/       the only code that knows a backend exists
  client.ts     Supabase client + config; absent config disables sync
  mapping.ts    local record ⇄ wire row
  sync.ts       pull → merge → push, plus file upload/download
src/ui/         Library, Reader, Pacer controls, Statistics, Charts, Account
supabase/       schema.sql — tables, RLS policies, storage bucket
```

`engine/` is deliberately free of React so it can move into a native shell
unchanged — the reading surface of a native EPUB reader is a webview anyway.

## Notes on the pacer

Uniform timing feels mechanical, so dwell per word is modelled:

```
dwell = base × lengthFactor × punctuationFactor ÷ meanFactor
```

The final division by the chapter's mean factor is what keeps the setting
honest: at a target of 300 wpm you read 300 wpm on average, while the rhythm
still slows at commas and full stops. Verified — 150/300/600 all land exactly.

Turn it off under Pacer → *Metronome* if you prefer strict timing.
