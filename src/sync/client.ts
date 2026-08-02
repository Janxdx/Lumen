/* Which backend is live, and the one place that decides.

   Three states, and the app is fully usable in all of them:

     lumen     — Lumen's own Worker on Cloudflare. Same origin as the app,
                 so there is nothing to configure: no project URL, no
                 publishable key, no SDK.
     supabase  — the hosted backend, when its env vars are present.
     none      — no server at all. The reader is local-first, so this is a
                 supported way to run it rather than a broken one: no
                 account screen, no network, everything else works.

   Selection is by preference, not by guesswork. `VITE_BACKEND` settles it
   outright when set; otherwise Supabase wins if it is configured, because a
   half-migrated install should keep syncing to the place that already holds
   the books. */

import type { Backend } from './backend';
import { supabaseBackend, supabaseConfigured } from './adapters/supabase';
import { lumenBackend } from './adapters/lumen';

type Choice = 'lumen' | 'supabase' | 'none';

const preference = ((import.meta.env ?? ({} as ImportMetaEnv)).VITE_BACKEND?.trim() ??
  '') as Choice | '';

const chosen: Choice =
  preference === 'lumen' || preference === 'supabase' || preference === 'none'
    ? preference
    : supabaseConfigured
      ? 'supabase'
      : 'lumen';

export const backend: Backend | null =
  chosen === 'supabase' ? supabaseBackend : chosen === 'lumen' ? lumenBackend : null;

export const syncEnabled = backend !== null;

export const backendKind = chosen;

/** Narrow the null away at call sites that already checked `syncEnabled`. */
export function requireBackend(): Backend {
  if (!backend) throw new Error('No backend is configured.');
  return backend;
}

/** Errors from three different layers, made readable. */
export function humanError(e: unknown): string {
  if (!e) return 'Something went wrong.';
  const msg =
    typeof e === 'string' ? e : ((e as { message?: string }).message ?? String(e));

  /* WebAuthn speaks in DOMException names rather than sentences, and the two
     users actually hit both mean "nothing happened" rather than "something
     broke" — worth saying differently. */
  const name = (e as { name?: string }).name;
  if (name === 'NotAllowedError') return 'Passkey cancelled.';
  if (name === 'InvalidStateError')
    return 'This device already has a passkey for that account.';

  if (/invalid login credentials/i.test(msg)) return 'Wrong email or password.';
  if (/email not confirmed/i.test(msg))
    return 'Check your inbox and confirm your email first.';
  if (/user already registered/i.test(msg))
    return 'That email already has an account — sign in instead.';
  if (/password should be at least/i.test(msg))
    return 'Password must be at least 6 characters.';
  if (/rate limit|too many|429/i.test(msg))
    return 'Too many attempts. Wait a minute and try again.';
  if (/failed to fetch|networkerror|load failed/i.test(msg))
    return 'No connection to the server.';
  if (/unexpected token|not valid json/i.test(msg))
    return 'The server is not responding correctly — is the Worker running?';
  return msg;
}
