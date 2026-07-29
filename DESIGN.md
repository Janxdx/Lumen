# Lumen — Reader App

A beautiful EPUB reader for iPad (and iPhone/Mac), built web-first as an installable PWA, structured so the reader engine ports into a native shell later.

---

## 1. Principles

1. **The page is the product.** Every pixel of chrome earns its place or disappears. Controls fade out while reading and return on tap.
2. **Our typography, not the publisher's.** Book CSS is stripped; semantic HTML is kept. Every book reads with the same considered type. This is also what makes pagination and word-level pacing tractable.
3. **Motion is physical.** Spring easing, transform/opacity only, nothing that reflows during animation.
4. **Statistics are a reward, not a dashboard.** Rich data, presented as something you *want* to look at after finishing a session.

## 2. Design language

**Palette** — three reading themes, all with the same UI structure.

| | Background | Surface | Ink | Accent |
|---|---|---|---|---|
| Paper (light) | `#FAF7F2` | `#FFFFFF` | `#1A1714` | `#B4763A` |
| Sepia | `#F3E9D8` | `#FBF3E4` | `#3A2E22` | `#A2632C` |
| Ink (dark) | `#0E0D0C` | `#171614` | `#EDE7DE` | `#D89A5B` |

Accent is a warm amber — used for the pacer highlight, progress arcs, and nothing else. Restraint is the whole design.

**Type** — reading text in a system serif stack (`Iowan Old Style` / `Palatino` / Georgia), UI in the system sans. No web fonts: the app must work fully offline and load instantly.

**Texture** — a barely-there film grain over backgrounds, a soft page-edge shadow at the gutter, and generous margins that scale with viewport. On a 12.9" iPad the text column caps at ~34em so line length stays readable.

**Motion** — page turns slide on a spring (`cubic-bezier(.22,1,.36,1)`, 420ms). Chrome fades at 200ms. The pacer highlight itself does not animate — it snaps, because a lagging highlight breaks the pacing illusion.

## 3. Architecture

```
src/
  engine/          ← framework-free, portable to a native shell
    epub/          parse container.xml → OPF → spine, manifest, TOC, cover
    sanitize.ts    allowlist HTML, resolve images to blob URLs, strip book CSS
    tokenize.ts    wrap every word in a span — powers pacer + exact word counts
    paginate.ts    CSS multi-column pagination + page-of-word lookup
    pacer.ts       rAF scheduler: WPM + punctuation/length dwell modelling
    stats.ts       session aggregation, streaks, heatmap, WPM trend
    device.ts      page ⇄ percent ⇄ word position, pace projection, matching
  db/              Dexie (IndexedDB): books, files, progress, sessions, settings
  store/           app state (zustand)
  ui/              Library · Reader · Pacer · Device · Stats · Settings
```

`engine/` never imports React. In a native shell the reading surface is a `WKWebView` running the same engine — which is what Apple Books and Kindle do, since EPUB *is* HTML and CSS.

## 4. Core features

**Import** — drop or pick an `.epub`. The original file is stored as a blob; chapters are unzipped on demand. Metadata, cover, and TOC are extracted at import.

**Reader** — paginated columns, tap edges or swipe to turn, TOC drawer, adjustable font size / line height / margins / theme, resume-where-you-left-off per book.

**Pacer** — the distinguishing feature. Set a target WPM; words highlight in sequence. Dwell time per word is modelled, not uniform:

```
dwell = base × lengthFactor × punctuationFactor
base  = 60000 / wpm
lengthFactor      1 + (chars − 5) × 0.03   (clamped 0.75–1.6)
punctuationFactor , ; : → 1.5    . ! ? → 2.2    ¶ end → 2.6
```

Pages auto-turn when the highlight crosses the page boundary. Play/pause, ±10 WPM, and a "ramp" mode that eases from a comfortable speed to the target over the first minute.

**Device shelf** — a second library for books read on an e-ink reader. You give
a book its page count, time a session, and enter the page you stopped on; the
page count is the scale that converts that into the percentage the rest of the
app speaks in, and from there into a spine index and word offset. Each logged
session is mirrored into the ordinary session history, so reading done away
from the app counts towards every statistic. Books link to their library
counterpart by exact title and author, and progress only ever moves forward —
a reader entry behind the app is recorded but does not rewind your place.

**Statistics** — tracked per session and rolled up:

- *Session*: duration, words, actual WPM, pages, pauses, idle time
- *Book*: % complete, time spent, sessions, avg/best WPM, estimated time remaining, first and last read
- *Global*: total time, books started/finished, current and longest streak, daily-minutes bars, a year heatmap, time-of-day distribution, WPM trend over time, words/day, average session length

All charts are hand-drawn SVG — no chart library, full control over the look.

## 5. Storage & offline

IndexedDB via Dexie, `navigator.storage.persist()` requested on first import, service worker for offline. JSON export/import of the whole library as a backup, since Safari can evict data for sites that aren't installed to the Home Screen.

## 6. Path to native

Web app → Capacitor/WKWebView shell (adds App Store, `.epub` file associations, guaranteed persistence) → optional SwiftUI chrome around the same reading webview. Keeping `engine/` framework-free is what makes each step cheap.
