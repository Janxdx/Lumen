/* What Soluna needs from a server, and nothing about who provides it.

   One implementation sits behind this file: the Soluna Worker on Cloudflare
   (D1 + R2). The port stays regardless — the sync loop, the stores and the
   UI cannot tell which backend is running, so a future adapter is a new
   file and an env var, not a rewrite.

   The division of labour is deliberate. An adapter moves rows and files; it
   does not decide anything. All merge policy — last write wins, tombstones,
   which side is newer — lives in sync.ts, because it is identical either
   way and duplicating it would be duplicating the part that is easy to get
   subtly wrong. */

import type {
  BookRow,
  BookmarkRow,
  DeviceBookRow,
  DeviceSessionRow,
  ProgressRow,
  RatingRow,
  SessionRow,
  SettingsRow,
} from './mapping';

/* ── data ──────────────────────────────────────────────────────────── */

/** One exchange in either direction. Every field is optional on push. */
export interface Changes {
  books: BookRow[];
  progress: ProgressRow[];
  sessions: SessionRow[];
  bookmarks: BookmarkRow[];
  deviceBooks: DeviceBookRow[];
  deviceSessions: DeviceSessionRow[];
  ratings: RatingRow[];
  settings: SettingsRow | null;
}

export const emptyChanges = (): Changes => ({
  books: [],
  progress: [],
  sessions: [],
  bookmarks: [],
  deviceBooks: [],
  deviceSessions: [],
  ratings: [],
  settings: null,
});

export const isEmpty = (c: Changes): boolean =>
  !c.settings &&
  c.books.length === 0 &&
  c.progress.length === 0 &&
  c.sessions.length === 0 &&
  c.bookmarks.length === 0 &&
  c.deviceBooks.length === 0 &&
  c.deviceSessions.length === 0 &&
  c.ratings.length === 0;

/* The bookmark of how far a device has read the server's change log.
   Opaque on purpose: the Worker stamps rows with a counter, and the sync
   loop should not have an opinion about the shape. It stores whatever it
   was given and hands the same value back. */
export type Cursor = string | number;

export interface Pulled {
  cursor: Cursor;
  changes: Changes;
}

/* ── files ─────────────────────────────────────────────────────────── */

export type FileKind = 'epub' | 'cover';

export interface FileStore {
  /** Store the bytes and return the path to record on the book row. */
  put(kind: FileKind, bookId: string, body: Blob): Promise<string>;
  /** Fetch by the path previously recorded, or null if it isn't there. */
  get(kind: FileKind, bookId: string, path: string): Promise<Blob | null>;
  remove(bookId: string): Promise<void>;
}

/* ── auth ──────────────────────────────────────────────────────────── */

export interface AuthUser {
  id: string;
  email: string;
  /** address confirmed. On magic-link backends this is true by construction. */
  verified: boolean;
}

export interface Passkey {
  id: string;
  label: string | null;
  createdAt: number;
  lastUsedAt: number | null;
}

/* Not every backend can do everything, and the account screen should show
   what is actually available rather than offering a button that errors.
   The Worker means magic links and passkeys — no passwords. */
export interface AuthCapabilities {
  passwords: boolean;
  magicLink: boolean;
  passkeys: boolean;
}

export interface AuthBackend {
  readonly capabilities: AuthCapabilities;

  /** Who is signed in, asking the server rather than trusting a cache. */
  current(): Promise<AuthUser | null>;
  /** Called when the session changes underneath us (another tab, a refresh). */
  subscribe(onChange: (user: AuthUser | null) => void): void;
  signOut(): Promise<void>;

  /* password backends */
  signIn?(email: string, password: string): Promise<AuthUser | null>;
  signUp?(email: string, password: string): Promise<AuthUser | null>;
  resetPassword?(email: string): Promise<void>;
  resendConfirmation?(email: string): Promise<void>;

  /* link backends */
  requestLink?(email: string): Promise<void>;

  /* passkey backends */
  listPasskeys?(): Promise<Passkey[]>;
  registerPasskey?(label: string): Promise<Passkey[]>;
  removePasskey?(id: string): Promise<Passkey[]>;
  signInWithPasskey?(): Promise<AuthUser>;
  /** whether this browser can do WebAuthn at all */
  passkeysUsable?(): Promise<boolean>;
}

export interface Backend {
  readonly kind: 'soluna';
  readonly auth: AuthBackend;
  readonly files: FileStore;
  pull(cursor: Cursor): Promise<Pulled>;
  /* Returns the cursor the push landed at, or null when the backend stamps
     rows itself and has no number to give back — the next pull discovers
     where they went. Returning a made-up value instead would rewind the
     caller and re-download everything. */
  push(changes: Changes): Promise<Cursor | null>;
  /** the cursor value meaning "I have seen nothing yet" */
  readonly zeroCursor: Cursor;
}
