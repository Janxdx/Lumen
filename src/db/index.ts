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

/** A record deleted locally, kept until the deletion has reached the server. */
export interface TombstoneRecord {
  /** `${table}:${uid}` */
  key: string;
  table: 'books' | 'bookmarks';
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

/** Free the local EPUB but keep the book in the library (it lives in the cloud). */
export async function evictFile(bookId: string): Promise<void> {
  await db.transaction('rw', [db.files, db.books], async () => {
    await db.files.delete(bookId);
    await db.books.update(bookId, { fileMissing: true });
  });
}
