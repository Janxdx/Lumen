# Branch workflow

- `main` — production. Only receives merges from `develop`, and only when Jan says everything is ok.
- `develop` — where the work happens. Commit directly here; do not create
  feature branches unless Jan asks for one by name.
- When Jan says everything is ok: merge `develop` into `main`.
- Never commit directly to `main`.

Before committing on `develop`, run `npm run typecheck`, `npm test` and
`npm run build`. All three pass today, so a failure is something you just
introduced.

# Current state (2026-08-04)

Everything listed below has since reached `origin/main` (`d2c2d34`) — the
sections are kept because they record *why*, not *what*. `develop` is ahead of
it by the reading-pace estimate (`5c95f9e`) and by **the PWA update path**
(below).

Sections that are now history rather than pending work:

- `82331f8` — the Worker names the one 500 that means "your D1 schema is out
  of date" instead of hiding it behind "Something went wrong."
- `6adad35` (merged as `286f00a`) — **find your place by scanning a page**.
- **rate limiting across the whole API** (below).
- **Supabase removed; D1 schema now deploys itself** (below).
- **renamed from Lumen to Soluna** (below).

## The PWA update path

The offline shell used to call `skipWaiting()` in `install` and delete every
other cache in `activate`. That meant a new worker seized the page that was
already open — a page running the *previous* bundle, which still resolves its
lazy chunks by their old hashed names. `tesseract.js` on the first scan is the
one that bites. Those filenames were just dropped from the cache and are gone
from the server too, so the running session breaks and only a reload fixes it.
Meanwhile nothing ever called `registration.update()`, so an iPad PWA that
stays resident for days never checked for a new build in the first place: the
app could both break on update *and* fail to notice one.

Now the worker installs, precaches and waits. `src/pwa/update.ts` polls
(`updateViaCache: 'none'`, on `visibilitychange` and hourly), `UpdateBanner`
offers the waiting build as a pill, and only a tap posts `SKIP_WAITING`. The
reload is driven by `controllerchange` behind a one-shot guard — posting and
reloading together races the swap, and reloading a page the new worker has not
claimed yet just re-runs the old one. The banner is suppressed while a book is
open; the offer keeps.

Three points worth not re-deriving:

- **Navigations are cache-first now, not network-first.** A cache generation
  is self-consistent: the `index.html` in `soluna-<BUILD>` names exactly the
  hashed bundles precached beside it. The network's `index.html` belongs to a
  newer generation, so storing it here leaves a shell whose scripts only
  resolve while online. Freshness is the update check's job, not the fetch
  handler's.
- The precache uses `cache: 'reload'`. Without it `index.html` can be filled
  from the HTTP cache — the new worker installs the shell it is replacing and
  the update visibly does nothing. Hashed assets are immune; `index.html` is
  not.
- `BUILD` is a sha256 of the asset list plus `index.html`, not `Date.now()`.
  Any byte-difference in `sw.js` is a new worker to the browser, so a
  timestamp asked the reader to update to a bit-identical app after every
  rebuild. `public/_headers` already sends `no-cache` for `/sw.js` and
  `/index.html`; the registration option is the belt to that suspenders.

No schema change, so `npm run db:local` is not needed.

## Renamed from Lumen to Soluna

The app is Soluna, the project is Soluna Reader, the domain is
`readsoluna.com`. `RENAME.md` is the full record and should be deleted once
the migration is finished.

Two things not to re-derive. First, the persisted keys were renamed along
with everything else — the Dexie database, `localStorage`, the session
cookie, the SW cache, the `soluna:changed` event. That is normally data
loss, and it was free exactly once, because renaming the Worker changes the
origin and all four of those are scoped per origin. Second, `database_id`
in `wrangler.jsonc` is a **placeholder on purpose** and deploys fail until
`scripts/rename-to-soluna.sh` has run and its output is pasted in. A valid
old id there would ship the renamed Worker against the old database
silently, which is worse than a failed deploy.

The script copies R2 objects as well as D1 rows, and takes the object keys
from `books.file_path` / `books.cover_path` rather than listing the bucket.
Rows without objects would be a library where every download 404s —
`file_path` is what marks a book as uploaded.

## Rate limiting

`worker/limit.ts` gates every `/api` and `/auth` request ahead of the router,
so ahead of the session lookup — a rejected request costs no query. Counters
are Cloudflare rate limiting bindings in `wrangler.jsonc` (edge-local, free,
10s or 60s windows only, per-location), never D1: a limiter storing counters
in the database it protects adds queries to every request it inspects.

Seven bindings, namespaces 1001–1007; the table and the reasoning are in
`worker/README.md`. Three points worth not re-deriving:

- Signed-in traffic is keyed by a hash of the session cookie, **unverified**
  — verifying costs the query the gate exists to avoid. A forged cookie
  therefore buys a private budget, and `RL_ADDRESS` (keyed by IP, applied to
  everything) is what makes that worthless. Neither wall works alone.
- **File endpoints deliberately skip the burst wall.** `downloadAll()` and
  the two loops in `syncFiles()` walk whole libraries with nothing pacing
  them, so a legitimate burst is as long as somebody's shelf. Verified live:
  90 consecutive file GETs pass, while `/api/pull` cuts off at exactly 60.
- The magic-link limit **stays in D1** (`rate_limits` table, `auth.ts`). It
  needs a 15-minute window and one global count, because it rations mail
  into someone's inbox rather than load arriving here.

`gate()` fails open with a `console.warn` if a binding is missing, so an
older `wrangler.jsonc` degrades to today's behaviour instead of refusing
every request. No schema change, so `npm run db:local` is not needed.

Not covered, by decision: there is no client-side backoff — the ceilings are
sized so legitimate traffic never meets them, rather than relying on the
client to behave.

## Supabase removed; D1 schema now deploys itself

Jan works solo and only ever runs against Cloudflare, so the Supabase
adapter (`src/sync/adapters/supabase.ts`), the `supabase/` folder, and
`@supabase/supabase-js` are gone. `src/sync/backend.ts` stays as the seam —
a future adapter is a new file behind it, not a rewrite — but `Backend.kind`
is now just `'soluna'` and `src/sync/client.ts` only chooses between the
Worker and `VITE_BACKEND=none`.

The `ratings` table going missing in prod (2026-08-02) was the reminder that
`worker/schema.sql` was never applied automatically — `npm run db:remote`
had to be run by hand after every schema-adding release, and it wasn't.
Fixed by adding `predeploy: npm run db:remote` to `package.json`: npm runs
`pre<script>` hooks automatically ahead of the matching script, so
`npm run deploy` now applies the (idempotent, `create table if not exists`)
schema to remote D1 before `wrangler deploy` runs. A future table can't go
missing in prod the same way again.

## Find your place (the scan feature)

`src/engine/passage.ts` had been sitting unused since PR #3 — fold → shingle
vote → Smith–Waterman, with three gates (min words, min score, and a margin
over the runner-up, which is the gate that actually prevents landing in the
wrong one of two similar passages). What got added around it:

- `src/ocr/recognize.ts` — two ways in. On iPadOS the keyboard's own Scan
  Text writes into the field and no photo is ever taken; elsewhere
  tesseract.js is lazily loaded (own 17 kB chunk), fed a downscaled grey
  canvas, and the canvas is destroyed in a `finally`. **The photo path
  fetches its WASM core and `eng.traineddata` from jsdelivr on first use** —
  vendoring them into `public/` would make it offline at ~15 MB in the shell.
- `src/engine/passageStore.ts` — packs the index as CSR typed arrays
  (~2.5 MB/novel instead of >10 MB of Map overhead), plus `excerptAt` for
  showing the reader the sentence behind an uncertain match.
- `src/scan/session.ts` — build-on-demand, cache, locate, excerpt.
- `src/ui/ScanSheet.tsx` — `ScanPanel` (for callers already inside a Sheet)
  and `ScanSheet` (its own sheet). Entry points: device finish-session sheet,
  device book detail, and library book detail.

Dexie **v5** adds a `passages` table. It is the only table holding no user
data, so it is deliberately outside sync and outside tombstones — losing a
row costs a second of CPU. LRU-evicted against a 24 MB budget; dropped with
the file it describes. No D1/Worker schema change, so `npm run db:local` is
not needed for this feature.

Known rough edge: the first scan of a long novel blocks the main thread for
about a second while the index builds. Moving `buildPassageIndex` into a Web
Worker is the obvious follow-up.

## Stale branches

`feat/page-scan`, `fix/missing-ratings-table`, `feat/device-sync`,
`feat/passage-match`, `feat/ratings`, `backup/scan-to-sync-tangled` are all
merged or superseded — safe to delete once Jan confirms, not deleted
automatically.

# Environment notes

Always run `git fetch origin` before assuming local state is current —
`main` can move if PRs get merged on GitHub directly. `origin/develop` now
exists — it was pushed on 2026-08-02 — so `develop` is no longer local only
and can also move underneath you.

The sandbox mount cannot unlink files by default, which leaves git unable to
clean up its own `.git/*.lock` files and wedges the repo mid-operation. If a
git command fails with "Operation not permitted" or "Another git process
seems to be running", the fix is to enable deletion for the folder and
`rm -f .git/HEAD.lock .git/index.lock`, then re-check `git status` before
carrying on.
