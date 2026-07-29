/* Two-way sync between the local Dexie database and Supabase.

   Shape of it:

     pull   — rows the server has stamped since our cursor
     merge  — last write wins, compared on the client-side `updatedAt`
     push   — local rows changed since the last push, plus tombstones
     files  — EPUBs and covers to and from object storage

   Two rules keep this honest. Reading never blocks on the network: every
   screen renders from Dexie and sync only ever writes into it afterwards.
   And the cursor is the *server's* clock (`synced_at`), never the device's,
   because two iPads whose clocks differ by a minute would otherwise take
   turns losing each other's changes. */

import { create } from 'zustand';
import {
  db,
  newUid,
  type BookRecord,
  type BookmarkRecord,
  type DeviceBookRecord,
  type DeviceSessionRecord,
  type ProgressRecord,
} from '../db';
import type { Session } from '../engine/stats';
import { useLibrary } from '../store/library';
import { useDevice } from '../store/device';
import { useSettings } from '../store/settings';
import { BUCKET, humanError, supabase, syncEnabled } from './client';
import {
  bookToRow,
  bookmarkToRow,
  deviceBookToRow,
  deviceSessionToRow,
  progressToRow,
  rowToBook,
  rowToBookmark,
  rowToDeviceBook,
  rowToDeviceSession,
  rowToProgress,
  rowToSession,
  sessionToRow,
  type BookRow,
  type BookmarkRow,
  type DeviceBookRow,
  type DeviceSessionRow,
  type ProgressRow,
  type SessionRow,
  type SettingsRow,
} from './mapping';

const META_KEY = 'sync';
const SETTINGS_AT = 'lumen.settings.at';
const EPOCH = '1970-01-01T00:00:00Z';

interface SyncMeta {
  /** server timestamp of the newest row we have seen */
  cursor: string;
  /** local clock: rows changed after this still need pushing */
  pushedAt: number;
  /** which account the local data was last reconciled against */
  userId: string | null;
  lastSyncedAt: number | null;
}

const DEFAULT_META: SyncMeta = {
  cursor: EPOCH,
  pushedAt: 0,
  userId: null,
  lastSyncedAt: null,
};

async function readMeta(): Promise<SyncMeta> {
  const row = await db.settings.get(META_KEY);
  return { ...DEFAULT_META, ...((row?.value as Partial<SyncMeta>) ?? {}) };
}

async function writeMeta(patch: Partial<SyncMeta>): Promise<SyncMeta> {
  const next = { ...(await readMeta()), ...patch };
  await db.settings.put({ key: META_KEY, value: next });
  return next;
}

/** Newest `synced_at` across every pulled batch — the next cursor. */
const maxStamp = (a: string, rows: { synced_at?: string }[]): string =>
  rows.reduce((acc, r) => (r.synced_at && r.synced_at > acc ? r.synced_at : acc), a);

const settingsData = (): Record<string, unknown> =>
  Object.fromEntries(
    Object.entries(useSettings.getState()).filter(([, v]) => typeof v !== 'function')
  );

/* ── store ───────────────────────────────────────────────────────── */

export type SyncStatus = 'idle' | 'syncing' | 'error' | 'offline';

interface SyncState {
  status: SyncStatus;
  step: string | null;
  error: string | null;
  lastSyncedAt: number | null;
  /** books whose EPUB has not reached the server yet */
  pendingUploads: number;
  /** books in the library whose file is not on this device */
  missingFiles: number;

  init(): Promise<void>;
  syncNow(): Promise<void>;
  /** fetch one book's EPUB on demand; returns false if it isn't available */
  ensureFile(bookId: string): Promise<boolean>;
  downloadAll(): Promise<void>;
  /** wipe local sync bookkeeping — used on sign-out */
  forget(): Promise<void>;
}

let running: Promise<void> | null = null;

export const useSync = create<SyncState>((set, get) => ({
  status: 'idle',
  step: null,
  error: null,
  lastSyncedAt: null,
  pendingUploads: 0,
  missingFiles: 0,

  async init() {
    const meta = await readMeta();
    set({ lastSyncedAt: meta.lastSyncedAt });
    await refreshCounts(set);
  },

  async syncNow() {
    if (!syncEnabled || !supabase) return;
    if (running) return running; // coalesce; the caller just waits on the run in flight

    running = (async () => {
      const { data } = await supabase.auth.getUser();
      const user = data.user;
      if (!user) {
        set({ status: 'idle', step: null });
        return;
      }
      if (!navigator.onLine) {
        set({ status: 'offline', step: null });
        return;
      }

      set({ status: 'syncing', error: null, step: 'Checking for changes' });
      try {
        let meta = await readMeta();

        /* First sync of a device that already has a library: push everything,
           so signing up doesn't silently strand books that were imported
           before the account existed. Switching to a *different* account
           instead starts from that account's data and leaves the old rows
           alone rather than filing them under the new user. */
        if (meta.userId !== user.id) {
          meta = await writeMeta({
            userId: user.id,
            cursor: EPOCH,
            pushedAt: meta.userId === null ? 0 : Date.now(),
          });
        }

        const startedAt = Date.now();

        set({ step: 'Downloading changes' });
        const cursor = await pull(meta.cursor);

        set({ step: 'Uploading changes' });
        await push(user.id, meta.pushedAt);

        await writeMeta({ cursor, pushedAt: startedAt });

        set({ step: 'Syncing books' });
        await syncFiles(user.id);

        await useLibrary.getState().load();
        await useDevice.getState().load();
        /* a reader book that arrived from another device may match a book
           this one has imported since — link it before it is ever shown */
        await useDevice.getState().autoLink();
        const done = Date.now();
        await writeMeta({ lastSyncedAt: done });
        set({ status: 'idle', step: null, lastSyncedAt: done });
        await refreshCounts(set);
      } catch (e) {
        set({
          status: navigator.onLine ? 'error' : 'offline',
          step: null,
          error: humanError(e),
        });
      }
    })().finally(() => {
      running = null;
    });

    return running;
  },

  async ensureFile(bookId) {
    if (await db.files.get(bookId)) return true;
    if (!supabase) return false;

    const book = await db.books.get(bookId);
    if (!book?.filePath) return false;

    set({ step: 'Downloading book' });
    try {
      const { data, error } = await supabase.storage.from(BUCKET).download(book.filePath);
      if (error || !data) throw error ?? new Error('Book file not found');
      const buf = await data.arrayBuffer();
      await db.files.put({ bookId, data: buf, size: buf.byteLength });
      await db.books.update(bookId, { fileMissing: false });
      await refreshCounts(set);
      set({ step: null });
      return true;
    } catch (e) {
      set({ step: null, error: humanError(e) });
      return false;
    }
  },

  async downloadAll() {
    const books = await db.books.toArray();
    for (const b of books) {
      if (b.filePath && !(await db.files.get(b.id))) await get().ensureFile(b.id);
    }
    await useLibrary.getState().load();
  },

  async forget() {
    await db.settings.delete(META_KEY);
    set({ lastSyncedAt: null, status: 'idle', step: null, error: null });
  },
}));

async function refreshCounts(set: (p: Partial<SyncState>) => void): Promise<void> {
  const [books, files] = await Promise.all([db.books.toArray(), db.files.toArray()]);
  const have = new Set(files.map((f) => f.bookId));
  set({
    pendingUploads: books.filter((b) => !b.filePath && have.has(b.id)).length,
    missingFiles: books.filter((b) => !have.has(b.id)).length,
  });
}

/* ── pull ────────────────────────────────────────────────────────── */

/* RLS already scopes every select to the caller, so pull takes no user id —
   asking for `where user_id = me` on top of that would be belt and braces. */
async function pull(cursor: string): Promise<string> {
  const sb = supabase!;
  let next = cursor;

  /* books — last write wins, and a server tombstone removes the local copy */
  const books = await sb
    .from('books')
    .select('*')
    .gt('synced_at', cursor)
    .order('synced_at', { ascending: true });
  if (books.error) throw books.error;

  const bookRows = (books.data ?? []) as BookRow[];
  next = maxStamp(next, bookRows);

  /* A row deleted here but not yet flagged on the server would otherwise be
     pulled straight back in before push gets a chance to remove it. */
  const pending = new Set((await db.tombstones.toArray()).map((t) => t.key));

  for (const row of bookRows) {
    if (pending.has(`books:${row.id}`)) continue;
    const local = await db.books.get(row.id);
    if (row.deleted) {
      if (local) {
        await db.books.delete(row.id);
        await db.files.delete(row.id);
        await db.covers.delete(row.id);
        await db.progress.delete(row.id);
        await db.bookmarks.where('bookId').equals(row.id).delete();
      }
      continue;
    }
    if (!local || (local.updatedAt ?? 0) <= row.updated_at) {
      const merged: BookRecord = {
        ...rowToBook(row),
        fileMissing: !(await db.files.get(row.id)),
      };
      await db.books.put(merged);
    }
  }

  /* progress */
  const prog = await sb.from('progress').select('*').gt('synced_at', cursor);
  if (prog.error) throw prog.error;
  const progRows = (prog.data ?? []) as ProgressRow[];
  next = maxStamp(next, progRows);
  for (const row of progRows) {
    const local = await db.progress.get(row.book_id);
    if (!local || local.updatedAt <= row.updated_at) {
      await db.progress.put(rowToProgress(row) as ProgressRecord);
    }
  }

  /* sessions — append-only, so anything we don't already hold is new */
  const sess = await sb.from('sessions').select('*').gt('synced_at', cursor);
  if (sess.error) throw sess.error;
  const sessRows = (sess.data ?? []) as SessionRow[];
  next = maxStamp(next, sessRows);
  if (sessRows.length) {
    const existing = new Set(
      (await db.sessions.toArray()).map((s) => s.uid).filter(Boolean) as string[]
    );
    const fresh = sessRows.filter((r) => !existing.has(r.uid)).map(rowToSession);
    if (fresh.length) await db.sessions.bulkAdd(fresh as Session[]);
  }

  /* bookmarks */
  const marks = await sb.from('bookmarks').select('*').gt('synced_at', cursor);
  if (marks.error) throw marks.error;
  const markRows = (marks.data ?? []) as BookmarkRow[];
  next = maxStamp(next, markRows);
  for (const row of markRows) {
    if (pending.has(`bookmarks:${row.uid}`)) continue;
    const local = await db.bookmarks.where('uid').equals(row.uid).first();
    if (row.deleted) {
      if (local?.id != null) await db.bookmarks.delete(local.id);
      continue;
    }
    if (!local) {
      await db.bookmarks.add(rowToBookmark(row) as BookmarkRecord);
    } else if ((local.updatedAt ?? 0) <= row.updated_at && local.id != null) {
      await db.bookmarks.update(local.id, rowToBookmark(row));
    }
  }

  /* device books — last write wins, same as the library */
  const dBooks = await sb.from('device_books').select('*').gt('synced_at', cursor);
  if (dBooks.error) throw dBooks.error;
  const dBookRows = (dBooks.data ?? []) as DeviceBookRow[];
  next = maxStamp(next, dBookRows);
  for (const row of dBookRows) {
    if (pending.has(`device_books:${row.id}`)) continue;
    const local = await db.deviceBooks.get(row.id);
    if (row.deleted) {
      if (local) {
        await db.deviceBooks.delete(row.id);
        await db.deviceSessions.where('deviceBookId').equals(row.id).delete();
      }
      continue;
    }
    if (!local || local.updatedAt <= row.updated_at) {
      await db.deviceBooks.put(rowToDeviceBook(row) as DeviceBookRecord);
    }
  }

  /* device sessions — editable, unlike library sessions, so they merge on
     `updated_at` rather than being treated as append-only */
  const dSess = await sb.from('device_sessions').select('*').gt('synced_at', cursor);
  if (dSess.error) throw dSess.error;
  const dSessRows = (dSess.data ?? []) as DeviceSessionRow[];
  next = maxStamp(next, dSessRows);
  for (const row of dSessRows) {
    if (pending.has(`device_sessions:${row.uid}`)) continue;
    const local = await db.deviceSessions.where('uid').equals(row.uid).first();
    if (row.deleted) {
      if (local?.id != null) await db.deviceSessions.delete(local.id);
      continue;
    }
    if (!local) {
      await db.deviceSessions.add(rowToDeviceSession(row) as DeviceSessionRecord);
    } else if (local.updatedAt <= row.updated_at && local.id != null) {
      await db.deviceSessions.update(local.id, rowToDeviceSession(row));
    }
  }

  /* settings — one blob, newest wins */
  const settings = await sb.from('settings').select('*').gt('synced_at', cursor).limit(1);
  if (settings.error) throw settings.error;
  const sRow = (settings.data ?? [])[0] as SettingsRow | undefined;
  if (sRow) {
    next = maxStamp(next, [sRow]);
    const localAt = Number(localStorage.getItem(SETTINGS_AT) ?? 0);
    if (localAt <= sRow.updated_at) {
      useSettings.setState(sRow.data as never);
      localStorage.setItem(SETTINGS_AT, String(sRow.updated_at));
    }
  }

  return next;
}

/* ── push ────────────────────────────────────────────────────────── */

async function push(userId: string, since: number): Promise<void> {
  const sb = supabase!;

  const books = (await db.books.toArray()).filter((b) => (b.updatedAt ?? 0) > since);
  if (books.length) {
    const { error } = await sb.from('books').upsert(books.map((b) => bookToRow(b, userId)));
    if (error) throw error;
  }

  const progress = (await db.progress.toArray()).filter((p) => p.updatedAt > since);
  if (progress.length) {
    const { error } = await sb
      .from('progress')
      .upsert(progress.map((p) => progressToRow(p, userId)));
    if (error) throw error;
  }

  /* Sessions recorded in the app are immutable, so `end` doubles as their
     creation stamp. Sessions mirrored from the e-reader are not: they are
     dated when the reading happened, which may be days before you typed it
     in, and they change when a page count is corrected. So those are picked
     up by their device session's `updatedAt` instead — going by `end` alone
     would silently never push a backfilled session at all. */
  const touchedDeviceSessions = (await db.deviceSessions.toArray()).filter(
    (s) => s.updatedAt > since
  );
  const mirrorUids = new Set(
    touchedDeviceSessions.map((s) => s.mirrorUid).filter(Boolean) as string[]
  );
  const sessions = (await db.sessions.toArray()).filter(
    (s) => s.end > since || (s.uid && mirrorUids.has(s.uid))
  );
  const needUid = sessions.filter((s) => !s.uid);
  for (const s of needUid) {
    const uid = newUid();
    s.uid = uid;
    if (s.id != null) await db.sessions.update(s.id, { uid });
  }
  if (sessions.length) {
    const { error } = await sb
      .from('sessions')
      .upsert(sessions.map((s) => sessionToRow(s, userId)), { onConflict: 'user_id,uid' });
    if (error) throw error;
  }

  const marks = (await db.bookmarks.toArray()).filter(
    (m) => (m.updatedAt ?? m.createdAt) > since
  );
  for (const m of marks) {
    if (!m.uid) {
      const uid = newUid();
      m.uid = uid;
      if (m.id != null) await db.bookmarks.update(m.id, { uid });
    }
  }
  if (marks.length) {
    const { error } = await sb
      .from('bookmarks')
      .upsert(marks.map((m) => bookmarkToRow(m, userId)), { onConflict: 'user_id,uid' });
    if (error) throw error;
  }

  const deviceBooks = (await db.deviceBooks.toArray()).filter((b) => b.updatedAt > since);
  if (deviceBooks.length) {
    const { error } = await sb
      .from('device_books')
      .upsert(deviceBooks.map((b) => deviceBookToRow(b, userId)));
    if (error) throw error;
  }

  const deviceSessions = touchedDeviceSessions;
  for (const s of deviceSessions) {
    if (!s.uid) {
      const uid = newUid();
      s.uid = uid;
      if (s.id != null) await db.deviceSessions.update(s.id, { uid });
    }
  }
  if (deviceSessions.length) {
    const { error } = await sb
      .from('device_sessions')
      .upsert(deviceSessions.map((s) => deviceSessionToRow(s, userId)), {
        onConflict: 'user_id,uid',
      });
    if (error) throw error;
  }

  const settingsAt = Number(localStorage.getItem(SETTINGS_AT) ?? 0);
  if (settingsAt > since) {
    const { error } = await sb.from('settings').upsert({
      user_id: userId,
      data: settingsData(),
      updated_at: settingsAt,
    });
    if (error) throw error;
  }

  /* deletions last: the row must exist server-side before it can be flagged */
  const stones = await db.tombstones.toArray();
  for (const stone of stones) {
    const table = stone.table;
    // books are keyed by a client-generated `id`, the append-only tables by `uid`
    const match =
      table === 'books' || table === 'device_books'
        ? { id: stone.uid }
        : { uid: stone.uid };
    const { error } = await sb
      .from(table)
      .update({ deleted: true, updated_at: stone.at })
      .match({ user_id: userId, ...match });
    if (error) throw error;
    if (table === 'books') await removeRemoteFiles(userId, stone.uid);
    await db.tombstones.delete(stone.key);
  }
}

/* ── files ───────────────────────────────────────────────────────── */

const epubPath = (userId: string, bookId: string) => `${userId}/${bookId}.epub`;
const coverPath = (userId: string, bookId: string) => `${userId}/${bookId}.cover`;

async function removeRemoteFiles(userId: string, bookId: string): Promise<void> {
  await supabase!.storage
    .from(BUCKET)
    .remove([epubPath(userId, bookId), coverPath(userId, bookId)]);
}

/** Upload anything held locally that the server hasn't got, in the background. */
async function syncFiles(userId: string): Promise<void> {
  const sb = supabase!;
  const books = await db.books.toArray();

  for (const book of books) {
    if (book.filePath) continue;
    const file = await db.files.get(book.id);
    if (!file) continue;

    const path = epubPath(userId, book.id);
    const { error } = await sb.storage.from(BUCKET).upload(
      path,
      new Blob([file.data], { type: 'application/epub+zip' }),
      { upsert: true, contentType: 'application/epub+zip' }
    );
    if (error) throw error;

    let cover: string | undefined;
    const coverRow = await db.covers.get(book.id);
    if (coverRow) {
      const cPath = coverPath(userId, book.id);
      const up = await sb.storage
        .from(BUCKET)
        .upload(cPath, coverRow.blob, { upsert: true });
      if (!up.error) cover = cPath;
    }

    const now = Date.now();
    await db.books.update(book.id, {
      filePath: path,
      ...(cover ? { coverPath: cover } : {}),
      updatedAt: now,
    });

    const { error: rowError } = await sb.from('books').upsert(
      bookToRow(
        { ...book, filePath: path, coverPath: cover, updatedAt: now },
        userId
      )
    );
    if (rowError) throw rowError;
  }

  /* covers for books pulled from another device: small, so fetch them eagerly —
     a library of grey rectangles is not what this app is for */
  for (const book of books) {
    if (!book.coverPath || (await db.covers.get(book.id))) continue;
    const { data } = await sb.storage.from(BUCKET).download(book.coverPath);
    if (data) await db.covers.put({ bookId: book.id, blob: data });
  }
}

/* ── wiring ──────────────────────────────────────────────────────── */

let wired = false;

/** Called once at boot: watch settings for changes and sync at sensible moments. */
export function initSync(): void {
  if (!syncEnabled || wired) return;
  wired = true;

  /* Stamp settings on change so the pusher can tell whether ours or the
     server's is newer. persist() rehydrates from localStorage while the store
     is being created — before this runs — so no spurious stamp on boot. */
  useSettings.subscribe(() => {
    localStorage.setItem(SETTINGS_AT, String(Date.now()));
  });

  const trigger = () => {
    void useSync.getState().syncNow();
  };

  /* Local writes are chatty — progress is saved on every page turn — so they
     get debounced rather than firing a round trip each time. */
  let timer: ReturnType<typeof setTimeout> | undefined;
  addEventListener('lumen:changed', () => {
    clearTimeout(timer);
    timer = setTimeout(trigger, 8000);
  });

  window.addEventListener('online', trigger);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') trigger();
  });
  // closing the app mid-chapter shouldn't cost you the last few minutes
  window.addEventListener('pagehide', () => void useSync.getState().syncNow());
  setInterval(trigger, 5 * 60_000);
}
