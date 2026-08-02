/* Which backend is live, and the one place that decides.

   Two states, and the app is fully usable in both:

     soluna  — Soluna's own Worker on Cloudflare (D1 + R2). Same origin as the
              app, so there is nothing to configure: no project URL, no key,
              no SDK.
     none   — no server at all. The reader is local-first, so this is a
              supported way to run it rather than a broken one: no account
              screen, no network, everything else works.

   `VITE_BACKEND=none` is the only thing that turns sync off; anything else
   (including unset) means the Worker. */

import type { Backend } from './backend';
import { solunaBackend } from './adapters/soluna';

type Choice = 'soluna' | 'none';

const preference = ((import.meta.env ?? ({} as ImportMetaEnv)).VITE_BACKEND?.trim() ??
  '') as Choice | '';

const chosen: Choice = preference === 'none' ? 'none' : 'soluna';

export const backend: Backend | null = chosen === 'soluna' ? solunaBackend : null;

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

  if (/rate limit|too many|429/i.test(msg))
    return 'Too many attempts. Wait a minute and try again.';
  if (/failed to fetch|networkerror|load failed/i.test(msg))
    return 'No connection to the server.';
  if (/unexpected token|not valid json/i.test(msg))
    return 'The server is not responding correctly — is the Worker running?';
  return msg;
}
