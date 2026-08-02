# Lumen → Soluna

A record of what the rename changed, and the one part of it that is not a
code change. Delete this file once the migration is done and the old
Cloudflare resources are gone.

## The names

| | |
| --- | --- |
| Project / repo | Soluna Reader |
| In the app, on the home screen, in mail | Soluna |
| npm package | `soluna-reader` |
| Domain | `readsoluna.com` |
| Worker | `soluna` |
| D1 database | `soluna` |
| R2 bucket | `soluna-books` |

## Why persisted keys were renamed too

Six values that look like implementation detail are actually keys that
outlive a page load:

- the Dexie database, `soluna` (was `lumen`)
- `localStorage` keys `soluna.settings` and `soluna.settings.at`
- the session cookie, `soluna_session`
- the service worker cache, `soluna-<build>`
- the in-app change event, `soluna:changed`

Renaming any of those normally means throwing away whatever was stored
under the old key. It is free exactly once: the Worker rename changes the
origin, and IndexedDB, localStorage and cookies are all scoped per origin,
so everything under the old names was going to be unreachable regardless.
Doing it later would have been the same rename at the price of a wiped
library. So it happened now.

The one place this is visible is local development: `localhost:8787` does
not change origin, so a test library built up under the old Dexie name is
still on disk but no longer read. Import a book again and it is fine.

## The migration

The D1 database and the R2 bucket cannot be renamed in place, and they are
the only things holding data that matters. `scripts/rename-to-soluna.sh`
creates the new pair and copies everything across:

```sh
npx wrangler login          # if you aren't already
./scripts/rename-to-soluna.sh
```

It prints the new `database_id`; paste it into `wrangler.jsonc` where the
placeholder sits, then `npm run deploy`.

Until that placeholder is replaced, deploys fail. That is deliberate — a
valid old id there would let the renamed Worker ship silently against the
old database, and the failure mode of *that* is the one you would only
notice weeks later, having written reading history into a database you
thought you had left behind.

It deletes nothing. The old `lumen` database and `lumen-books` bucket stay
exactly as they are, plus a timestamped `.sql` dump in the repo root. Keep
them until the new deployment has been syncing happily for a few days.

## What you have to do on the iPad

The origin changes, so as far as Safari is concerned this is a different
site. Three things follow, all one-time:

1. **The installed app points at the old address.** Remove it from the
   home screen, open `https://readsoluna.com`, Share → Add to Home Screen.
2. **The passkey is gone.** Passkeys are bound to the origin they were
   created on and a browser will not offer one to a different hostname.
   Sign in once with a magic link, then add a passkey again from the
   account screen.
3. **The local library starts empty.** IndexedDB is per origin, so nothing
   carried over. The first sync pulls every book back from D1 and R2 —
   which is why the migration script has to copy the R2 objects, not just
   the rows: `books.file_path` says a book was uploaded, and a download
   against a bucket that never received it fails with "Book file not
   found."

## Availability

`Soluna` already exists as an app name — a mental-health app for young
people in California, at `solunaapp.com`. Different category, so it is not
a conflict worth worrying about for a personal project, but it is why the
domain here is `readsoluna.com` rather than `soluna.app`.
