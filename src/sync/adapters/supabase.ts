/* The Supabase adapter.

   This is the backend Lumen shipped on, kept behind the port so the move to
   the Worker is reversible: point the env vars back and it takes over again
   with the same local database underneath. Nothing above this file knows
   which one is live.

   It carries one thing the Worker adapter doesn't need — passwords, and
   therefore an unverified state, because Supabase will hand out a session
   before the address has been proven. The Worker has no such state: there,
   possession of the address is how an account comes to exist at all. */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import type {
  AuthBackend,
  AuthUser,
  Backend,
  Changes,
  Cursor,
  FileKind,
  FileStore,
  Pulled,
} from '../backend';
import type {
  BookRow,
  BookmarkRow,
  DeviceBookRow,
  DeviceSessionRow,
  ProgressRow,
  RatingRow,
  SessionRow,
  SettingsRow,
} from '../mapping';

/* Vite substitutes `import.meta.env` at build time. Outside a Vite build —
   the test runner, most obviously — it is simply absent, and reading a
   property straight off it throws before anything else can run. */
const env = import.meta.env ?? ({} as ImportMetaEnv);

const url = env.VITE_SUPABASE_URL?.trim();
const anonKey = env.VITE_SUPABASE_ANON_KEY?.trim();

export const supabaseConfigured = Boolean(url && anonKey);

const client: SupabaseClient | null = supabaseConfigured
  ? createClient(url as string, anonKey as string, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
        storageKey: 'lumen.auth',
      },
    })
  : null;

const sb = (): SupabaseClient => {
  if (!client) throw new Error('Supabase is not configured.');
  return client;
};

const BUCKET = 'books';
const EPOCH = '1970-01-01T00:00:00Z';

const toUser = (u: {
  id: string;
  email?: string | null;
  email_confirmed_at?: string | null;
  confirmed_at?: string | null;
}): AuthUser => ({
  id: u.id,
  email: u.email ?? '',
  verified: Boolean(u.email_confirmed_at ?? u.confirmed_at),
});

/* ── auth ──────────────────────────────────────────────────────────── */

const auth: AuthBackend = {
  capabilities: { passwords: true, magicLink: false, passkeys: false },

  async current() {
    const { data } = await sb().auth.getUser();
    return data.user ? toUser(data.user) : null;
  },

  subscribe(onChange) {
    sb().auth.onAuthStateChange((_event, session) => {
      onChange(session?.user ? toUser(session.user) : null);
    });
  },

  async signOut() {
    await sb().auth.signOut();
  },

  async signIn(email, password) {
    const { data, error } = await sb().auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    if (error) throw error;
    return data.user ? toUser(data.user) : null;
  },

  async signUp(email, password) {
    const { data, error } = await sb().auth.signUp({
      email: email.trim(),
      password,
      options: { emailRedirectTo: location.origin },
    });
    if (error) throw error;
    return data.user ? toUser(data.user) : null;
  },

  async resetPassword(email) {
    const { error } = await sb().auth.resetPasswordForEmail(email.trim(), {
      redirectTo: location.origin,
    });
    if (error) throw error;
  },

  async resendConfirmation(email) {
    const { error } = await sb().auth.resend({
      type: 'signup',
      email,
      options: { emailRedirectTo: location.origin },
    });
    if (error) throw error;
  },
};

/* ── files ─────────────────────────────────────────────────────────── */

const objectPath = async (kind: FileKind, bookId: string): Promise<string> => {
  const { data } = await sb().auth.getUser();
  if (!data.user) throw new Error('Signed out.');
  return `${data.user.id}/${bookId}.${kind === 'epub' ? 'epub' : 'cover'}`;
};

const files: FileStore = {
  async put(kind, bookId, body) {
    const path = await objectPath(kind, bookId);
    const { error } = await sb()
      .storage.from(BUCKET)
      .upload(path, body, {
        upsert: true,
        contentType: body.type || 'application/octet-stream',
      });
    if (error) throw error;
    return path;
  },

  async get(_kind, _bookId, path) {
    const { data, error } = await sb().storage.from(BUCKET).download(path);
    if (error || !data) return null;
    return data;
  },

  async remove(bookId) {
    const [epub, cover] = await Promise.all([
      objectPath('epub', bookId),
      objectPath('cover', bookId),
    ]);
    await sb().storage.from(BUCKET).remove([epub, cover]);
  },
};

/* ── data ──────────────────────────────────────────────────────────── */

/** Newest `synced_at` across everything pulled — the next cursor. */
const maxStamp = (acc: string, rows: { synced_at?: string }[]): string =>
  rows.reduce((a, r) => (r.synced_at && r.synced_at > a ? r.synced_at : a), acc);

async function currentUserId(): Promise<string> {
  const { data } = await sb().auth.getUser();
  if (!data.user) throw new Error('Signed out.');
  return data.user.id;
}

export const supabaseBackend: Backend = {
  kind: 'supabase',
  auth,
  files,
  zeroCursor: EPOCH,

  async pull(cursor: Cursor): Promise<Pulled> {
    const since = String(cursor ?? EPOCH);
    const c = sb();

    /* RLS scopes every select to the caller, so none of these say
       `where user_id = me` — asking on top of that would be belt and
       braces. This is the guarantee the Worker adapter has to reproduce by
       hand, since SQLite offers nothing like it. */
    const [books, progress, sessions, bookmarks, deviceBooks, deviceSessions, ratings, settings] =
      await Promise.all([
        c.from('books').select('*').gt('synced_at', since).order('synced_at'),
        c.from('progress').select('*').gt('synced_at', since),
        c.from('sessions').select('*').gt('synced_at', since),
        c.from('bookmarks').select('*').gt('synced_at', since),
        c.from('device_books').select('*').gt('synced_at', since),
        c.from('device_sessions').select('*').gt('synced_at', since),
        c.from('ratings').select('*').gt('synced_at', since),
        c.from('settings').select('*').gt('synced_at', since).limit(1),
      ]);

    for (const r of [books, progress, sessions, bookmarks, deviceBooks, deviceSessions, ratings, settings]) {
      if (r.error) throw r.error;
    }

    const changes: Changes = {
      books: (books.data ?? []) as BookRow[],
      progress: (progress.data ?? []) as ProgressRow[],
      sessions: (sessions.data ?? []) as SessionRow[],
      bookmarks: (bookmarks.data ?? []) as BookmarkRow[],
      deviceBooks: (deviceBooks.data ?? []) as DeviceBookRow[],
      deviceSessions: (deviceSessions.data ?? []) as DeviceSessionRow[],
      ratings: (ratings.data ?? []) as RatingRow[],
      settings: ((settings.data ?? [])[0] as SettingsRow | undefined) ?? null,
    };

    let next = since;
    next = maxStamp(next, changes.books);
    next = maxStamp(next, changes.progress);
    next = maxStamp(next, changes.sessions);
    next = maxStamp(next, changes.bookmarks);
    next = maxStamp(next, changes.deviceBooks);
    next = maxStamp(next, changes.deviceSessions);
    next = maxStamp(next, changes.ratings);
    if (changes.settings) next = maxStamp(next, [changes.settings]);

    return { cursor: next, changes };
  },

  async push(changes: Changes): Promise<Cursor | null> {
    const c = sb();
    const userId = await currentUserId();
    const stamp = <T extends object>(rows: T[]): (T & { user_id: string })[] =>
      rows.map((r) => ({ ...r, user_id: userId }));

    const upsert = async (
      table: string,
      rows: object[],
      onConflict?: string
    ): Promise<void> => {
      if (!rows.length) return;
      const { error } = await c
        .from(table)
        .upsert(stamp(rows), onConflict ? { onConflict } : undefined);
      if (error) throw error;
    };

    await upsert('books', changes.books);
    await upsert('progress', changes.progress);
    await upsert('sessions', changes.sessions, 'user_id,uid');
    await upsert('bookmarks', changes.bookmarks, 'user_id,uid');
    await upsert('device_books', changes.deviceBooks);
    await upsert('device_sessions', changes.deviceSessions, 'user_id,uid');
    await upsert('ratings', changes.ratings);
    if (changes.settings) await upsert('settings', [changes.settings]);

    /* Supabase stamps rows with its own clock, so a push has no cursor to
       report. The next pull will find them. */
    return null;
  },
};
