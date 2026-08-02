/* The rating shelf.
 *
 * Small store, one job: hold every rating and let a screen write one. The
 * interesting decisions are all about identity —
 *
 *   A rating is keyed by its own id, not by the book's. That is what lets
 *   it survive the book being deleted, and what lets you rate something you
 *   only ever read on paper.
 *
 *   `rate()` is an upsert on the *subject*, not on the id. Rating the same
 *   book twice edits the first verdict rather than putting two spines on
 *   the wall, which is what anyone tapping "Rate" a second time means.
 *
 *   Title and author are copied in at write time and never refreshed. If
 *   the book is gone the copy is all there is, and if it isn't, the copy is
 *   still what you rated — re-importing a different edition should not
 *   quietly retitle your opinion of the old one.
 */

import { create } from 'zustand';
import { db, deleteRating, newUid } from '../db';
import {
  WORDS_PER_PAGE,
  clampScore,
  type AxisKey,
  type MoodKey,
  type RatingRecord,
} from '../engine/rating';
import { totals, type Session } from '../engine/stats';
import { useLibrary } from './library';
import { useDevice } from './device';

/* Same event the library and device stores raise: sync is listening, and
   going through the DOM rather than an import keeps this file unaware that
   a server exists at all. */
const changed = (): void => {
  dispatchEvent(new CustomEvent('soluna:changed'));
};

/** What a screen hands in. Everything but the subject is optional. */
export interface RatingDraft {
  bookId?: string;
  deviceBookId?: string;
  title: string;
  author: string;
  overall: number;
  axes?: Partial<Record<AxisKey, number>>;
  mood?: MoodKey;
  note?: string;
  favourite?: boolean;
  words?: number;
}

interface RatingState {
  ratings: RatingRecord[];
  loaded: boolean;

  load(): Promise<void>;
  /** create or update the rating of a book; returns the rating id */
  rate(draft: RatingDraft): Promise<string>;
  update(id: string, patch: Partial<RatingRecord>): Promise<void>;
  remove(id: string): Promise<void>;
  toggleFavourite(id: string): Promise<void>;
  /** the existing rating of a library or device book, if any */
  forBook(bookId: string): RatingRecord | undefined;
  forDeviceBook(deviceBookId: string): RatingRecord | undefined;
}

/* Sorted newest-rated first in the store, and re-sorted by the wall to
   whatever it is showing. Having one defined order here means a list
   rendered without sorting is still stable rather than in IndexedDB's. */
const order = (rs: RatingRecord[]): RatingRecord[] =>
  [...rs].sort((a, b) => b.ratedAt - a.ratedAt);

export const useRatings = create<RatingState>((set, get) => ({
  ratings: [],
  loaded: false,

  async load() {
    set({ ratings: order(await db.ratings.toArray()), loaded: true });
  },

  async rate(draft) {
    const now = Date.now();
    const existing = draft.bookId
      ? get().forBook(draft.bookId)
      : draft.deviceBookId
        ? get().forDeviceBook(draft.deviceBookId)
        : undefined;

    const record: RatingRecord = {
      id: existing?.id ?? newUid(),
      ...(draft.bookId ? { bookId: draft.bookId } : {}),
      ...(draft.deviceBookId ? { deviceBookId: draft.deviceBookId } : {}),
      title: draft.title.trim() || 'Untitled',
      author: draft.author.trim(),
      overall: clampScore(draft.overall),
      axes: pruneAxes(draft.axes),
      ...(draft.mood ? { mood: draft.mood } : {}),
      ...(draft.note?.trim() ? { note: draft.note.trim().slice(0, 240) } : {}),
      ...(draft.favourite ? { favourite: true } : {}),
      ...(draft.words ? { words: Math.round(draft.words) } : {}),
      // re-rating keeps the date you first formed the opinion
      ratedAt: existing?.ratedAt ?? now,
      updatedAt: now,
    };

    await db.ratings.put(record);
    set({ ratings: order([...get().ratings.filter((r) => r.id !== record.id), record]) });
    changed();
    return record.id;
  },

  async update(id, patch) {
    const current = get().ratings.find((r) => r.id === id);
    if (!current) return;
    const next: RatingRecord = { ...current, ...patch, id, updatedAt: Date.now() };
    if (patch.overall !== undefined) next.overall = clampScore(patch.overall);
    // same rule as on create: a zero here is an axis nobody judged
    if (patch.axes !== undefined) next.axes = pruneAxes(patch.axes);
    await db.ratings.put(next);
    set({ ratings: order(get().ratings.map((r) => (r.id === id ? next : r))) });
    changed();
  },

  async remove(id) {
    await deleteRating(id);
    set({ ratings: get().ratings.filter((r) => r.id !== id) });
    changed();
  },

  async toggleFavourite(id) {
    const current = get().ratings.find((r) => r.id === id);
    if (!current) return;
    await get().update(id, { favourite: !current.favourite });
  },

  forBook(bookId) {
    return get().ratings.find((r) => r.bookId === bookId);
  },

  forDeviceBook(deviceBookId) {
    return get().ratings.find((r) => r.deviceBookId === deviceBookId);
  },
}));

/* An axis left alone is absent, not zero. Storing a 0 for an axis nobody
   touched would drag every average down and tell the taste profile that
   this reader despises characters. */
function pruneAxes(
  axes: Partial<Record<AxisKey, number>> | undefined
): Partial<Record<AxisKey, number>> {
  const out: Partial<Record<AxisKey, number>> = {};
  for (const [k, v] of Object.entries(axes ?? {})) {
    if (typeof v === 'number' && v > 0) out[k as AxisKey] = clampScore(v);
  }
  return out;
}

/* ── what the shelves know about a book ──────────────────────────── */

/** Everything rateable, whether it has an EPUB here or not. */
export interface Rateable {
  key: string;
  bookId?: string;
  deviceBookId?: string;
  title: string;
  author: string;
  words?: number;
  /** finished, so worth putting at the top of the "rate something" list */
  finished: boolean;
  /** 0–1 */
  percent: number;
}

/* Read straight from the other two stores rather than mirrored into this
   one. A rating screen wants the union of both shelves and nothing else
   does, so building it on demand beats keeping a third copy in step. */
export function rateableBooks(): Rateable[] {
  const { books, progress } = useLibrary.getState();
  const device = useDevice.getState().books;

  const out: Rateable[] = books.map((b) => ({
    key: `b:${b.id}`,
    bookId: b.id,
    title: b.meta.title,
    author: b.meta.author ?? '',
    words: b.totalWords,
    finished: Boolean(b.finishedAt),
    percent: progress[b.id]?.percent ?? 0,
  }));

  for (const d of device) {
    // a linked reader book is the same book — don't offer it twice
    if (d.bookId && books.some((b) => b.id === d.bookId)) continue;
    const body = Math.max(1, d.pages - d.startPage + 1);
    out.push({
      key: `d:${d.id}`,
      deviceBookId: d.id,
      title: d.title,
      author: d.author,
      words: body * WORDS_PER_PAGE,
      finished: Boolean(d.finishedAt),
      percent: Math.min(1, Math.max(0, (d.currentPage - d.startPage + 1) / body)),
    });
  }

  /* Finished books first, then the furthest through — the order in which
     you are likely to have an opinion ready. */
  return out.sort(
    (a, b) => Number(b.finished) - Number(a.finished) || b.percent - a.percent
  );
}

/* ── what the shelves know about a book's *progress*, for the rating sheet ──
 *
 * A rating is written once (or occasionally revised), but the reading it is
 * about keeps accumulating sessions the whole time the sheet can be open.
 * Nothing here is stored on the rating record — it is read fresh from the
 * library and device stores every time, the same way `rateableBooks()` is,
 * so the numbers never have their own staleness to worry about.
 */
export interface BookProgressStats {
  /** false once the book/device entry has been deleted — the rating survives, this doesn't */
  present: boolean;
  /** 0–1 */
  percent: number;
  finished: boolean;
  /** first session ever logged, falling back to when the book was added */
  startedAt: number | null;
  finishedAt: number | null;
  ms: number;
  words: number;
  sessions: number;
  daysRead: number;
  avgWpm: number;
}

const EMPTY_PROGRESS: BookProgressStats = {
  present: false,
  percent: 0,
  finished: false,
  startedAt: null,
  finishedAt: null,
  ms: 0,
  words: 0,
  sessions: 0,
  daysRead: 0,
  avgWpm: 0,
};

const fromSessions = (sessions: Session[], addedAt?: number): Pick<
  BookProgressStats,
  'startedAt' | 'ms' | 'words' | 'sessions' | 'daysRead' | 'avgWpm'
> => {
  const t = totals(sessions);
  const first = sessions.length ? Math.min(...sessions.map((s) => s.start)) : null;
  return {
    startedAt: first ?? addedAt ?? null,
    ms: t.ms,
    words: t.words,
    sessions: t.sessions,
    daysRead: t.daysRead,
    avgWpm: t.avgWpm,
  };
};

/** Reading progress for whichever book a rating (or a candidate to be rated)
    points at. Give it `bookId` for a library book, `deviceBookId` for a
    reader-shelf one — a `Rateable` and a `RatingRecord` both carry exactly
    one of the two, which is what this mirrors. */
export function statsFor(bookId?: string, deviceBookId?: string): BookProgressStats {
  const lib = useLibrary.getState();

  if (bookId) {
    const book = lib.books.find((b) => b.id === bookId);
    if (!book) return EMPTY_PROGRESS;
    const sessions = lib.sessions.filter((s) => s.bookId === bookId);
    return {
      present: true,
      percent: lib.progress[bookId]?.percent ?? 0,
      finished: Boolean(book.finishedAt),
      finishedAt: book.finishedAt ?? null,
      ...fromSessions(sessions, book.addedAt),
    };
  }

  if (deviceBookId) {
    const device = useDevice.getState();
    const book = device.books.find((b) => b.id === deviceBookId);
    if (!book) return EMPTY_PROGRESS;
    /* A device book still waiting to be linked mirrors its sessions into the
       library under this synthetic key — see `recomputeBook` in
       `store/device.ts`. Once it *is* linked, its history lives under the
       linked bookId instead, but `rateableBooks()` never hands out a
       `deviceBookId` for a linked book, so that case doesn't reach here. */
    const sessions = lib.sessions.filter((s) => s.bookId === `device:${deviceBookId}`);
    const bodyPages = Math.max(1, book.pages - book.startPage + 1);
    const percent = Math.min(1, Math.max(0, (book.currentPage - book.startPage + 1) / bodyPages));
    return {
      present: true,
      percent,
      finished: Boolean(book.finishedAt),
      finishedAt: book.finishedAt ?? null,
      ...fromSessions(sessions, book.addedAt),
    };
  }

  return EMPTY_PROGRESS;
}
