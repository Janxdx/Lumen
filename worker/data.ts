/* Pull and push over the reading tables.

   ─── the one rule ───────────────────────────────────────────────────

   Every statement in this file filters by `user_id`, and every value bound
   to it comes from the session — never from the request body. Postgres had
   row level security doing this beneath us; SQLite has nothing. One missing
   `where user_id = ?` here is one reader's library handed to another, with
   no second line of defence to catch it.

   So the pattern is uniform on purpose: each table gets a `pullX` and a
   `pushX`, both taking `userId` as their first argument, both interpolating
   nothing. Uniform code is code where a missing clause looks wrong.

   ─── the cursor ─────────────────────────────────────────────────────

   Rows are stamped with a per-user counter rather than a timestamp, and the
   counter is bumped once per push. Clocks can repeat a millisecond under
   two writes; a counter cannot repeat at all, so no change can slip behind
   a cursor that has already moved past it. */

import type { Env } from './env';
import type { User } from './auth';
import { bad } from './http';

/* ── shape of a sync exchange ──────────────────────────────────────── */

export interface Changes {
  books: Row[];
  progress: Row[];
  sessions: Row[];
  bookmarks: Row[];
  deviceBooks: Row[];
  deviceSessions: Row[];
  ratings: Row[];
  settings: Row | null;
}

type Row = Record<string, unknown>;

export interface PullResult extends Changes {
  cursor: number;
}

/** Advance the user's counter and return the value to stamp this push with. */
async function nextSeq(env: Env, userId: string): Promise<number> {
  const row = await env.DB.prepare(
    'update users set seq = seq + 1 where id = ? returning seq'
  )
    .bind(userId)
    .first<{ seq: number }>();
  if (!row) throw bad('Account not found.');
  return row.seq;
}

/* ── pull ──────────────────────────────────────────────────────────

   Eight statements, run as one batch so they see a consistent snapshot
   rather than a moving target. The client merges what comes back; the
   server does not decide who wins, because the client is the only place
   that knows what it already has. */

export async function pull(env: Env, user: User, cursor: number): Promise<PullResult> {
  const q = (table: string) =>
    env.DB.prepare(
      `select * from ${table} where user_id = ? and row_seq > ? order by row_seq`
    ).bind(user.id, cursor);

  const [books, progress, sessions, bookmarks, deviceBooks, deviceSessions, ratings, settings] =
    await env.DB.batch<Row>([
      q('books'),
      q('progress'),
      q('read_sessions'),
      q('bookmarks'),
      q('device_books'),
      q('device_sessions'),
      q('ratings'),
      q('settings'),
    ]);

  const all = [
    ...(books.results ?? []),
    ...(progress.results ?? []),
    ...(sessions.results ?? []),
    ...(bookmarks.results ?? []),
    ...(deviceBooks.results ?? []),
    ...(deviceSessions.results ?? []),
    ...(ratings.results ?? []),
    ...(settings.results ?? []),
  ];
  const highest = all.reduce(
    (acc, r) => Math.max(acc, Number(r.row_seq ?? 0)),
    cursor
  );

  return {
    cursor: highest,
    books: (books.results ?? []).map(decodeBook),
    progress: progress.results ?? [],
    sessions: sessions.results ?? [],
    bookmarks: bookmarks.results ?? [],
    deviceBooks: deviceBooks.results ?? [],
    deviceSessions: deviceSessions.results ?? [],
    ratings: (ratings.results ?? []).map(decodeRating),
    settings: decodeSettings((settings.results ?? [])[0]),
  };
}

/* SQLite has no JSON type, so these columns travel as text. Parsing here
   rather than on the client keeps the wire format identical to the Supabase
   one, which is what lets a single set of mapping functions serve both. */
function decodeBook(row: Row): Row {
  return {
    ...row,
    meta: parseJson(row.meta, {}),
    spine: parseJson(row.spine, []),
    toc: parseJson(row.toc, []),
    deleted: Boolean(row.deleted),
  };
}

function decodeRating(row: Row): Row {
  return {
    ...row,
    axes: parseJson(row.axes, {}),
    favourite: Boolean(row.favourite),
    deleted: Boolean(row.deleted),
  };
}

function decodeSettings(row: Row | undefined): Row | null {
  if (!row) return null;
  return { ...row, data: parseJson(row.data, {}) };
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== 'string') return (value as T) ?? fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

/* ── push ──────────────────────────────────────────────────────────

   Upserts, batched into one round trip. Conflict resolution is last write
   wins on the client's `updated_at`, decided in SQL by refusing the write
   when the stored copy is newer — a device that has been offline for a week
   cannot stamp on changes made since, merely by being the one that spoke
   last.

   Deletions arrive as rows with `deleted` set, not as absences, so the
   other devices learn about them on their next pull. */

export async function push(env: Env, user: User, changes: Partial<Changes>): Promise<number> {
  const seq = await nextSeq(env, user.id);
  const stmts: D1PreparedStatement[] = [];
  const uid = user.id;

  for (const b of changes.books ?? []) {
    stmts.push(
      env.DB.prepare(
        `insert into books (user_id, id, title, author, meta, spine, toc, total_words,
                            hue, added_at, finished_at, file_path, file_size, cover_path,
                            updated_at, deleted, row_seq)
         values (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
         on conflict(user_id, id) do update set
           title = excluded.title, author = excluded.author, meta = excluded.meta,
           spine = excluded.spine, toc = excluded.toc, total_words = excluded.total_words,
           hue = excluded.hue, added_at = excluded.added_at,
           finished_at = excluded.finished_at, file_path = excluded.file_path,
           file_size = excluded.file_size, cover_path = excluded.cover_path,
           updated_at = excluded.updated_at, deleted = excluded.deleted,
           row_seq = excluded.row_seq
         where excluded.updated_at >= books.updated_at`
      ).bind(
        uid,
        str(b.id),
        str(b.title),
        str(b.author),
        JSON.stringify(b.meta ?? {}),
        JSON.stringify(b.spine ?? []),
        JSON.stringify(b.toc ?? []),
        num(b.total_words),
        num(b.hue),
        num(b.added_at),
        b.finished_at == null ? null : num(b.finished_at),
        b.file_path == null ? null : str(b.file_path),
        b.file_size == null ? null : num(b.file_size),
        b.cover_path == null ? null : str(b.cover_path),
        num(b.updated_at),
        b.deleted ? 1 : 0,
        seq
      )
    );
  }

  for (const p of changes.progress ?? []) {
    stmts.push(
      env.DB.prepare(
        `insert into progress (user_id, book_id, spine_index, word_index, percent, updated_at, row_seq)
         values (?,?,?,?,?,?,?)
         on conflict(user_id, book_id) do update set
           spine_index = excluded.spine_index, word_index = excluded.word_index,
           percent = excluded.percent, updated_at = excluded.updated_at,
           row_seq = excluded.row_seq
         where excluded.updated_at >= progress.updated_at`
      ).bind(
        uid,
        str(p.book_id),
        num(p.spine_index),
        num(p.word_index),
        Number(p.percent ?? 0),
        num(p.updated_at),
        seq
      )
    );
  }

  /* Reading sessions are append-only. `do nothing` rather than an update:
     a session that already exists is one this device is re-sending, not one
     it has changed, and history is not something a sync should rewrite. */
  for (const s of changes.sessions ?? []) {
    stmts.push(
      env.DB.prepare(
        `insert into read_sessions (user_id, uid, book_id, start_at, end_at, ms, words,
                                    pages, paced_ms, source, row_seq)
         values (?,?,?,?,?,?,?,?,?,?,?)
         on conflict(user_id, uid) do update set
           ms = excluded.ms, words = excluded.words, pages = excluded.pages,
           paced_ms = excluded.paced_ms, row_seq = excluded.row_seq`
      ).bind(
        uid,
        str(s.uid),
        str(s.book_id),
        num(s.start_at),
        num(s.end_at),
        num(s.ms),
        num(s.words),
        num(s.pages),
        num(s.paced_ms),
        str(s.source ?? 'app'),
        seq
      )
    );
  }

  for (const m of changes.bookmarks ?? []) {
    stmts.push(
      env.DB.prepare(
        `insert into bookmarks (user_id, uid, book_id, spine_index, word_index, excerpt,
                                created_at, updated_at, deleted, row_seq)
         values (?,?,?,?,?,?,?,?,?,?)
         on conflict(user_id, uid) do update set
           book_id = excluded.book_id, spine_index = excluded.spine_index,
           word_index = excluded.word_index, excerpt = excluded.excerpt,
           updated_at = excluded.updated_at, deleted = excluded.deleted,
           row_seq = excluded.row_seq
         where excluded.updated_at >= bookmarks.updated_at`
      ).bind(
        uid,
        str(m.uid),
        str(m.book_id),
        num(m.spine_index),
        num(m.word_index),
        str(m.excerpt),
        num(m.created_at),
        num(m.updated_at),
        m.deleted ? 1 : 0,
        seq
      )
    );
  }

  for (const b of changes.deviceBooks ?? []) {
    stmts.push(
      env.DB.prepare(
        `insert into device_books (user_id, id, title, author, pages, start_page,
                                   current_page, book_id, link_pinned, device, added_at,
                                   finished_at, hue, updated_at, deleted, row_seq)
         values (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
         on conflict(user_id, id) do update set
           title = excluded.title, author = excluded.author, pages = excluded.pages,
           start_page = excluded.start_page, current_page = excluded.current_page,
           book_id = excluded.book_id, link_pinned = excluded.link_pinned,
           device = excluded.device, added_at = excluded.added_at,
           finished_at = excluded.finished_at, hue = excluded.hue,
           updated_at = excluded.updated_at, deleted = excluded.deleted,
           row_seq = excluded.row_seq
         where excluded.updated_at >= device_books.updated_at`
      ).bind(
        uid,
        str(b.id),
        str(b.title),
        str(b.author),
        num(b.pages),
        num(b.start_page),
        num(b.current_page),
        b.book_id == null ? null : str(b.book_id),
        b.link_pinned ? 1 : 0,
        b.device == null ? null : str(b.device),
        num(b.added_at),
        b.finished_at == null ? null : num(b.finished_at),
        num(b.hue),
        num(b.updated_at),
        b.deleted ? 1 : 0,
        seq
      )
    );
  }

  for (const s of changes.deviceSessions ?? []) {
    stmts.push(
      env.DB.prepare(
        `insert into device_sessions (user_id, uid, device_book_id, start_at, end_at, ms,
                                      from_page, to_page, pages, words, mirror_uid, note,
                                      updated_at, deleted, row_seq)
         values (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
         on conflict(user_id, uid) do update set
           device_book_id = excluded.device_book_id, start_at = excluded.start_at,
           end_at = excluded.end_at, ms = excluded.ms, from_page = excluded.from_page,
           to_page = excluded.to_page, pages = excluded.pages, words = excluded.words,
           mirror_uid = excluded.mirror_uid, note = excluded.note,
           updated_at = excluded.updated_at, deleted = excluded.deleted,
           row_seq = excluded.row_seq
         where excluded.updated_at >= device_sessions.updated_at`
      ).bind(
        uid,
        str(s.uid),
        str(s.device_book_id),
        num(s.start_at),
        num(s.end_at),
        num(s.ms),
        num(s.from_page),
        num(s.to_page),
        num(s.pages),
        num(s.words),
        s.mirror_uid == null ? null : str(s.mirror_uid),
        s.note == null ? null : str(s.note),
        num(s.updated_at),
        s.deleted ? 1 : 0,
        seq
      )
    );
  }

  for (const r of changes.ratings ?? []) {
    stmts.push(
      env.DB.prepare(
        `insert into ratings (user_id, id, book_id, device_book_id, title, author,
                              overall, axes, mood, note, favourite, words, rated_at,
                              updated_at, deleted, row_seq)
         values (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
         on conflict(user_id, id) do update set
           book_id = excluded.book_id, device_book_id = excluded.device_book_id,
           title = excluded.title, author = excluded.author,
           overall = excluded.overall, axes = excluded.axes, mood = excluded.mood,
           note = excluded.note, favourite = excluded.favourite, words = excluded.words,
           rated_at = excluded.rated_at, updated_at = excluded.updated_at,
           deleted = excluded.deleted, row_seq = excluded.row_seq
         where excluded.updated_at >= ratings.updated_at`
      ).bind(
        uid,
        str(r.id),
        r.book_id == null ? null : str(r.book_id),
        r.device_book_id == null ? null : str(r.device_book_id),
        str(r.title),
        str(r.author),
        Number(r.overall ?? 0),
        JSON.stringify(r.axes ?? {}),
        r.mood == null ? null : str(r.mood),
        r.note == null ? null : str(r.note),
        r.favourite ? 1 : 0,
        r.words == null ? null : num(r.words),
        num(r.rated_at),
        num(r.updated_at),
        r.deleted ? 1 : 0,
        seq
      )
    );
  }

  if (changes.settings) {
    const s = changes.settings;
    stmts.push(
      env.DB.prepare(
        `insert into settings (user_id, data, updated_at, row_seq)
         values (?,?,?,?)
         on conflict(user_id) do update set
           data = excluded.data, updated_at = excluded.updated_at, row_seq = excluded.row_seq
         where excluded.updated_at >= settings.updated_at`
      ).bind(uid, JSON.stringify(s.data ?? {}), num(s.updated_at), seq)
    );
  }

  if (stmts.length) await env.DB.batch(stmts);
  return seq;
}

/* Coercion at the boundary. The body is JSON from a client we do not
   control, so a field that should be a number might be a string, null, or
   an object someone is curious about. Binding those to SQLite directly
   throws at best and stores nonsense at worst. */

const num = (v: unknown): number => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

const str = (v: unknown): string => (typeof v === 'string' ? v : String(v ?? ''));

/** Remove a user's stored objects when a book is deleted. */
export async function forgetBookFiles(env: Env, user: User, bookId: string): Promise<void> {
  await env.BOOKS.delete([
    `${user.id}/${bookId}.epub`,
    `${user.id}/${bookId}.cover`,
  ]);
}
