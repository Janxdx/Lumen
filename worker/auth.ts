/* Accounts, sessions, magic links and passkeys.

   The model in one paragraph. An account is an email address that has been
   proven — the only way to create one is to open a link sent to it. A
   session is a random token in an HttpOnly cookie, stored server-side as a
   hash. A passkey is an optional second way in, faster than email and
   bound to the device, which after the first sign-in becomes the way you
   actually use the app. There are no passwords anywhere in this file, and
   nothing here costs more than a millisecond of CPU. */

import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server';
import type {
  AuthenticationResponseJSON,
  RegistrationResponseJSON,
} from '@simplewebauthn/server';

import {
  CHALLENGE_TTL,
  LOGIN_TOKEN_TTL,
  SESSION_TTL,
  rpID,
  rpName,
  type Env,
} from './env';
import {
  HttpError,
  bad,
  readCookie,
  SESSION_COOKIE,
  tooMany,
  unauthorized,
} from './http';
import { fromBase64Url, hashToken, newId, randomToken, toBase64Url, utf8 } from './crypto';
import { sendLoginLink } from './mail';

export interface User {
  id: string;
  email: string;
}

/* ── housekeeping ──────────────────────────────────────────────────

   Expired rows are deleted opportunistically rather than on a schedule.
   A cron trigger would be tidier, but this costs one statement on paths
   that are already writing, and it means the tables cannot grow without
   bound just because nobody set the cron up. */

async function sweep(env: Env, now: number): Promise<void> {
  await env.DB.batch([
    env.DB.prepare('delete from login_tokens where expires_at < ?').bind(now),
    env.DB.prepare('delete from challenges where expires_at < ?').bind(now),
    env.DB.prepare('delete from auth_sessions where expires_at < ?').bind(now),
  ]);
}

/* ── rate limiting ─────────────────────────────────────────────────

   A fixed window per key. Crude — a burst can straddle a boundary and get
   two windows' worth — but the thing being prevented is a stranger using
   the endpoint to mail somebody repeatedly, and for that a rough ceiling
   is entirely adequate. */

async function limit(
  env: Env,
  key: string,
  max: number,
  windowMs: number
): Promise<void> {
  const now = Date.now();
  const row = await env.DB.prepare('select count, window_at from rate_limits where key = ?')
    .bind(key)
    .first<{ count: number; window_at: number }>();

  if (!row || now - row.window_at > windowMs) {
    await env.DB.prepare(
      `insert into rate_limits (key, count, window_at) values (?, 1, ?)
       on conflict(key) do update set count = 1, window_at = excluded.window_at`
    )
      .bind(key, now)
      .run();
    return;
  }

  if (row.count >= max) throw tooMany();

  await env.DB.prepare('update rate_limits set count = count + 1 where key = ?')
    .bind(key)
    .run();
}

/** The caller's address, as Cloudflare sees it. */
const clientIp = (req: Request): string =>
  req.headers.get('cf-connecting-ip') ?? 'unknown';

/* ── sessions ──────────────────────────────────────────────────────── */

/** Mint a session and return the cookie value to hand back. */
export async function createSession(
  env: Env,
  userId: string,
  userAgent: string | null
): Promise<string> {
  const token = randomToken();
  const now = Date.now();
  await env.DB.prepare(
    `insert into auth_sessions (token_hash, user_id, created_at, expires_at, user_agent)
     values (?, ?, ?, ?, ?)`
  )
    .bind(await hashToken(token), userId, now, now + SESSION_TTL, userAgent?.slice(0, 200) ?? null)
    .run();
  return token;
}

/** The signed-in user, or null. Never throws — callers decide what's required. */
export async function currentUser(env: Env, req: Request): Promise<User | null> {
  const token = readCookie(req, SESSION_COOKIE);
  if (!token) return null;

  const row = await env.DB.prepare(
    `select u.id as id, u.email as email, s.expires_at as expires_at
       from auth_sessions s join users u on u.id = s.user_id
      where s.token_hash = ?`
  )
    .bind(await hashToken(token))
    .first<{ id: string; email: string; expires_at: number }>();

  if (!row) return null;
  if (row.expires_at < Date.now()) {
    await env.DB.prepare('delete from auth_sessions where token_hash = ?')
      .bind(await hashToken(token))
      .run();
    return null;
  }
  return { id: row.id, email: row.email };
}

export async function requireUser(env: Env, req: Request): Promise<User> {
  const user = await currentUser(env, req);
  if (!user) throw unauthorized();
  return user;
}

export async function destroySession(env: Env, req: Request): Promise<void> {
  const token = readCookie(req, SESSION_COOKIE);
  if (!token) return;
  await env.DB.prepare('delete from auth_sessions where token_hash = ?')
    .bind(await hashToken(token))
    .run();
}

/* ── magic links ───────────────────────────────────────────────────── */

const normalise = (email: string): string => email.trim().toLowerCase();

const looksLikeEmail = (email: string): boolean =>
  /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) && email.length <= 254;

/** Step one: mail a single-use link. */
export async function requestLogin(env: Env, req: Request, email: string): Promise<void> {
  const key = normalise(email);
  if (!looksLikeEmail(key)) throw bad('That does not look like an email address.');

  const now = Date.now();
  await sweep(env, now);

  /* Two ceilings. The per-address one stops somebody mailbombing a person
     they dislike; the per-IP one stops a script walking an address list. */
  await limit(env, `login:addr:${key}`, 5, 15 * 60_000);
  await limit(env, `login:ip:${clientIp(req)}`, 20, 60 * 60_000);

  const token = randomToken();
  await env.DB.prepare(
    `insert into login_tokens (token_hash, email_key, created_at, expires_at)
     values (?, ?, ?, ?)`
  )
    .bind(await hashToken(token), key, now, now + LOGIN_TOKEN_TTL)
    .run();

  const link = `${env.APP_ORIGIN}/auth/callback?token=${encodeURIComponent(token)}`;
  await sendLoginLink(env, key, link);
}

/** Step two: spend the link and return the session cookie value. */
export async function completeLogin(
  env: Env,
  req: Request,
  token: string
): Promise<{ user: User; sessionToken: string }> {
  const now = Date.now();
  const hash = await hashToken(token);

  /* Read and delete in one statement. Doing it in two would leave a window
     in which the same link could be spent twice — by a mail scanner that
     pre-fetches URLs racing the human, most likely, but the fix is free. */
  const row = await env.DB.prepare(
    'delete from login_tokens where token_hash = ? returning email_key, expires_at'
  )
    .bind(hash)
    .first<{ email_key: string; expires_at: number }>();

  if (!row) throw new HttpError(400, 'That link has already been used.');
  if (row.expires_at < now) throw new HttpError(400, 'That link has expired.');

  const user = await upsertUser(env, row.email_key, now);
  const sessionToken = await createSession(env, user.id, req.headers.get('user-agent'));
  return { user, sessionToken };
}

async function upsertUser(env: Env, emailKey: string, now: number): Promise<User> {
  const existing = await env.DB.prepare('select id, email from users where email_key = ?')
    .bind(emailKey)
    .first<{ id: string; email: string }>();
  if (existing) return existing;

  const id = newId();
  await env.DB.prepare(
    `insert into users (id, email, email_key, created_at, verified_at, seq)
     values (?, ?, ?, ?, ?, 0)`
  )
    .bind(id, emailKey, emailKey, now, now)
    .run();
  return { id, email: emailKey };
}

/* ── passkeys ──────────────────────────────────────────────────────

   Two ceremonies, each in two halves. The server issues a challenge; the
   authenticator signs it; the server checks the signature against a stored
   public key. The challenge must be server-generated, single-use and
   short-lived, or the signature proves nothing about *when* it was made —
   which is the whole point of it. */

async function issueChallenge(
  env: Env,
  challenge: string,
  purpose: 'register' | 'login',
  userId: string | null
): Promise<void> {
  const now = Date.now();
  await env.DB.prepare(
    `insert into challenges (challenge, user_id, purpose, created_at, expires_at)
     values (?, ?, ?, ?, ?)`
  )
    .bind(challenge, userId, purpose, now, now + CHALLENGE_TTL)
    .run();
}

async function spendChallenge(
  env: Env,
  challenge: string,
  purpose: 'register' | 'login'
): Promise<{ user_id: string | null }> {
  const row = await env.DB.prepare(
    'delete from challenges where challenge = ? and purpose = ? returning user_id, expires_at'
  )
    .bind(challenge, purpose)
    .first<{ user_id: string | null; expires_at: number }>();

  if (!row) throw bad('That request has expired — try again.');
  if (row.expires_at < Date.now()) throw bad('That request has expired — try again.');
  return { user_id: row.user_id };
}

export async function passkeyRegisterOptions(env: Env, user: User) {
  const existing = await env.DB.prepare(
    'select id, transports from credentials where user_id = ?'
  )
    .bind(user.id)
    .all<{ id: string; transports: string | null }>();

  const options = await generateRegistrationOptions({
    rpName,
    rpID: rpID(env),
    userID: utf8(user.id),
    userName: user.email,
    userDisplayName: user.email,
    /* Telling the browser what this account already has prevents a second
       passkey for the same device — it prompts to use the existing one
       instead of quietly stacking duplicates the user never sees. */
    excludeCredentials: (existing.results ?? []).map((c) => ({
      id: c.id,
      transports: c.transports ? (JSON.parse(c.transports) as never) : undefined,
    })),
    authenticatorSelection: {
      /* Discoverable so signing in needs no email first: the browser can
         offer the key by itself, which is what makes a passkey feel instant
         rather than being a second step after typing an address. */
      residentKey: 'preferred',
      userVerification: 'preferred',
    },
  });

  await issueChallenge(env, options.challenge, 'register', user.id);
  return options;
}

export async function passkeyRegisterVerify(
  env: Env,
  user: User,
  response: RegistrationResponseJSON,
  label: string | null
): Promise<void> {
  const challenge = challengeFromClientData(response.response.clientDataJSON);
  const stored = await spendChallenge(env, challenge, 'register');

  /* The challenge was issued to somebody. If that isn't the session
     presenting it, refuse — otherwise one account could register a key
     against a challenge minted for another. */
  if (stored.user_id !== user.id) throw bad('That request belongs to another account.');

  const verification = await verifyRegistrationResponse({
    response,
    expectedChallenge: challenge,
    expectedOrigin: env.APP_ORIGIN,
    expectedRPID: rpID(env),
    requireUserVerification: false,
  });

  if (!verification.verified || !verification.registrationInfo) {
    throw bad('That passkey could not be verified.');
  }

  const { credential } = verification.registrationInfo;
  await env.DB.prepare(
    `insert into credentials (id, user_id, public_key, counter, transports, label, created_at)
     values (?, ?, ?, ?, ?, ?, ?)
     on conflict(id) do update set counter = excluded.counter`
  )
    .bind(
      credential.id,
      user.id,
      toBase64Url(credential.publicKey),
      credential.counter,
      JSON.stringify(credential.transports ?? []),
      label?.slice(0, 60) ?? null,
      Date.now()
    )
    .run();
}

export async function passkeyLoginOptions(env: Env) {
  const options = await generateAuthenticationOptions({
    rpID: rpID(env),
    userVerification: 'preferred',
    /* Empty: any passkey for this site may answer. The browser knows which
       ones it holds, and asking the server first would mean naming the
       account before proving anything about it. */
    allowCredentials: [],
  });
  await issueChallenge(env, options.challenge, 'login', null);
  return options;
}

export async function passkeyLoginVerify(
  env: Env,
  req: Request,
  response: AuthenticationResponseJSON
): Promise<{ user: User; sessionToken: string }> {
  const challenge = challengeFromClientData(response.response.clientDataJSON);
  await spendChallenge(env, challenge, 'login');

  const cred = await env.DB.prepare(
    `select c.id as id, c.public_key as public_key, c.counter as counter,
            c.transports as transports, u.id as user_id, u.email as email
       from credentials c join users u on u.id = c.user_id
      where c.id = ?`
  )
    .bind(response.id)
    .first<{
      id: string;
      public_key: string;
      counter: number;
      transports: string | null;
      user_id: string;
      email: string;
    }>();

  if (!cred) throw unauthorized('That passkey is not registered.');

  const verification = await verifyAuthenticationResponse({
    response,
    expectedChallenge: challenge,
    expectedOrigin: env.APP_ORIGIN,
    expectedRPID: rpID(env),
    credential: {
      id: cred.id,
      publicKey: fromBase64Url(cred.public_key),
      counter: cred.counter,
      transports: cred.transports ? (JSON.parse(cred.transports) as never) : undefined,
    },
    requireUserVerification: false,
  });

  if (!verification.verified) throw unauthorized('That passkey could not be verified.');

  /* The counter is the clone check: a genuine authenticator only ever
     counts up. Apple's keychain reports zero every time, which is allowed
     and means the signal simply isn't available for those — hence storing
     whatever comes back rather than insisting it grew. */
  await env.DB.prepare(
    'update credentials set counter = ?, last_used_at = ? where id = ?'
  )
    .bind(verification.authenticationInfo.newCounter, Date.now(), cred.id)
    .run();

  const user = { id: cred.user_id, email: cred.email };
  const sessionToken = await createSession(env, user.id, req.headers.get('user-agent'));
  return { user, sessionToken };
}

export async function listPasskeys(env: Env, user: User) {
  const rows = await env.DB.prepare(
    'select id, label, created_at, last_used_at from credentials where user_id = ? order by created_at'
  )
    .bind(user.id)
    .all<{ id: string; label: string | null; created_at: number; last_used_at: number | null }>();
  return (rows.results ?? []).map((r) => ({
    id: r.id,
    label: r.label,
    createdAt: r.created_at,
    lastUsedAt: r.last_used_at,
  }));
}

export async function removePasskey(env: Env, user: User, id: string): Promise<void> {
  // scoped by user_id as well as id: without it, anyone could delete anyone's
  await env.DB.prepare('delete from credentials where id = ? and user_id = ?')
    .bind(id, user.id)
    .run();
}

/* The challenge the authenticator actually signed is inside clientDataJSON.
   Reading it from there rather than trusting a value the client sends
   alongside is the difference between checking a signature and checking
   that the client agrees with itself. */
function challengeFromClientData(clientDataJSON: string): string {
  try {
    const parsed = JSON.parse(new TextDecoder().decode(fromBase64Url(clientDataJSON))) as {
      challenge?: string;
    };
    if (!parsed.challenge) throw new Error('no challenge');
    return parsed.challenge;
  } catch {
    throw bad('Malformed passkey response.');
  }
}
