/* Getting an edition, and only ever once.
 *
 * Three caches sit in front of every network call, and each exists for a
 * different failure:
 *
 *   the in-flight map   two spines rendering at the same moment ask for the
 *                       same book, and without this they both fetch it
 *   Dexie               so the shelf draws instantly on the next launch,
 *                       and at all when the iPad is offline
 *   D1, on the server   so a second device — and a second reader — never
 *                       troubles Open Library for a book already looked up
 *
 * Everything here fails soft. An edition that cannot be fetched is not an
 * error state in the UI; it is a book drawn the way the app drew every book
 * before this feature existed. That is the whole contract, and it is why
 * none of these functions reject.
 */

import { db, trimEditionCache, type EditionRecord } from '../db';
import { editionKey, editionSlug, type EditionData } from '../engine/edition';
import { extractPalette } from './palette';

/* ── the network ───────────────────────────────────────────────────── */

/** Set once the server says no. See `paused` below. */
let pausedUntil = 0;

async function fetchEdition(
  key: string,
  title: string,
  author: string,
  lang: string
): Promise<EditionData | null> {
  const q = new URLSearchParams({ key, slug: editionSlug(key), title, author, lang });
  const res = await fetch(`/api/lookup?${q}`, { credentials: 'same-origin' });

  if (res.status === 429) {
    /* The lookup ceiling, doing its job. Enriching a shelf for the first
       time is the one moment this can happen — sixty books at one a second
       against a sixty-a-minute ceiling has no headroom for a sync landing
       in the middle of it. Backing off for a minute and picking up where we
       left off is invisible: the shelf fills in a little more each time it
       is opened, and every answer already collected is on disk. */
    pausedUntil = Date.now() + 60_000;
    return null;
  }
  if (!res.ok) return null;
  return (await res.json()) as EditionData;
}

async function fetchCover(coverPath: string): Promise<Blob | null> {
  /* The path comes back as `editions/<slug>.cover`; the route wants the
     slug alone. Derived rather than stored twice so there is one spelling
     of an object name in the system. */
  const slug = coverPath.replace(/^editions\//, '').replace(/\.cover$/, '');
  try {
    const res = await fetch(`/api/editions/cover/${encodeURIComponent(slug)}`, {
      credentials: 'same-origin',
    });
    if (!res.ok) return null;
    return await res.blob();
  } catch {
    return null;
  }
}

/** True while the server has told us to slow down. Callers use it to stop a
    shelf-wide run early rather than making sixty requests that all 429. */
export const paused = (): boolean => Date.now() < pausedUntil;

/* ── the cache in front of it ──────────────────────────────────────── */

/* Two spines for the same book render in the same tick often enough — a
   library entry and the rating of it — that without this they each start a
   fetch and each write the row. */
const inFlight = new Map<string, Promise<EditionRecord | null>>();

/** What the shelf reads. A row already on disk, or nothing. */
export async function cachedEdition(key: string): Promise<EditionRecord | null> {
  return (await db.editions.get(key)) ?? null;
}

/**
 * The edition for a book, fetching it if this device has never seen it.
 *
 * `lang` should be the language of the *edition* — `dc:language` from the
 * EPUB where there is one. It decides which Wikipedia answers and which
 * way the title runs on the spine, so guessing it from the interface
 * language would put English summaries on German books.
 */
export async function ensureEdition(
  title: string,
  author: string,
  lang = 'en'
): Promise<EditionRecord | null> {
  if (!title.trim()) return null;

  const key = editionKey(title, author);

  const existing = await db.editions.get(key);
  if (existing) {
    /* Touch, but don't await it — this is on the render path and the LRU
       stamp being a moment late costs nothing. */
    void db.editions.update(key, { usedAt: Date.now() }).catch(() => {});
    return existing;
  }

  if (paused()) return null;

  const started = inFlight.get(key);
  if (started) return started;

  const run = load(key, title, author, lang).finally(() => inFlight.delete(key));
  inFlight.set(key, run);
  return run;
}

async function load(
  key: string,
  title: string,
  author: string,
  lang: string
): Promise<EditionRecord | null> {
  let data: EditionData | null = null;
  try {
    data = await fetchEdition(key, title, author, lang);
  } catch {
    /* Offline, most likely. Not written to Dexie: an empty row would be
       indistinguishable from "this book is not in any catalogue" and would
       stop the app ever trying again. */
    return null;
  }
  if (!data) return null;

  let cover: ArrayBuffer | undefined;
  let coverType: string | undefined;
  let palette: string[] | undefined;

  if (data.coverPath) {
    const blob = await fetchCover(data.coverPath);
    if (blob) {
      /* The palette is read from the Blob while we still hold it, before it
         is drained to bytes. Doing it later would mean rebuilding a Blob
         from the stored ArrayBuffer on every launch — the extraction is
         cheap but it is not free, and the answer never changes. */
      const swatches = await extractPalette(blob);
      if (swatches.length) palette = swatches.map((s) => s.hex);

      /* Drained to bytes rather than stored as the Blob: IndexedDB refuses
         a blob whose backing is still held elsewhere and takes the
         surrounding transaction down with it. Same reason as CoverRecord. */
      cover = await blob.arrayBuffer();
      coverType = blob.type || 'image/jpeg';
    }
  }

  const now = Date.now();
  const record: EditionRecord = {
    key,
    data: palette ? { ...data, palette } : data,
    ...(cover ? { cover, coverType } : {}),
    fetchedAt: now,
    usedAt: now,
    size: (cover?.byteLength ?? 0) + 600,
  };

  try {
    await db.editions.put(record);
    void trimEditionCache().catch(() => {});
  } catch {
    /* Storage full, or a private-mode browser refusing to persist. The
       record is still returned and still drawn — it simply has to be
       fetched again next launch. */
  }

  return record;
}

/** The stored cover as something an `<img>` can show. */
export const editionCoverBlob = (row: EditionRecord): Blob | null =>
  row.cover ? new Blob([row.cover], { type: row.coverType || 'image/jpeg' }) : null;

/* ── filling a shelf ───────────────────────────────────────────────── */

/** Between lookups, when walking a whole shelf. One a second is well under
    the server's ceiling and far under what the catalogues ask for; the run
    is invisible because the books already fetched draw immediately. */
const PACE_MS = 1000;

/**
 * Fetch every edition a shelf needs, slowly, in the background.
 *
 * Sequential and paced rather than `Promise.all`, which is the difference
 * between a polite client and sixty simultaneous requests to a charity's
 * search endpoint. Stops at the first sign of a ceiling and leaves the rest
 * for next time — the shelf is usable throughout, filling in as it goes.
 *
 * Returns the number of books it actually fetched, so a caller can tell
 * whether anything changed and re-render once at the end.
 */
export async function fillShelf(
  books: { title: string; author: string; lang?: string }[],
  onProgress?: () => void
): Promise<number> {
  let fetched = 0;

  for (const book of books) {
    if (paused()) break;
    if (!book.title.trim()) continue;

    const key = editionKey(book.title, book.author);
    if (await db.editions.get(key)) continue;

    const row = await ensureEdition(book.title, book.author, book.lang);
    if (row) {
      fetched++;
      onProgress?.();
    }

    await new Promise((r) => setTimeout(r, PACE_MS));
  }

  return fetched;
}
