# Soluna

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

`wrangler.jsonc` is what makes that deploy command work: it declares the
Worker (API under `/api` and `/auth`, static assets everywhere else) pointing
at `dist`, with `not_found_handling: single-page-application` so every other
route serves the shell. Locally the same thing runs as `npm run deploy`,
which also applies `worker/schema.sql` to the remote D1 database first (see
[Accounts and sync](#accounts-and-sync)) — a fresh deploy can never leave a
table missing in prod.

`public/_headers` keeps `index.html` and `sw.js` uncacheable so a new deploy is
actually picked up on a device that already has the app installed, and pins the
hashed assets for a year.

Then, once, on the iPad: open the `*.pages.dev` URL in Safari → Share → **Add to
Home Screen**, and launch it from that icon. Books stay on the device — the host
only ever serves the app itself.

## Accounts and sync

Backed by Soluna's own Worker — Cloudflare D1 for rows, R2 for files. Same
origin as the app, so there is nothing to configure and no key in
JavaScript; the session lives in an HttpOnly cookie. Optional in the sense
that `VITE_BACKEND=none` turns it off entirely, but on by default: no setup
step is needed to get an account screen.

**What syncs:** the book list, the EPUB files themselves, reading position,
every session behind the statistics, bookmarks, ratings, and your reader
settings. Signing in on a device that already has books uploads them to the
account.

**Schema deploys itself.** `worker/schema.sql` is idempotent
(`create table if not exists`) and runs automatically before every
`npm run deploy` — `predeploy` in `package.json` calls `npm run db:remote`
(`wrangler d1 execute soluna --remote --file worker/schema.sql`) ahead of
`wrangler deploy`. A release that adds a table, like `ratings`, no longer
depends on remembering to apply it by hand; it is live in prod the moment
the deploy finishes. Run `npm run db:local` once yourself for local
development against `wrangler dev` — nothing else is needed, and the local
IndexedDB migrates itself when the app next opens.

**How conflicts resolve:** last write wins, per record. The cursor is a
counter the Worker hands back on push (`row_seq`), never the device's clock,
so two iPads with clocks a minute apart can't take turns overwriting each
other. Deletions leave a tombstone locally so a deleted book doesn't
reappear on the next pull.

**Files:** EPUBs go to `books/<user id>/<book id>.epub` in the `BOOKS` R2
bucket, reachable only through the Worker's own session check — nothing is
public. A book pulled from another device arrives as metadata first and
downloads its file the moment you open it — a fresh iPad is usable in
seconds rather than after the whole library transfers. *Account → Download
all* fetches everything up front for a flight.

### Self-hosting

The whole backend is one Cloudflare account: `wrangler deploy` ships the
Worker, D1 database and R2 bucket together, and `worker/README.md` covers
provisioning them from scratch. `src/sync/adapters/soluna.ts` is the only
file that talks to it; `src/sync/sync.ts` and `src/sync/mapping.ts` are the
only files that name tables or storage paths. Replacing the backend
entirely — a different provider, a different database — means rewriting
those three files; nothing in `ui/`, `store/` or `engine/` knows a server
exists.

## Using it

- **Import** — drag an `.epub` onto the library, or *Add EPUB* to pick from Files.
- **Read** — tap the page edges or swipe to turn; tap the middle to show or hide the controls.
- **Pace** — press play in the bottom bar. Words highlight in sequence and the page turns itself when the highlight reaches the edge. Drag the slider or use ±25 to change speed; space bar toggles it.
- **Tune** — the sliders icon opens theme, text size, line spacing, margins, typeface, and the pacer's behaviour.

Keyboard: `←`/`→` turn pages, `space` toggles the pacer, `esc` closes.

## Reading on an e-reader

The **Reader** tab is a second shelf for books you read on an e-ink device,
where the app can only know what you tell it.

- **Track a book** with its page count. That count is the whole mechanism: it
  is the scale that turns "I stopped on page 148" into a percentage.
- **Time a session**, then enter the page you stopped on. The timer lives in
  the database, so closing the app mid-session doesn't lose it, and it prefills
  the end page from your recent pace. Sessions you forgot to time can be
  entered by hand with a date and a duration.
- **It lands in your statistics.** Every logged session is mirrored into the
  same history the reader writes, so time, words, pace and streaks count
  reading done away from the app.
- **And in the book, if you have it.** A tracked book links to a library book
  with the same title and author automatically; you can also link or unlink by
  hand, which pins the choice. Progress only ever moves forward — a page count
  behind where the app already is still counts as reading, but won't rewind
  your place.

If you get the page count wrong, fix it: every past session and the reading
position are recomputed from the corrected number.

Two caveats worth knowing. Front matter occupies pages on the reader but no
words here, so set *body starts on page* if the book has a lot of it. And
within a chapter the position is proportional — pages can locate you to within
a chapter exactly, and to a few paragraphs inside it.

## Rating what you read

The **Shelf** tab is where a finished book becomes an opinion. Reachable from
the tab bar, or straight from a book's *Details* in the library.

- **One number and five reasons.** A 0–10 verdict in half steps, plus prose,
  pacing, characters, ideas and feeling. Only the verdict is required; an axis
  you never touch stays unjudged rather than becoming a zero. Tap a mark again
  to unset it.
- **A mood.** Eight bookbinding-cloth colours — consuming, joyful, comforting,
  contemplative, haunting, melancholy, brutal, cold — for how the book *felt*,
  which is a different question from whether it was good.
- **The wall.** Every rating stands as a spine: colour is the mood, height is
  the score, thickness is the length of the book. Sort by rating, recency,
  mood, title or length.
- **Your curve.** The distribution of your scores with your average marked on
  it, a radar of what you reward across every rating, and the mood mix as one
  ribbon. Most people find out they have been giving everything an 8.
- **A taste card** you can save as an image — the whole shelf, the generated
  sentence about your taste, and the book you loved most, on one page.

Books read on the e-reader can be rated alongside the EPUBs; the picker offers
both shelves. And a rating outlives the file it describes — delete a book to
free space and the verdict stays on the shelf, title and all.

## Layout

```
src/engine/     portable core — no React, no app state
  epub/         zip access, path resolution, package/nav/NCX parsing
  sanitize.ts   allowlist HTML, drop publisher CSS, resolve images
  tokenize.ts   wrap every word in a span
  paginate.ts   column geometry, page lookup, scroll tween
  pacer.ts      dwell modelling and the rAF scheduler
  stats.ts      session aggregation — pure functions over recorded sessions
  device.ts     page ⇄ percent ⇄ word position, pace projection, book matching
  rating.ts     axes, mood palette, taste profile, shelf sorting
  tasteCard.ts  the shareable card, built as a string of SVG
src/db/         IndexedDB (Dexie): books, files, covers, progress, sessions,
                device books and their logged sessions, ratings
src/store/      settings, library and account state
src/sync/       the only code that knows a backend exists
  client.ts     picks the backend (the Worker, or none); VITE_BACKEND=none disables sync
  adapters/     soluna.ts — the Worker adapter (D1 + R2)
  mapping.ts    local record ⇄ wire row
  sync.ts       pull → merge → push, plus file upload/download
src/ui/         Library, Reader, Pacer controls, Device shelf, Shelf (ratings),
                Statistics, Charts, Account
tests/          run with `npm test` — the page↔word maths, the rating and
                taste-profile maths, and the store's sync rules. Plain Node,
                no build step and no test framework: Node strips the types
                itself and `register.mjs` teaches it the extensionless
                imports a bundler would resolve
worker/         the Soluna Worker — API, auth, rate limiting, D1 schema
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
