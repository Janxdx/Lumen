import { create } from 'zustand';
import {
  db,
  deleteBook,
  newUid,
  requestPersistence,
  type BookRecord,
  type ProgressRecord,
} from '../db';
import { parseEpub } from '../engine/epub/parse';
import type { Session } from '../engine/stats';

/* Announce a local write. The sync module listens and pushes shortly after;
   going through an event rather than importing it keeps the library store
   unaware that a server exists at all — it still works with sync switched
   off, and there is no import cycle between the two. */
const changed = (): void => {
  dispatchEvent(new CustomEvent('lumen:changed'));
};

interface LibraryState {
  books: BookRecord[];
  progress: Record<string, ProgressRecord>;
  covers: Record<string, string>; // bookId → object URL
  sessions: Session[];
  loading: boolean;
  importing: string | null;

  load(): Promise<void>;
  importFile(file: File): Promise<string>;
  remove(bookId: string): Promise<void>;
  saveProgress(p: ProgressRecord): Promise<void>;
  recordSession(s: Session): Promise<void>;
}

const uid = (): string =>
  (crypto.randomUUID?.() ?? `b${Date.now()}${Math.random().toString(36).slice(2)}`);

export const useLibrary = create<LibraryState>((set, get) => ({
  books: [],
  progress: {},
  covers: {},
  sessions: [],
  loading: true,
  importing: null,

  async load() {
    const [books, progressRows, coverRows, sessions] = await Promise.all([
      db.books.orderBy('addedAt').reverse().toArray(),
      db.progress.toArray(),
      db.covers.toArray(),
      db.sessions.toArray(),
    ]);

    const progress: Record<string, ProgressRecord> = {};
    for (const p of progressRows) progress[p.bookId] = p;

    const covers: Record<string, string> = { ...get().covers };
    for (const c of coverRows) {
      if (!covers[c.bookId]) covers[c.bookId] = URL.createObjectURL(c.blob);
    }

    set({ books, progress, covers, sessions, loading: false });
  },

  async importFile(file) {
    set({ importing: file.name });
    try {
      const data = await file.arrayBuffer();
      const { book } = await parseEpub(data);

      // same title + author already present? replace rather than duplicate
      const existing = get().books.find(
        (b) => b.meta.title === book.meta.title && b.meta.author === book.meta.author
      );
      if (existing) return existing.id;

      const id = uid();
      const record: BookRecord = {
        id,
        meta: book.meta,
        spine: book.spine,
        toc: book.toc,
        totalWords: book.totalWords,
        addedAt: Date.now(),
        hue: Math.floor(Math.random() * 360),
        updatedAt: Date.now(),
      };

      await db.transaction('rw', [db.books, db.files, db.covers], async () => {
        await db.books.put(record);
        await db.files.put({ bookId: id, data, size: file.size });
        if (book.coverBlob) await db.covers.put({ bookId: id, blob: book.coverBlob });
      });

      void requestPersistence();
      await get().load();
      changed();
      return id;
    } finally {
      set({ importing: null });
    }
  },

  async remove(bookId) {
    const url = get().covers[bookId];
    if (url) URL.revokeObjectURL(url);
    await deleteBook(bookId);
    const covers = { ...get().covers };
    delete covers[bookId];
    set({ covers });
    await get().load();
    changed();
  },

  async saveProgress(p) {
    await db.progress.put(p);
    set((s) => ({ progress: { ...s.progress, [p.bookId]: p } }));
    if (p.percent >= 0.985) {
      const book = get().books.find((b) => b.id === p.bookId);
      if (book && !book.finishedAt) {
        const at = Date.now();
        await db.books.update(p.bookId, { finishedAt: at, updatedAt: at });
        set((s) => ({
          books: s.books.map((b) =>
            b.id === p.bookId ? { ...b, finishedAt: at, updatedAt: at } : b
          ),
        }));
      }
    }
    changed();
  },

  async recordSession(s) {
    if (s.ms < 5000) return; // ignore accidental opens
    const record: Session = { ...s, uid: s.uid ?? newUid() };
    const id = await db.sessions.add(record);
    set((state) => ({ sessions: [...state.sessions, { ...record, id: id as number }] }));
    changed();
  },
}));
