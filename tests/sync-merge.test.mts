/* Sync, exercised against a fake backend.

   The transport is now an adapter, which means the interesting half — merge
   policy — can be tested without a server at all: hand the loop a backend
   that returns rows from an array and records what it was given, and assert
   on what Dexie ends up holding.

   What is checked here is the behaviour that has no natural home in either
   adapter and would be quietly wrong in both if it broke: last write wins,
   deletions surviving as tombstones rather than reappearing, append-only
   sessions not duplicating, and a stale device failing to overwrite. */

import 'fake-indexeddb/auto';
const ROOT = new URL('../src', import.meta.url).pathname;

(globalThis as any).window = globalThis;
(globalThis as any).dispatchEvent = () => true;
(globalThis as any).addEventListener = () => {};
(globalThis as any).removeEventListener = () => {};
(globalThis as any).document = { addEventListener: () => {}, visibilityState: 'visible' };
import { webcrypto } from 'node:crypto';
(globalThis as any).crypto ??= webcrypto;
(globalThis as any).navigator ??= { onLine: true };
(globalThis as any).navigator.onLine = true;

const store = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
};

/* Vite rewrites `import.meta.env` at build time; plain Node does not, so the
   adapters would read a property of undefined the moment they load. An empty
   object is the right stand-in — it means "nothing configured", which is
   exactly the state these tests want the backend selection to be in. */
(import.meta as any).env ??= {};

let fails = 0;
const check = (name: string, cond: boolean, extra = '') => {
  if (cond) console.log(`ok   ${name}`);
  else {
    fails++;
    console.log(`FAIL ${name} ${extra}`);
  }
};

const { db } = await import(`${ROOT}/db/index.ts`);
const { emptyChanges } = await import(`${ROOT}/sync/backend.ts`);
const { merge, useSync } = await import(`${ROOT}/sync/sync.ts`);

/* No fake server is needed. `merge` is the half of sync with no network in
   it — rows in, Dexie out — so it can be driven straight from arrays. The
   transport half is covered end-to-end against a real Worker and a real D1
   instead, which is the only place it can be checked honestly. */

/* ── 1 ─ last write wins ─────────────────────────────────────────── */

await db.books.put({
  id: 'bk1',
  meta: { title: 'Local', author: 'A', subjects: [] },
  spine: [],
  toc: [],
  totalWords: 10,
  addedAt: 1,
  hue: 1,
  updatedAt: 500,
} as any);

// a server row older than what we hold must not win
const older = {
  user_id: 'u1',
  id: 'bk1',
  title: 'Older',
  author: 'A',
  meta: { title: 'Older', author: 'A', subjects: [] },
  spine: [],
  toc: [],
  total_words: 10,
  hue: 1,
  added_at: 1,
  finished_at: null,
  file_path: null,
  file_size: null,
  cover_path: null,
  updated_at: 100,
  deleted: false,
};

await merge({ ...emptyChanges(), books: [older] });
check(
  'an older server row loses to the local copy',
  (await db.books.get('bk1'))?.meta.title === 'Local'
);

await merge({
  ...emptyChanges(),
  books: [
    {
      ...older,
      title: 'Newer',
      meta: { title: 'Newer', author: 'A', subjects: [] },
      updated_at: 900,
    },
  ],
});
check('a newer server row wins', (await db.books.get('bk1'))?.meta.title === 'Newer');

/* ── 1b ─ append-only sessions do not duplicate ──────────────────── */

const sessionRow = {
  user_id: 'u1',
  uid: 'sess-1',
  book_id: 'bk1',
  start_at: 10,
  end_at: 20,
  ms: 10,
  words: 5,
  pages: 1,
  paced_ms: 0,
  source: 'app',
};
await merge({ ...emptyChanges(), sessions: [sessionRow] });
await merge({ ...emptyChanges(), sessions: [sessionRow] });
check(
  'the same session pulled twice is stored once',
  (await db.sessions.toArray()).filter((s: any) => s.uid === 'sess-1').length === 1
);

/* ── 1c ─ a local deletion is not undone by the pull that follows ── */

await db.tombstones.put({
  key: 'books:bk-doomed',
  table: 'books',
  uid: 'bk-doomed',
  at: Date.now(),
});
await merge({
  ...emptyChanges(),
  books: [{ ...older, id: 'bk-doomed', updated_at: 99999 }],
});
check(
  'a row deleted here is not resurrected by the server copy',
  !(await db.books.get('bk-doomed'))
);
await db.tombstones.delete('books:bk-doomed');

/* ── 1d ─ a server tombstone removes the local book ──────────────── */

await merge({ ...emptyChanges(), books: [{ ...older, updated_at: 99999, deleted: true }] });
check('a server deletion removes the book', !(await db.books.get('bk1')));

/* ── 2 ─ deleting a book leaves a tombstone, and history survives ── */

const { deleteBook } = await import(`${ROOT}/db/index.ts`);

await db.books.put({
  id: 'bk1',
  meta: { title: 'Back again', author: 'A', subjects: [] },
  spine: [],
  toc: [],
  totalWords: 10,
  addedAt: 1,
  hue: 1,
  updatedAt: 500,
} as any);

await db.sessions.add({
  uid: 'sess-keep',
  bookId: 'bk1',
  start: 1,
  end: 2,
  ms: 1,
  words: 1,
  pages: 1,
  pacedMs: 0,
  source: 'app',
} as any);

await deleteBook('bk1');

const stone = await db.tombstones.get('books:bk1');
check('deleting a book writes a tombstone', !!stone);
check('the book itself is gone', !(await db.books.get('bk1')));
check(
  'reading history is not rewritten by a delete',
  (await db.sessions.toArray()).some((s: any) => s.uid === 'sess-keep')
);

/* ── 3 ─ covers are stored as bytes, never as a Blob ─────────────── */

const { coverToBlob } = await import(`${ROOT}/db/index.ts`);
const bytes = new Uint8Array([1, 2, 3, 4]).buffer;
await db.covers.put({ bookId: 'bk2', data: bytes, type: 'image/png' });
const cover = await db.covers.get('bk2');
check('cover round-trips as an ArrayBuffer', cover?.data?.byteLength === 4);
check('cover rebuilds into a displayable blob', coverToBlob(cover!).type === 'image/png');

/* A row written by an older build held a Blob directly; it must still
   render rather than throwing on a property that is no longer there. */
await db.covers.put({ bookId: 'bk3', blob: new Blob([bytes], { type: 'image/jpeg' }) } as any);
const legacy = await db.covers.get('bk3');
check('legacy blob rows still render', coverToBlob(legacy!).type === 'image/jpeg');

/* ── 4 ─ the sync store starts clean ─────────────────────────────── */

check('sync starts idle', useSync.getState().status === 'idle');

console.log(fails === 0 ? '\nALL PASS' : `\n${fails} FAILED`);
process.exit(fails === 0 ? 0 : 1);
