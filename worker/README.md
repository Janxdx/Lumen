# Lumen's own backend

Auth, database and file storage on your Cloudflare account. No Supabase, no
monthly bill, no vendor holding your library.

The whole thing fits inside the free tier: 100k requests a day on Workers,
5 GB of SQLite in D1, 10 GB of objects in R2. The only outside party is the
mail sender, because Workers cannot send email and nothing you self-host can
give you a sending reputation.

## What runs where

| Piece | Was | Is now |
| --- | --- | --- |
| Accounts | Supabase Auth (passwords) | `worker/auth.ts` — magic links + passkeys |
| Database | Supabase Postgres | D1 (SQLite) |
| Files | Supabase Storage | R2 |
| Access control | Postgres row level security | a `where user_id = ?` on every statement |
| Email | Supabase | Resend (free tier: 3,000/month, 100/day) |

That fourth row is the one to keep in mind. Postgres enforced isolation
beneath the application, so a bug in a query could not leak another user's
rows. SQLite has nothing equivalent — the guarantee is now discipline in
`worker/data.ts`, where every statement carries its own user filter. If you
add a table, that is the thing not to forget.

## Why there are no passwords

The Workers free plan gives a request **10ms of CPU**. Hashing a password
properly is meant to cost far more than that — OWASP wants PBKDF2-HMAC-SHA256
at around 600,000 iterations, a few hundred milliseconds. Tuning it down to
fit the budget would mean storing a hash weak enough to be worth cracking.

So there are none. A magic link proves you control the address; a passkey
proves you hold the key. Both verify in under a millisecond, and both are
harder to phish than anything a person would have typed.

A pleasant side effect: the "signed in but never confirmed the email" state
cannot exist here. An account only comes into being when a link is opened.

## Setup

### 1. Create the resources

```sh
npx wrangler d1 create lumen          # copy the printed database_id
npx wrangler r2 bucket create lumen-books
```

Put the `database_id` into `wrangler.jsonc` where it says
`REPLACE_WITH_YOUR_D1_ID`.

### 2. Create the tables

```sh
npm run db:local     # for wrangler dev
npm run db:remote    # for the deployed Worker
```

### 3. Point it at your domain

In `wrangler.jsonc`, set `APP_ORIGIN` to the address people will actually
use, and `MAIL_FROM` to an address on a domain you have verified with
Resend.

`APP_ORIGIN` matters more than it looks: passkeys are bound to that
hostname, and the browser refuses an assertion whose origin doesn't match.
If sign-in works and passkeys silently don't, this is why.

### 4. Add the mail key

```sh
npx wrangler secret put RESEND_API_KEY
```

Skip this in local development — with no key set, the sign-in link is
printed to the console instead of emailed, which is faster anyway and works
offline.

### 5. Run it

```sh
npm run worker    # builds the front-end, then serves it and the API together
```

Both halves are on one origin. That is deliberate: it is what lets the
session live in an `HttpOnly` cookie instead of a token in JavaScript, where
a script injected through a malformed EPUB could read it.

### 6. Deploy

```sh
npm run deploy
```

## Custom domain

Workers custom domains are free; you pay only for the name itself. You do
not have to buy it from Cloudflare — any registrar works, you just point the
nameservers at Cloudflare and add the free plan.

Once the domain resolves, add a Custom Domain route to the Worker, then set
`APP_ORIGIN` to the new address and redeploy. Existing passkeys were
registered against the old hostname and will need to be added again; magic
links keep working throughout.

## Switching between backends

Both adapters are still in the tree, behind `src/sync/backend.ts`:

```sh
VITE_BACKEND=lumen      # the Worker
VITE_BACKEND=supabase   # the old hosted backend
VITE_BACKEND=none       # local only, no account screen, no network
```

Unset means: Supabase if its env vars are present, otherwise the Worker.
Nothing above the adapter layer knows which is running, so this is a genuine
switch and not a one-way door — worth keeping until you have read a book
end to end through the new one.

Note that the two backends hold **separate** data. Switching does not
migrate anything; it points the same local library at a different server,
and the first sync uploads what this device has.

## Verifying it works

```sh
npm run typecheck
npm test
```

The sync tests drive the merge logic directly — last write wins, tombstones
that survive a pull, append-only sessions that don't duplicate. Transport is
covered by running the Worker against a local D1, which is the only place it
can be checked honestly.
