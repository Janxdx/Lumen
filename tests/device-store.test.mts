import 'fake-indexeddb/auto';
const ROOT = new URL('../src', import.meta.url).pathname;

// zustand stores touch window/localStorage; give them a minimal home
(globalThis as any).window = globalThis;
(globalThis as any).dispatchEvent = () => true;
(globalThis as any).addEventListener = () => {};
import { webcrypto } from 'node:crypto';
(globalThis as any).crypto ??= webcrypto;
(globalThis as any).navigator ??= {};

const { db } = await import(`${ROOT}/db/index.ts`);
const { useDevice } = await import(`${ROOT}/store/device.ts`);
const { useLibrary } = await import(`${ROOT}/store/library.ts`);

let fails = 0;
const check = (name: string, cond: boolean, extra = '') => {
  if (cond) console.log(`ok   ${name}`);
  else { fails++; console.log(`FAIL ${name} ${extra}`); }
};

// a library book: 3 chapters, 100k words
const spine = [
  { idref: 'a', href: 'a', linear: true, words: 30_000 },
  { idref: 'b', href: 'b', linear: true, words: 40_000 },
  { idref: 'c', href: 'c', linear: true, words: 30_000 },
];
await db.books.put({
  id: 'lib1',
  meta: { title: 'The Dispossessed', author: 'Ursula K. Le Guin', subjects: [] },
  spine, toc: [], totalWords: 100_000, addedAt: Date.now(), hue: 20, updatedAt: Date.now(),
});
await useLibrary.getState().load();
await useDevice.getState().load();

// 1 ─ adding a tracked book links it silently
const id = await useDevice.getState().addBook({
  title: 'The Dispossessed: An Ambiguous Utopia',
  author: 'Le Guin, Ursula K.',
  pages: 400,
  startPage: 17,
});
let book = (await db.deviceBooks.get(id))!;
check('auto-linked on add', book.bookId === 'lib1', String(book.bookId));

// 2 ─ timer survives a "reload": state lives in the database
await useDevice.getState().start(id, 17);
await useDevice.getState().pause();
const saved = (await db.settings.get('device.timer'))!.value as any;
check('timer persisted', saved.deviceBookId === id && saved.runningSince === null);
await useDevice.getState().resume();
await useDevice.getState().finish(117);   // read pages 17→117, 100 of 384

book = (await db.deviceBooks.get(id))!;
check('current page moved', book.currentPage === 117);

const prog = await db.progress.get('lib1');
/* page 17 was the last page read before this session and 117 is the last
   page read after it, so 101 body pages (17…117) are behind you. */
const expected = 101 / 384;
check('library progress = body pages behind you / body pages', Math.abs(prog!.percent - expected) < 1e-6, String(prog!.percent));
check('lands in the chapter that percentage falls in',
  prog!.spineIndex === 0 && prog!.wordIndex === Math.round(expected * 100_000),
  `spine ${prog!.spineIndex} word ${prog!.wordIndex}`);

const mirrors = (await db.sessions.toArray());
check('one mirrored library session', mirrors.length === 1, String(mirrors.length));
check('mirror is attributed to the linked book', mirrors[0].bookId === 'lib1');
check('mirror is marked as device reading', mirrors[0].source === 'device');
check('words from the linked book density', mirrors[0].words === Math.round(100 * (100_000 / 384)), String(mirrors[0].words));

// 3 ─ furthest wins: a backfilled session behind the app must not rewind
await db.progress.put({ bookId: 'lib1', spineIndex: 2, wordIndex: 100, percent: 0.9, updatedAt: Date.now() });
await useDevice.getState().logManual({
  deviceBookId: id, start: Date.now() - 86_400_000, ms: 1_800_000, fromPage: 117, toPage: 150,
});
const after = await db.progress.get('lib1');
check('progress did not rewind', after!.percent === 0.9, String(after!.percent));
check('but the session still counted', (await db.sessions.toArray()).length === 2);

// 4 ─ correcting the page count heals every past session
await useDevice.getState().updateBook(id, { pages: 800 });
const healed = await db.sessions.toArray();
const density = 100_000 / (800 - 17 + 1);
check('mirrored words recomputed after a page-count fix',
  healed.every((s: any) => s.words === Math.round(s.pages * density)),
  JSON.stringify(healed.map((s: any) => [s.pages, s.words])));

// 5 ─ deleting the book takes its mirrors with it
await useDevice.getState().removeBook(id);
check('mirrors removed with the book', (await db.sessions.toArray()).length === 0);
check('tombstones written for sync', (await db.tombstones.toArray()).length === 3,
  JSON.stringify((await db.tombstones.toArray()).map((t: any) => t.key)));

console.log(fails === 0 ? '\nALL PASS' : `\n${fails} FAILURES`);
process.exit(fails ? 1 : 0);
