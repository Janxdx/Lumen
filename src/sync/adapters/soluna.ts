/* The Cloudflare Worker adapter — Soluna's own backend.

   Everything here talks to the same origin the app is served from, which is
   what makes the session a cookie rather than a token. `credentials:
   'same-origin'` is on every call for that reason: without it fetch would
   omit the cookie and every request would look signed out.

   There is no key, no project URL and no SDK. The whole client is this
   file. */

import {
  browserSupportsWebAuthn,
  startAuthentication,
  startRegistration,
} from '@simplewebauthn/browser';

import type {
  AuthBackend,
  AuthUser,
  Backend,
  Changes,
  Cursor,
  FileKind,
  FileStore,
  Passkey,
  Pulled,
} from '../backend';

/* ── transport ─────────────────────────────────────────────────────── */

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    ...init,
    // the session cookie is HttpOnly, so this is the only way it travels
    credentials: 'same-origin',
    headers: {
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...(init.headers ?? {}),
    },
  });

  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `Request failed (${res.status}).`);
  }
  return (await res.json()) as T;
}

const post = <T>(path: string, body?: unknown): Promise<T> =>
  call<T>(path, { method: 'POST', ...(body ? { body: JSON.stringify(body) } : {}) });

/* ── auth ──────────────────────────────────────────────────────────── */

let watcher: ((user: AuthUser | null) => void) | null = null;

const auth: AuthBackend = {
  capabilities: { passwords: false, magicLink: true, passkeys: true },

  async current() {
    const { user } = await call<{ user: { id: string; email: string } | null }>(
      '/auth/me'
    );
    /* No unverified state exists on this backend: the only routes to an
       account are a link opened in the inbox or a passkey already bound to
       one. Possession is proved before the account exists. */
    return user ? { ...user, verified: true } : null;
  },

  subscribe(onChange) {
    watcher = onChange;
  },

  async signOut() {
    await post('/auth/signout');
    watcher?.(null);
  },

  async requestLink(email) {
    await post('/auth/request', { email });
  },

  async passkeysUsable() {
    return browserSupportsWebAuthn();
  },

  async listPasskeys() {
    const { passkeys } = await call<{ passkeys: Passkey[] }>('/auth/passkeys');
    return passkeys;
  },

  async registerPasskey(label) {
    /* Two round trips by design. The server issues a challenge it remembers,
       the authenticator signs it, and the server checks the signature
       against what it issued — a challenge the client could choose would
       prove nothing about when the signature was made. */
    const options = await post<Record<string, unknown>>('/auth/passkey/register/options');
    const response = await startRegistration({ optionsJSON: options as never });
    const { passkeys } = await post<{ passkeys: Passkey[] }>(
      '/auth/passkey/register/verify',
      { response, label }
    );
    return passkeys;
  },

  async removePasskey(id) {
    const { passkeys } = await call<{ passkeys: Passkey[] }>(
      `/auth/passkeys/${encodeURIComponent(id)}`,
      { method: 'DELETE' }
    );
    return passkeys;
  },

  async signInWithPasskey() {
    const options = await post<Record<string, unknown>>('/auth/passkey/login/options');
    const response = await startAuthentication({ optionsJSON: options as never });
    const { user } = await post<{ user: { id: string; email: string } }>(
      '/auth/passkey/login/verify',
      { response }
    );
    const full = { ...user, verified: true };
    watcher?.(full);
    return full;
  },
};

/* ── files ─────────────────────────────────────────────────────────── */

const files: FileStore = {
  async put(kind: FileKind, bookId, body) {
    /* Streamed straight through as the request body rather than wrapped in
       JSON — an EPUB base64-encoded into a JSON field would be a third
       larger and would have to be held in memory twice. */
    const res = await fetch(`/api/files/${kind}/${encodeURIComponent(bookId)}`, {
      method: 'PUT',
      credentials: 'same-origin',
      headers: { 'content-type': body.type || 'application/octet-stream' },
      body,
    });
    if (!res.ok) throw new Error(`Upload failed (${res.status}).`);
    const { path } = (await res.json()) as { path: string };
    return path;
  },

  async get(kind: FileKind, bookId) {
    const res = await fetch(`/api/files/${kind}/${encodeURIComponent(bookId)}`, {
      credentials: 'same-origin',
    });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`Download failed (${res.status}).`);
    return await res.blob();
  },

  async remove(bookId) {
    /* Both objects, and a missing one is not an error — the book may never
       have finished uploading, and a delete that fails on that would block
       the tombstone from ever clearing. */
    await Promise.all(
      (['epub', 'cover'] as FileKind[]).map((kind) =>
        fetch(`/api/files/${kind}/${encodeURIComponent(bookId)}`, {
          method: 'DELETE',
          credentials: 'same-origin',
        }).catch(() => undefined)
      )
    );
  },
};

/* ── the backend ───────────────────────────────────────────────────── */

export const solunaBackend: Backend = {
  kind: 'soluna',
  auth,
  files,
  zeroCursor: 0,

  async pull(cursor: Cursor): Promise<Pulled> {
    const data = await call<Changes & { cursor: number }>(
      `/api/pull?cursor=${encodeURIComponent(String(cursor ?? 0))}`
    );
    const { cursor: next, ...changes } = data;
    return { cursor: next, changes };
  },

  async push(changes: Changes): Promise<Cursor> {
    const { cursor } = await post<{ cursor: number }>('/api/push', changes);
    return cursor;
  },
};
