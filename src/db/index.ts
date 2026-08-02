import Dexie, { type Table } from 'dexie';
import type { BookMeta, SpineEntry, TocEntry } from '../engine/types';
import type { Session } from '../engine/stats';
import type { RatingRecord } from '../engine/rating';
import type { PackedPassageIndex } from '../engine/passageStore';

export interface BookRecord {
  id: string;
  meta: BookMeta;
  spine: SpineEntry[];
  toc: TocEntry[];
  totalWords: number;
  addedAt: number;
  /** stable gradient seed for the fallback cover */
  hue: number;
  finishedAt?: number;
  /** last local edit, epoch ms — drives last-write-wins during sync */
  updatedAt?: number;
  /** storage object path once the EPUB has been uploaded */
  filePath?: string;
  coverPath?: string;
  /** true when the row came from the server but the file isn't downloaded yet */
  fileMissing?: boolean;
}

export interface FileRecord {
  bookId: string;
  data: ArrayBuffer;
  size: number;
}

/* Covers are held as raw bytes, never as a Blob.

   Storing a Blob in IndexedDB is legal on paper and unreliable in practice:
   the browser has to hand the blob's backing file to the object store, and
   when that backing is still owned by something else — a fetch response that
   hasn't fully settled, or a view into a buffer being written in the same
   transaction — Chromium aborts the whole write with

     UnknownError: Error preparing Blob/File data to be stored in object store

   which takes the enclosing sync transaction down with it. An ArrayBuffer is
   plain structured-clone data with no such handshake, so it always lands. */
export interface CoverRecord {
  bookId: string;
  data: ArrayBuffer;
  /** image mime type, needed to rebuild a displayable Blob */
  type: string;
  /** rows written by earlier builds, which stored a Blob directly */
  blob?: Blob;
}

/** A cover as something the DOM can show, whichever way the row was written. */
export const coverToBlob = (c: CoverRecord): Blob =>
  c.blob ?? new Blob([c.data], { type: c.type || 'image/jpeg' });

export interface ProgressRecord {
  bookId: string;
  spineIndex: number;
  wordIndex: number;
  /** 0–1, computed from words read across the whole spine */
  percent: number;
  updatedAt: number;
}

export interface BookmarkRecord {
  id?: number;
  /** stable cross-device identity; the numeric `id` is local to this browser */
  uid?: string;
  bookId: string;
  spineIndex: number;
  wordIndex: number;
  excerpt: string;
  createdAt: number;
  updatedAt?: number;
}

export interface SettingsRecord {
  key: string;
  value: unknown;
}

/* ── the device shelf ──────────────────────────────────────────────
   Books read on a physical e-ink reader. They have no EPUB here and no
   word positions of their own — only a page count, which is the single
   number that lets a session logged on the reader be translated into the
   percentage this app speaks in. */

export interface DeviceBookRecord {
  id: string;
  title: string;
  author: string;
  /** number of the last page of the book as the reader counts them */
  pages: number;
  /** first page of the body text — front matter would otherwise skew every % */
  startPage: number;
  /** page the reader is on now (last page read) */
  currentPage: number;
  /** linked book in the library, when one matches */
  bookId?: string;
  /** true once a link has been confirmed or deliberately broken by hand,
      so auto-matching never overrules a decision you already made */
  linkPinned?: boolean;
  /** e.g. "Kobo Libra", shown on the card */
  device?: string;
  addedAt: number;
  updatedAt: number;
  finishedAt?: number;
  /** stable gradient seed, same idea as BookRecord.hue */
  hue: number;
  /** exact position `currentPage` was set from — a scan match or a library
      read — kept alongside the page number rather than instead of it, since
      pace math and the shelf card still want a plain integer. Only trusted
      by `recomputeBook` while it agrees with `currentPage` within about a
      page; a page typed by hand afterwards silently outruns it and it goes
      back to being unused rather than wrong. See `store/device.ts`. */
  currentLocus?: { spineIndex: number; wordIndex: number; percent: number };
}

export interface DeviceSessionRecord {
  id?: number;
  /** stable across devices */
  uid?: string;
  deviceBookId: string;
  start: number;
  end: number;
  /** active time, pauses excluded */
  ms: number;
  fromPage: number;
  toPage: number;
  /** toPage − fromPage, stored so an edited page count can't rewrite history */
  pages: number;
  /** words this is worth, from the linked book's density (0 when unknown) */
  words: number;
  /** uid of the mirrored library session, so an edit updates rather than duplicates */
  mirrorUid?: string;
  note?: string;
  updatedAt: number;
  /** where a scan matched the stopping point, when this session was logged
      that way — the exact position, kept separately from the derived
      `toPage` so later reconciliation doesn't have to re-approximate it */
  toSpineIndex?: number;
  toWordIndex?: number;
  toPercent?: number;
}

/* ── the passage index ─────────────────────────────────────────────
   Derived data: everything here can be rebuilt from the EPUB, which is why
   it never syncs and why it is safe to evict. It is cached only because
   building it costs about a second of CPU and a scan should feel instant
   the second time you use it on the same book. */

export interface PassageIndexRecord {
  bookId: string;
  /** `packIndex` output — typed arrays only, so IndexedDB stores it flat */
  packed: PackedPassageIndex;
  /** bytes, approximately — what the eviction policy sorts on */
  size: number;
  builtAt: number;
  /** last scan that used it, for LRU eviction */
  usedAt: number;
}

/** A record deleted locally, kept until the deletion has reached the server. */
export interface TombstoneRecord {
  /** `${table}:${uid}` */
  key: string;
  table: 'books' | 'bookmarks' | 'device_books' | 'device_sessions' | 'ratings';
  uid: string;
  at: number;
}

export const newUid = (): string =>
  crypto.randomUUID?.() ?? `u${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;

class SolunaDB extends Dexie {
  books!: Table<BookRecord, string>;
  files!: Table<FileRecord, string>;
  covers!: Table<CoverRecord, string>;
  progress!: Table<ProgressRecord, string>;
  sessions!: Table<Session, number>;
  bookmarks!: Table<BookmarkRecord, number>;
  settings!: Table<SettingsRecord, string>;
  tombstones!: Table<TombstoneRecord, string>;
  deviceBooks!: Table<DeviceBookRecord, string>;
  deviceSessions!: Table<DeviceSessionRecord, number>;
  ratings!: Table<RatingRecord, string>;
  passages!: Table<PassageIndexRecord, string>;

  constructor() {
    super('soluna');
    this.version(1).stores({
      books: 'id, addedAt, finishedAt',
      files: 'bookId',
      covers: 'bookId',
      progress: 'bookId, updatedAt',
      sessions: '++id, bookId, start',
      bookmarks: '++id, bookId, createdAt',
      settings: 'key',
    });

    /* v2 adds what sync needs: a stable uid on the two auto-increment tables
       (an auto-increment number means different things on different devices),
       change stamps, and tombstones so a delete propagates instead of the
       row simply reappearing on the next pull. */
    this.version(2)
      .stores({
        books: 'id, addedAt, finishedAt, updatedAt',
        files: 'bookId',
        covers: 'bookId',
        progress: 'bookId, updatedAt',
        sessions: '++id, bookId, start, &uid',
        bookmarks: '++id, bookId, createdAt, &uid, updatedAt',
        settings: 'key',
        tombstones: 'key, at',
      })
      .upgrade(async (tx) => {
        await tx
          .table('books')
          .toCollection()
          .modify((b: BookRecord) => {
            b.updatedAt ??= b.addedAt || Date.now();
          });
        await tx
          .table('sessions')
          .toCollection()
          .modify((s: Session) => {
            s.uid ??= newUid();
          });
        await tx
          .table('bookmarks')
          .toCollection()
          .modify((m: BookmarkRecord) => {
            m.uid ??= newUid();
            m.updatedAt ??= m.createdAt;
          });
      });

    /* v3 adds the device shelf. No existing table changes shape, so there is
       no upgrade body — Dexie creates the two new stores and leaves the rest. */
    this.version(3).stores({
      books: 'id, addedAt, finishedAt, updatedAt',
      files: 'bookId',
      covers: 'bookId',
      progress: 'bookId, updatedAt',
      sessions: '++id, bookId, start, &uid',
      bookmarks: '++id, bookId, createdAt, &uid, updatedAt',
      settings: 'key',
      tombstones: 'key, at',
      deviceBooks: 'id, addedAt, updatedAt, bookId',
      deviceSessions: '++id, deviceBookId, start, &uid, updatedAt',
    });

    /* v4 adds ratings. The primary key is client-generated rather than
       auto-incremented, like books and device books, because a rating has
       to be the same row on every device — and unlike bookmarks it does not
       need a separate uid, since it never had a local numeric identity to
       be stuck with. `bookId` and `deviceBookId` are indexed so the two
       shelves can ask "is this one rated?" without a table scan per cover. */
    this.version(4).stores({
      books: 'id, addedAt, finishedAt, updatedAt',
      files: 'bookId',
      covers: 'bookId',
      progress: 'bookId, updatedAt',
      sessions: '++id, bookId, start, &uid',
      bookmarks: '++id, bookId, createdAt, &uid, updatedAt',
      settings: 'key',
      tombstones: 'key, at',
      deviceBooks: 'id, addedAt, updatedAt, bookId',
      deviceSessions: '++id, deviceBookId, start, &uid, updatedAt',
      ratings: 'id, bookId, deviceBookId, ratedAt, overall, updatedAt',
    });

    /* v5 adds the passage index cache. Nothing else changes shape. It is the
       first table in this database that holds no user data at all — only a
       restatement of the EPUB — so it is deliberately outside sync and
       outside the tombstone machinery: dropping a row loses nothing but a
       second of CPU. */
    this.version(5).stores({
      books: 'id, addedAt, finishedAt, updatedAt',
      files: 'bookId',
      covers: 'bookId',
      progress: 'bookId, updatedAt',
      sessions: '++id, bookId, start, &uid',
      bookmarks: '++id, bookId, createdAt, &uid, updatedAt',
      settings: 'key',
      tombstones: 'key, at',
      deviceBooks: 'id, addedAt, updatedAt, bookId',
      deviceSessions: '++id, deviceBookId, start, &uid, updatedAt',
      ratings: 'id, bookId, deviceBookId, ratedAt, overall, updatedAt',
      passages: 'bookId, usedAt',
    });
  }
}

export const db = new SolunaDB();

/** Ask Safari not to evict the library. Only granted for installed PWAs. */
export async function requestPersistence(): Promise<boolean> {
  if (!navigator.storage?.persist) return false;
  if (await navigator.storage.persisted?.()) return true;
  try {
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

export async function estimateUsage(): Promise<{ used: number; quota: number }> {
  const e = await navigator.storage?.estimate?.();
  return { used: e?.usage ?? 0, quota: e?.quota ?? 0 };
}

export async function deleteBook(bookId: string): Promise<void> {
  await db.transaction(
    'rw',
    [
      db.books,
      db.files,
      db.covers,
      db.progress,
      db.bookmarks,
      db.ratings,
      db.tombstones,
      db.passages,
    ],
    async () => {
      /* The rating stays. It carries its own title and author precisely so
         that removing a 4 MB EPUB to free space does not also remove what
         you thought of it — but the pointer has to go, or the shelf would
         keep asking for a cover that isn't there. */
      await db.ratings
        .where('bookId')
        .equals(bookId)
        .modify((r) => {
          delete r.bookId;
          r.updatedAt = Date.now();
        });

      const marks = await db.bookmarks.where('bookId').equals(bookId).toArray();
      const now = Date.now();

      await db.books.delete(bookId);
      await db.files.delete(bookId);
      await db.covers.delete(bookId);
      await db.progress.delete(bookId);
      await db.passages.delete(bookId);
      await db.bookmarks.where('bookId').equals(bookId).delete();

      // remember the deletion so the next sync removes it server-side too,
      // instead of the book coming straight back on the following pull
      await db.tombstones.bulkPut([
        { key: `books:${bookId}`, table: 'books', uid: bookId, at: now },
        ...marks
          .filter((m) => m.uid)
          .map((m) => ({
            key: `bookmarks:${m.uid}`,
            table: 'bookmarks' as const,
            uid: m.uid as string,
            at: now,
          })),
      ]);
    }
  );
  // sessions are deliberately kept: deleting a book shouldn't rewrite history
}

/** Remove a tracked reader book and every session logged against it.
    Unlike the library, history goes with it: these sessions exist only as
    something you typed in, so keeping orphans would be keeping guesses. */
export async function deleteDeviceBook(id: string): Promise<void> {
  await db.transaction(
    'rw',
    [db.deviceBooks, db.deviceSessions, db.sessions, db.ratings, db.tombstones],
    async () => {
      const logged = await db.deviceSessions.where('deviceBookId').equals(id).toArray();
      const now = Date.now();

      // as with the library: the verdict outlives the book it was about
      await db.ratings
        .where('deviceBookId')
        .equals(id)
        .modify((r) => {
          delete r.deviceBookId;
          r.updatedAt = now;
        });

      // the mirrored library sessions go too, or the stats would double-count
      // reading that no longer has a book behind it
      const mirrors = logged.map((s) => s.mirrorUid).filter(Boolean) as string[];
      for (const uid of mirrors) {
        const mirror = await db.sessions.where('uid').equals(uid).first();
        if (mirror?.id != null) await db.sessions.delete(mirror.id);
      }

      await db.deviceBooks.delete(id);
      await db.deviceSessions.where('deviceBookId').equals(id).delete();

      await db.tombstones.bulkPut([
        { key: `device_books:${id}`, table: 'device_books', uid: id, at: now },
        ...logged
          .filter((s) => s.uid)
          .map((s) => ({
            key: `device_sessions:${s.uid}`,
            table: 'device_sessions' as const,
            uid: s.uid as string,
            at: now,
          })),
      ]);
    }
  );
}

/** Remove a rating, leaving a tombstone so the deletion reaches the server. */
export async function deleteRating(id: string): Promise<void> {
  await db.transaction('rw', [db.ratings, db.tombstones], async () => {
    await db.ratings.delete(id);
    await db.tombstones.put({
      key: `ratings:${id}`,
      table: 'ratings',
      uid: id,
      at: Date.now(),
    });
  });
}

/** Free the local EPUB but keep the book in the library (it lives in the cloud). */
export async function evictFile(bookId: string): Promise<void> {
  await db.transaction('rw', [db.files, db.books, db.passages], async () => {
    await db.files.delete(bookId);
    await db.books.update(bookId, { fileMissing: true });
    // the index is a restatement of a file that is no longer here
    await db.passages.delete(bookId);
  });
}

/** Total bytes held by cached passage indexes, above which the least
    recently used are dropped. Three or four novels' worth — enough that
    the books you actually scan stay warm, small enough that the cache
    never becomes the reason you run out of space. */
export const PASSAGE_CACHE_BUDGET = 24 * 1024 * 1024;

/** Drop least-recently-used indexes until the cache fits its budget.
    Called after a build, never on a read path. */
export async function trimPassageCache(
  budget = PASSAGE_CACHE_BUDGET
): Promise<void> {
  const rows = await db.passages.orderBy('usedAt').toArray(); // oldest first
  let total = rows.reduce((a, r) => a + r.size, 0);
  for (const row of rows) {
    if (total <= budget) break;
    await db.passages.delete(row.bookId);
    total -= row.size;
  }
}
