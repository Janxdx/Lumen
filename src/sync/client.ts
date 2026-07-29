/* The one place that knows about Supabase.

   Everything downstream talks to `supabase` through this module, so moving
   to a self-hosted backend later means changing the URL in an env file —
   or, if the backend stops being Supabase entirely, replacing this file and
   the thin wrappers in sync.ts rather than hunting through the UI.

   Sync is strictly optional. With no credentials configured the client is
   null, `syncEnabled` is false, and Lumen behaves exactly as it did before:
   a local-first reader that never touches the network. */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL?.trim();
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim();

export const syncEnabled = Boolean(url && anonKey);

export const supabase: SupabaseClient | null = syncEnabled
  ? createClient(url as string, anonKey as string, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        // the reader is a PWA opened from the home screen, never a redirect target
        detectSessionInUrl: false,
        storageKey: 'lumen.auth',
      },
    })
  : null;

/** Bucket holding one folder per user: `<user id>/<book id>.epub`. */
export const BUCKET = 'books';

/** Narrow the null away at call sites that already checked `syncEnabled`. */
export function requireClient(): SupabaseClient {
  if (!supabase) {
    throw new Error(
      'Sync is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.'
    );
  }
  return supabase;
}

/** Supabase and Postgres errors arrive in several shapes; make them readable. */
export function humanError(e: unknown): string {
  if (!e) return 'Something went wrong.';
  const msg =
    typeof e === 'string'
      ? e
      : ((e as { message?: string }).message ?? String(e));

  if (/invalid login credentials/i.test(msg)) return 'Wrong email or password.';
  if (/email not confirmed/i.test(msg))
    return 'Check your inbox and confirm your email first.';
  if (/user already registered/i.test(msg))
    return 'That email already has an account — sign in instead.';
  if (/password should be at least/i.test(msg))
    return 'Password must be at least 6 characters.';
  if (/rate limit|too many requests/i.test(msg))
    return 'Too many attempts. Wait a minute and try again.';
  if (/failed to fetch|networkerror|load failed/i.test(msg))
    return 'No connection to the server.';
  return msg;
}
