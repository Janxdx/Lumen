# Getting Soluna running — step by step

Two parts. **Part A** gets it working on your own Mac in about five minutes,
costs nothing, and needs no accounts. **Part B** puts it on the internet.

Do Part A first. If something is broken, you want to find out before a
domain and a mail provider are involved.

Every command is run in the Terminal, from the project folder:

```sh
cd ~/PycharmProjects/"Reader App"
```

---

## Part A — run it on your own machine

### A1. Log in to Cloudflare

```sh
npx wrangler login
```

A browser window opens. Click Allow. Free account is fine — if you don't
have one, this is where you make it.

### A2. Create the database

```sh
npx wrangler d1 create soluna
```

It prints a block that looks like this:

```
[[d1_databases]]
binding = "DB"
database_name = "soluna"
database_id = "a1b2c3d4-5678-90ab-cdef-1234567890ab"
```

**Copy that `database_id` value.** Open `wrangler.jsonc`, find the line that
says `"database_id": "REPLACE_WITH_YOUR_D1_ID"`, and paste it in place of
`REPLACE_WITH_YOUR_D1_ID`. Keep the quotes.

### A3. Create the file storage

```sh
npx wrangler r2 bucket create soluna-books
```

> If this one fails saying R2 isn't enabled, go to the Cloudflare dashboard →
> R2 → and click through the one-time activation. It asks for a card but does
> not charge on the free tier. If you'd rather not, skip it — everything works
> except uploading the actual EPUB files between devices.

### A4. Create the tables

```sh
npm run db:local
```

Should print a wall of `"success": true`.

### A5. Start it

```sh
npm run worker
```

Wait for `Ready on http://localhost:8787`, then open that address in your
browser.

### A6. Sign in

Go to the Account screen, type any email address — it does not need to be
real — and press **Email me a link**.

**The link will not be emailed.** Look in your Terminal instead. You will see:

```
  ✉  sign-in link for you@example.com
     http://localhost:8787/auth/callback?token=...
```

Copy that URL into the browser. You're signed in.

### A7. Check it worked

- Import an EPUB, then press **Sync** on the Account screen
- Press **Add a passkey for this device** — then sign out and back in with
  Touch ID instead of the link

If that all works, the backend is fine and Part B is just plumbing.

---

## Part B — put it on the internet

### B1. Get a domain

You need one for two reasons: passkeys are tied to a hostname, and email
providers will not send from a domain you don't control.

Buy it anywhere. Cloudflare Registrar sells at cost with no renewal games,
which is the only reason to prefer it. **If you buy it elsewhere**, you must
then point the domain's nameservers at Cloudflare — the registrar's control
panel will have a field for this, and Cloudflare tells you which two values
to enter when you add the domain.

### B2. Set up email sending

1. Make a free account at [resend.com](https://resend.com) (3,000 emails a
   month, 100 a day — you will use perhaps five)
2. Add your domain and follow their DNS instructions. Since your DNS is now
   at Cloudflare, you add those records in the Cloudflare dashboard → your
   domain → DNS → Add record
3. Wait for Resend to show the domain as verified
4. Create an API key and copy it

Then:

```sh
npx wrangler secret put RESEND_API_KEY
```

Paste the key when it asks. It is not stored in any file.

### B3. Tell the app its own address

Open `wrangler.jsonc` and change these two lines:

```jsonc
"APP_ORIGIN": "https://readsoluna.com",
"MAIL_FROM": "Soluna <hello@readsoluna.com>"
```

`APP_ORIGIN` must be **exactly** the address you will type into the browser —
including `https://`, and no trailing slash. Passkeys are bound to this
hostname. If sign-in works but passkeys mysteriously don't, this is why.

### B4. Deploy

```sh
npm run deploy
```

The database in Part A was a local copy on your Mac; the deployed one starts
empty. You don't need a separate step to fill it — `npm run deploy` applies
`worker/schema.sql` to the remote database first (it's the `predeploy` script
in `package.json`, and it's idempotent, so this happens on every deploy
without doing any harm). A future release that adds a table shows up in prod
the moment you deploy it, no extra command to remember.

### B5. Attach the domain

Cloudflare dashboard → Workers & Pages → **soluna** → Settings → Domains &
Routes → **Add** → Custom Domain → enter `readsoluna.com`.

Give it a minute, then open it. Sign in with your real email — this time the
link actually arrives in your inbox.

Add a passkey on your iPad, and from then on it's Face ID.

---

## When something goes wrong

| What you see | What it means |
| --- | --- |
| "The server is not responding correctly — is the Worker running?" | You're on `npm run dev` (front-end only). Use `npm run worker`. |
| No email arrives | Local: it's in your Terminal, by design. Deployed: `RESEND_API_KEY` isn't set, or the domain isn't verified yet. |
| Sign-in works, passkeys fail | `APP_ORIGIN` doesn't exactly match the address in the URL bar. |
| "That link has already been used" | Links work once. Ask for a new one. |
| Signed in, then instantly signed out | You're on `http://` with a domain other than localhost. Cookies need https. |
| Books sync but covers don't | R2 wasn't created — see step A3. |
