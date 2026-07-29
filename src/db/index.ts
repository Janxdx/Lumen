import Dexie, { type Table } from 'dexie';
import type { BookMeta, SpineEntry, TocEntry } from '../engine/types';
import type { Session } from '../engine/stats';

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

export interface CoverRecord {
  bookId: string;
  blob: Blob;
}

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
}

/** A record deleted locally, kept until the deletion has reached the server. */
export interface TombstoneRecord {
  /** `${table}:${uid}` */
  key: string;
  table: 'books' | 'bookmarks' | 'device_books' | 'device_sessions';
  uid: string;
  at: number;
}

export const newUid = (): string =>
  crypto.randomUUID?.() ?? `u${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;

class LumenDB extends Dexie {
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

  constructor() {
    super('lumen');
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
  }
}

export const db = new LumenDB();

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
    [db.books, db.files, db.covers, db.progress, db.bookmarks, db.tombstones],
    async () => {
      const marks = await db.bookmarks.where('bookId').equals(bookId).toArray();
      const now = Date.now();

      await db.books.delete(bookId);
      await db.files.delete(bookId);
      await db.covers.delete(bookId);
      await db.progress.delete(bookId);
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
    [db.deviceBooks, db.deviceSessions, db.sessions, db.tombstones],
    async () => {
      const logged = await db.deviceSessions.where('deviceBookId').equals(id).toArray();
      const now = Date.now();

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

/** Free the local EPUB but keep the book in the library (it lives in the cloud). */
export async function evictFile(bookId: string): Promise<void> {
  await db.transaction('rw', [db.files, db.books], async () => {
    await db.files.delete(bookId);
    await db.books.update(bookId, { fileMissing: true });
  });
}
