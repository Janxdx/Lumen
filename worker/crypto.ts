/* The three cryptographic things this server does.

   Deliberately tiny. There is no password hashing here and that is the
   point: on the Workers free plan a request gets 10ms of CPU, and an honest
   password hash costs twenty times that. Tuning one down to fit would mean
   storing a hash weak enough to be worth cracking, so Soluna has no
   passwords at all — a magic link proves you own the address, a passkey
   proves you hold the key, and both are verified in well under a
   millisecond. */

/** base64url, the encoding WebAuthn and URLs both want. */
export function toBase64Url(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = '';
  for (const b of view) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/* The return type is pinned to a plain ArrayBuffer rather than the wider
   ArrayBufferLike: WebAuthn's verifiers will not accept a view that might
   be over a SharedArrayBuffer, and being explicit here saves a cast at
   every call site. */
export function fromBase64Url(s: string): Uint8Array<ArrayBuffer> {
  const padded = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** UTF-8 bytes, in the same pinned-buffer form. */
export function utf8(s: string): Uint8Array<ArrayBuffer> {
  const encoded = new TextEncoder().encode(s);
  const out = new Uint8Array(new ArrayBuffer(encoded.length));
  out.set(encoded);
  return out;
}

/** A fresh secret. 32 bytes of CSPRNG output — not guessable, not derived. */
export const randomToken = (): string =>
  toBase64Url(crypto.getRandomValues(new Uint8Array(32)));

/** Same, formatted as a user id. */
export const newId = (): string => crypto.randomUUID();

/* Tokens are stored as their SHA-256, never in the clear, so a leaked
   database is not a set of working sessions.

   A plain hash is correct here and would be wrong for a password. The
   reason is entropy, not laziness: these values are 256 random bits, so
   there is no dictionary to walk and nothing for a deliberately slow KDF to
   make expensive. Passwords are guessable and need the slowness; this does
   not. */
export async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return toBase64Url(digest);
}

/* Comparing secrets with === leaks their contents through timing: the
   comparison stops at the first differing byte, so the time it takes says
   how much of a guess was right, and an attacker can walk a value out one
   byte at a time.

   In practice we compare *hashes* and look them up by primary key, so the
   exposure is small — but "small" is a bad thing to rely on, and constant
   time costs nothing. */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
