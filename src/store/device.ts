/* The device shelf: books read on a physical e-reader, the timer you run
   while reading them, and the machinery that folds that reading back into
   the library.

   Three rules govern the folding, and they are the whole design:

     1. A reader session becomes a library session, so every statistic in
        the app counts the reading you did away from it. One mirrored row
        per logged session, keyed by uid, so editing never duplicates.
     2. Progress only moves forward. A page count that implies less than
        the app already knows is still recorded as reading, but it does not
        rewind where you left off.
     3. Linking is by exact normalised title, done silently, and pinned the
        moment you touch it by hand — automatic behaviour should never
        overrule a decision you made deliberately. */

import { create } from 'zustand';
import {
  db,
  deleteDeviceBook,
  newUid,
  type DeviceBookRecord,
  type DeviceSessionRecord,
} from '../db';
import {
  bodyPages,
  findMatch,
  pageToPercent,
  pagesToWords,
  percentToLocus,
  percentToPage,
  type Locus,
} from '../engine/device';
import type { Session } from '../engine/stats';
import { useLibrary } from './library';

const changed = (): void => {
  dispatchEvent(new CustomEvent('soluna:changed'));
};

const TIMER_KEY = 'device.timer';

/** A running timer, kept in the database rather than in memory so that
    closing the app — or Safari discarding the tab, which it will — does not
    lose a session you are in the middle of. Elapsed time is derived from
    wall-clock stamps, never from a counter we increment. */
export interface TimerState {
  deviceBookId: string;
  /** when the timer was first started */
  startedAt: number;
  /** active ms banked before the current run */
  accumulatedMs: number;
  /** when the current run began; null while paused */
  runningSince: number | null;
  fromPage: number;
}

export const elapsedOf = (t: TimerState | null, now = Date.now()): number =>
  !t ? 0 : t.accumulatedMs + (t.runningSince ? now - t.runningSince : 0);

const uid = (): string => newUid();

interface DeviceState {
  books: DeviceBookRecord[];
  sessions: DeviceSessionRecord[];
  timer: TimerState | null;
  loaded: boolean;
  /** what the last finished session did to the library, for the receipt */
  lastSync: { title: string; from: number; to: number; moved: boolean } | null;

  load(): Promise<void>;
  addBook(
    input: Pick<DeviceBookRecord, 'title' | 'author' | 'pages'> &
      Partial<DeviceBookRecord>
  ): Promise<string>;
  updateBook(id: string, patch: Partial<DeviceBookRecord>): Promise<void>;
  removeBook(id: string): Promise<void>;
  /** link by hand — pins the choice against future auto-matching */
  link(id: string, bookId: string | null): Promise<void>;
  /** run the matcher over every unpinned, unlinked book */
  autoLink(): Promise<number>;

  start(deviceBookId: string, fromPage?: number): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  discard(): Promise<void>;
  /** `toLocus`, when given, is an exact scan match — more precise than the
      page number, which is then derived from it rather than typed */
  finish(toPage: number, note?: string, toLocus?: Locus): Promise<void>;

  /** backfill a session you forgot to time */
  logManual(input: {
    deviceBookId: string;
    start: number;
    ms: number;
    fromPage: number;
    toPage: number;
    toLocus?: Locus;
    note?: string;
  }): Promise<void>;
  removeSession(id: number): Promise<void>;
  clearReceipt(): void;

  /** push the library's own reading position into any linked reader book,
      forward-only — the other half of `recomputeBook`, which pushes the
      other way. Called from the library store as you read in the app. */
  pullFromLibrary(bookId: string, locus: Locus): Promise<void>;
}

export const useDevice = create<DeviceState>((set, get) => ({
  books: [],
  sessions: [],
  timer: null,
  loaded: false,
  lastSync: null,

  async load() {
    const [books, sessions, timerRow] = await Promise.all([
      db.deviceBooks.orderBy('addedAt').reverse().toArray(),
      db.deviceSessions.toArray(),
      db.settings.get(TIMER_KEY),
    ]);
    set({
      books,
      sessions: sessions.sort((a, b) => b.start - a.start),
      timer: (timerRow?.value as TimerState) ?? null,
      loaded: true,
    });
  },

  async addBook(input) {
    const now = Date.now();
    const id = uid();
    const record: DeviceBookRecord = {
      id,
      title: input.title.trim(),
      author: (input.author ?? '').trim(),
      pages: Math.max(1, Math.round(input.pages)),
      startPage: Math.max(1, Math.round(input.startPage ?? 1)),
      currentPage: Math.max(0, Math.round(input.currentPage ?? 0)),
      device: input.device?.trim() || undefined,
      addedAt: now,
      updatedAt: now,
      hue: Math.floor(Math.random() * 360),
    };

    // link on the way in, so the first session already knows where to land
    const match = findMatch(record, libraryCandidates());
    if (match) record.bookId = match;

    await db.deviceBooks.put(record);
    // a book can arrive already partway read — a linked pick from the
    // library, or a starting page typed in on the way — and that position
    // is exactly what the library push exists to notice, same as any later
    // update to it
    if (record.bookId) await recomputeBook(id);
    await get().load();
    changed();
    return id;
  },

  async updateBook(id, patch) {
    const next = { ...patch, updatedAt: Date.now() };
    await db.deviceBooks.update(id, next);

    /* Changing the page count changes what every past session meant, and
       moving the current page — whether typed or set from a scan, e.g. the
       standalone "Scan my page" button, which patches only `currentPage`/
       `currentLocus` and never touches a session — is itself the position
       the library push in `recomputeBook` exists to notice. Recomputing on
       any of the four keeps the two rules from stage 1 and stage 2 in sync
       with what actually changed, rather than silently skipping the push
       whenever nothing about the book's *geometry* changed. */
    if (
      patch.pages != null ||
      patch.startPage != null ||
      patch.bookId !== undefined ||
      patch.currentPage != null
    ) {
      await recomputeBook(id);
    }
    await get().load();
    changed();
  },

  async removeBook(id) {
    await deleteDeviceBook(id);
    if (get().timer?.deviceBookId === id) await writeTimer(null);
    await get().load();
    await useLibrary.getState().load();
    changed();
  },

  async link(id, bookId) {
    await db.deviceBooks.update(id, {
      bookId: bookId ?? undefined,
      linkPinned: true,
      updatedAt: Date.now(),
    });
    await recomputeBook(id);
    await get().load();
    await useLibrary.getState().load();
    changed();
  },

  async autoLink() {
    const candidates = libraryCandidates();
    const books = await db.deviceBooks.toArray();
    let linked = 0;
    for (const b of books) {
      if (b.bookId || b.linkPinned) continue;
      const match = findMatch(b, candidates);
      if (!match) continue;
      await db.deviceBooks.update(b.id, { bookId: match, updatedAt: Date.now() });
      await recomputeBook(b.id);
      linked++;
    }
    if (linked) {
      await get().load();
      await useLibrary.getState().load();
      changed();
    }
    return linked;
  },

  /* ── timer ───────────────────────────────────────────────────── */

  async start(deviceBookId, fromPage) {
    const book = get().books.find((b) => b.id === deviceBookId);
    const now = Date.now();
    const timer: TimerState = {
      deviceBookId,
      startedAt: now,
      accumulatedMs: 0,
      runningSince: now,
      fromPage: fromPage ?? book?.currentPage ?? Math.max(0, (book?.startPage ?? 1) - 1),
    };
    await writeTimer(timer);
    set({ timer, lastSync: null });
  },

  async pause() {
    const t = get().timer;
    if (!t?.runningSince) return;
    const paused: TimerState = {
      ...t,
      accumulatedMs: elapsedOf(t),
      runningSince: null,
    };
    await writeTimer(paused);
    set({ timer: paused });
  },

  async resume() {
    const t = get().timer;
    if (!t || t.runningSince) return;
    const running: TimerState = { ...t, runningSince: Date.now() };
    await writeTimer(running);
    set({ timer: running });
  },

  async discard() {
    await writeTimer(null);
    set({ timer: null });
  },

  async finish(toPage, note, toLocus) {
    const t = get().timer;
    if (!t) return;
    const ms = elapsedOf(t);
    await writeTimer(null);
    set({ timer: null });
    await get().logManual({
      deviceBookId: t.deviceBookId,
      start: t.startedAt,
      ms,
      fromPage: t.fromPage,
      toPage,
      toLocus,
      note,
    });
  },

  /* ── recording ───────────────────────────────────────────────── */

  async logManual({ deviceBookId, start, ms, fromPage, toPage, toLocus, note }) {
    const book = await db.deviceBooks.get(deviceBookId);
    if (!book) return;

    const from = Math.max(0, Math.round(fromPage));
    /* a scan match is the real stopping point; the typed page number is
       only ever a fallback for it, so when both are present the locus wins */
    const rawTo = toLocus ? percentToPage(book, toLocus.percent) : Math.round(toPage);
    const to = Math.min(book.pages, Math.max(from, rawTo));
    const pages = to - from;

    const record: DeviceSessionRecord = {
      uid: uid(),
      deviceBookId,
      start,
      end: start + Math.max(0, ms),
      ms: Math.max(0, Math.round(ms)),
      fromPage: from,
      toPage: to,
      pages,
      words: 0, // filled by the reconciler, which knows the linked book
      note: note?.trim() || undefined,
      updatedAt: Date.now(),
      ...(toLocus
        ? { toSpineIndex: toLocus.spineIndex, toWordIndex: toLocus.wordIndex, toPercent: toLocus.percent }
        : {}),
    };
    await db.deviceSessions.add(record);

    /* the page you reached is the book's position now — this is the number
       the whole feature exists to move */
    if (to > book.currentPage) {
      await db.deviceBooks.update(deviceBookId, {
        currentPage: to,
        updatedAt: Date.now(),
        ...(toLocus ? { currentLocus: toLocus } : {}),
        ...(to >= book.pages ? { finishedAt: Date.now() } : {}),
      });
    }

    const receipt = await recomputeBook(deviceBookId);
    await get().load();
    await useLibrary.getState().load();
    set({
      lastSync: receipt && {
        title: book.title,
        from: receipt.before,
        to: receipt.after,
        moved: receipt.moved,
      },
    });
    changed();
  },

  async pullFromLibrary(bookId, locus) {
    const linked = await db.deviceBooks.where('bookId').equals(bookId).toArray();
    if (!linked.length) return;

    let moved = false;
    for (const book of linked) {
      const target = percentToPage(book, locus.percent);
      // forward-only, same rule as recomputeBook's device→library push —
      // reading further in the app pulls the reader card along, never back
      if (target > book.currentPage) {
        await db.deviceBooks.update(book.id, {
          currentPage: target,
          currentLocus: locus,
          updatedAt: Date.now(),
          ...(target >= book.pages ? { finishedAt: Date.now() } : {}),
        });
        moved = true;
      }
    }
    if (moved) {
      await get().load();
      changed();
    }
  },

  async removeSession(id) {
    const row = await db.deviceSessions.get(id);
    if (!row) return;
    if (row.mirrorUid) {
      const mirror = await db.sessions.where('uid').equals(row.mirrorUid).first();
      if (mirror?.id != null) await db.sessions.delete(mirror.id);
    }
    await db.deviceSessions.delete(id);
    if (row.uid) {
      await db.tombstones.put({
        key: `device_sessions:${row.uid}`,
        table: 'device_sessions',
        uid: row.uid,
        at: Date.now(),
      });
    }
    await recomputeBook(row.deviceBookId);
    await get().load();
    await useLibrary.getState().load();
    changed();
  },

  clearReceipt() {
    set({ lastSync: null });
  },
}));

/* ── helpers ───────────────────────────────────────────────────── */

async function writeTimer(t: TimerState | null): Promise<void> {
  if (t) await db.settings.put({ key: TIMER_KEY, value: t });
  else await db.settings.delete(TIMER_KEY);
}

const libraryCandidates = () =>
  useLibrary.getState().books.map((b) => ({
    id: b.id,
    title: b.meta.title ?? '',
    author: b.meta.author ?? '',
  }));

export interface Receipt {
  /** library percent before this reconciliation */
  before: number;
  after: number;
  /** false when the app was already further along and kept its place */
  moved: boolean;
}

/**
 * Rebuild everything derived from one reader book: the word value of each
 * session, its mirror in the library's history, and the reading position.
 *
 * Written as a full recompute rather than an incremental update because the
 * inputs are editable — page counts get corrected, links get changed — and
 * a derivation you can re-run from scratch can never drift out of step with
 * what it was derived from.
 */
export async function recomputeBook(deviceBookId: string): Promise<Receipt | null> {
  const book = await db.deviceBooks.get(deviceBookId);
  if (!book) return null;

  const sessions = await db.deviceSessions.where('deviceBookId').equals(deviceBookId).toArray();
  const linked = book.bookId ? await db.books.get(book.bookId) : undefined;
  const totalWords = linked?.totalWords;

  /* 1 ─ word value of each session, and its mirror in library history */
  for (const s of sessions) {
    const words = pagesToWords(book, s.pages, totalWords);
    const mirror: Session = {
      uid: s.mirrorUid ?? s.uid ?? newUid(),
      bookId: book.bookId ?? '',
      start: s.start,
      end: s.end,
      ms: s.ms,
      words,
      pages: s.pages,
      pacedMs: 0,
      source: 'device',
    };

    if (s.words !== words || !s.mirrorUid) {
      await db.deviceSessions.update(s.id as number, {
        words,
        mirrorUid: mirror.uid,
        updatedAt: Date.now(),
      });
    }

    const existing = await db.sessions.where('uid').equals(mirror.uid as string).first();
    if (!book.bookId) {
      /* unlinked: the session is real reading and belongs in your totals,
         but it has no book to attach to. Keep it under a stable synthetic
         id so time, streaks and words all still count. */
      mirror.bookId = `device:${book.id}`;
    }
    if (existing?.id != null) await db.sessions.update(existing.id, mirror);
    else await db.sessions.add(mirror);
  }

  /* 2 ─ position, forward only */
  if (!book.bookId || !linked) return null;

  const pageDerivedPercent = pageToPercent(book, book.currentPage);

  /* `currentLocus` is an exact stamp — a scan match, or a position pulled
     straight from the library — but it is only trusted while it still
     agrees with `currentPage`. A page typed by hand afterwards, or a page
     count correction, moves `currentPage` without touching the locus, and
     from then on the two disagree by more than a page's worth: proof the
     locus is stale, so falling back to the page-based estimate is what
     keeps a mistyped page from landing on an old, now-wrong, exact spot. */
  const tolerance = 1 / bodyPages(book) + 0.0005;
  const trustedLocus =
    book.currentLocus && Math.abs(book.currentLocus.percent - pageDerivedPercent) <= tolerance
      ? book.currentLocus
      : null;

  const percent = trustedLocus?.percent ?? pageDerivedPercent;
  const current = await db.progress.get(book.bookId);
  const before = current?.percent ?? 0;

  if (percent <= before + 0.0005) {
    return { before, after: before, moved: false };
  }

  const locus = trustedLocus ?? percentToLocus(linked.spine, percent);
  await db.progress.put({
    bookId: book.bookId,
    spineIndex: locus.spineIndex,
    wordIndex: locus.wordIndex,
    percent,
    updatedAt: Date.now(),
  });

  if (percent >= 0.985 && !linked.finishedAt) {
    const at = Date.now();
    await db.books.update(linked.id, { finishedAt: at, updatedAt: at });
  }

  return { before, after: percent, moved: true };
}
