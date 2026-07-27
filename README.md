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

**Cloudflare Pages, connected to this repo:**

| Setting | Value |
| --- | --- |
| Framework preset | None |
| Build command | `npm run build` |
| Build output directory | `dist` |
| Node version | 20 or newer (`NODE_VERSION` env var) |

Every push to `main` builds and publishes. `public/_headers` keeps `index.html`
and `sw.js` uncacheable so a new deploy is actually picked up, and pins the
hashed assets forever. `public/_redirects` serves the shell for every route.

Then, once, on the iPad: open the `*.pages.dev` URL in Safari → Share → **Add to
Home Screen**, and launch it from that icon. Books stay on the device — the host
only ever serves the app itself.

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
src/store/      settings and library state
src/ui/         Library, Reader, Pacer controls, Statistics, Charts
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
