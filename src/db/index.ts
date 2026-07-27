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
  bookId: string;
  spineIndex: number;
  wordIndex: number;
  excerpt: string;
  createdAt: number;
}

export interface SettingsRecord {
  key: string;
  value: unknown;
}

class LumenDB extends Dexie {
  books!: Table<BookRecord, string>;
  files!: Table<FileRecord, string>;
  covers!: Table<CoverRecord, string>;
  progress!: Table<ProgressRecord, string>;
  sessions!: Table<Session, number>;
  bookmarks!: Table<BookmarkRecord, number>;
  settings!: Table<SettingsRecord, string>;

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
    [db.books, db.files, db.covers, db.progress, db.bookmarks],
    async () => {
      await db.books.delete(bookId);
      await db.files.delete(bookId);
      await db.covers.delete(bookId);
      await db.progress.delete(bookId);
      await db.bookmarks.where('bookId').equals(bookId).delete();
    }
  );
  // sessions are deliberately kept: deleting a book shouldn't rewrite history
}
