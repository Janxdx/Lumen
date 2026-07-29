import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useAuth } from '../store/auth';
import { useLibrary } from '../store/library';
import { useSync } from '../sync/sync';
import { syncEnabled } from '../sync/client';
import { formatCount, formatDuration, totals } from '../engine/stats';
import {
  IconAccount,
  IconCheck,
  IconCloud,
  IconDownload,
  IconExit,
  IconSync,
} from './Icons';

const relative = (t: number | null): string => {
  if (!t) return 'never';
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
};

export function Account() {
  const { ready, user, busy, error, notice, signIn, signUp, signOut, resetPassword, clearMessages } =
    useAuth();

  if (!syncEnabled) return <NotConfigured />;
  if (!ready) return <div className="scroller" />;

  return user ? (
    <SignedIn onSignOut={signOut} email={user.email} busy={busy} />
  ) : (
    <SignIn
      busy={busy}
      error={error}
      notice={notice}
      onSignIn={signIn}
      onSignUp={signUp}
      onReset={resetPassword}
      onEdit={clearMessages}
    />
  );
}

/* ── signed out ──────────────────────────────────────────────────── */

interface SignInProps {
  busy: boolean;
  error: string | null;
  notice: string | null;
  onSignIn(email: string, password: string): Promise<boolean>;
  onSignUp(email: string, password: string): Promise<boolean>;
  onReset(email: string): Promise<boolean>;
  onEdit(): void;
}

function SignIn({ busy, error, notice, onSignIn, onSignUp, onReset, onEdit }: SignInProps) {
  const [mode, setMode] = useState<'in' | 'up'>('in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const books = useLibrary((s) => s.books.length);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (mode === 'in') await onSignIn(email, password);
    else await onSignUp(email, password);
  };

  const valid = /\S+@\S+\.\S+/.test(email) && password.length >= 6;

  return (
    <div className="scroller">
      <div className="wrap auth">
        <div className="auth-mark">
          <IconCloud size={26} />
        </div>

        <h1 className="display">
          {mode === 'in' ? 'Welcome back' : 'Keep your library'}
        </h1>
        <p className="auth-lede">
          {mode === 'in'
            ? 'Sign in to pick up exactly where you left off, on any device.'
            : 'An account syncs your books, your place in each one, and every statistic across your devices.'}
        </p>

        <form className="auth-form" onSubmit={submit}>
          <label className="field">
            <span>Email</span>
            <input
              type="email"
              inputMode="email"
              autoComplete="email"
              autoCapitalize="none"
              spellCheck={false}
              value={email}
              placeholder="you@example.com"
              onChange={(e) => {
                setEmail(e.target.value);
                onEdit();
              }}
            />
          </label>

          <label className="field">
            <span>Password</span>
            <input
              type="password"
              autoComplete={mode === 'in' ? 'current-password' : 'new-password'}
              value={password}
              placeholder={mode === 'up' ? 'At least 6 characters' : '••••••••'}
              onChange={(e) => {
                setPassword(e.target.value);
                onEdit();
              }}
            />
          </label>

          {error && <div className="auth-msg bad">{error}</div>}
          {notice && <div className="auth-msg good">{notice}</div>}

          <button className="btn primary auth-submit" disabled={!valid || busy}>
            {busy ? 'One moment…' : mode === 'in' ? 'Sign in' : 'Create account'}
          </button>
        </form>

        <div className="auth-alt">
          {mode === 'in' ? (
            <>
              <button
                className="linky"
                onClick={() => {
                  setMode('up');
                  onEdit();
                }}
              >
                Create an account
              </button>
              <button className="linky muted" onClick={() => void onReset(email)}>
                Forgot password
              </button>
            </>
          ) : (
            <button
              className="linky"
              onClick={() => {
                setMode('in');
                onEdit();
              }}
            >
              I already have an account
            </button>
          )}
        </div>

        {books > 0 && mode === 'up' && (
          <p className="auth-foot">
            The {books} {books === 1 ? 'book' : 'books'} already on this device will be
            uploaded to your new account.
          </p>
        )}
        <p className="auth-foot">
          Reading works without an account. Nothing leaves this device until you sign in.
        </p>
      </div>
    </div>
  );
}

/* ── signed in ───────────────────────────────────────────────────── */

function SignedIn({
  email,
  busy,
  onSignOut,
}: {
  email: string;
  busy: boolean;
  onSignOut(): Promise<void>;
}) {
  const { status, step, error, lastSyncedAt, pendingUploads, missingFiles, syncNow, downloadAll, init, forget } =
    useSync();
  const { books, sessions } = useLibrary();
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    void init();
    void syncNow();
  }, [init, syncNow]);

  const t = useMemo(() => totals(sessions), [sessions]);
  const initial = email.trim().charAt(0).toUpperCase() || '?';

  const label =
    status === 'syncing'
      ? (step ?? 'Syncing…')
      : status === 'offline'
        ? 'Offline — will sync when you reconnect'
        : status === 'error'
          ? (error ?? 'Sync failed')
          : `Last synced ${relative(lastSyncedAt)}`;

  return (
    <div className="scroller">
      <div className="wrap">
        <div className="eyebrow">Account</div>

        <div className="acct-head">
          <div className="avatar">{initial}</div>
          <div className="acct-id">
            <div className="acct-email">{email}</div>
            <div className={`acct-status ${status}`}>
              {status === 'syncing' ? (
                <IconSync size={14} className="spin" />
              ) : status === 'idle' ? (
                <IconCheck size={14} />
              ) : (
                <IconCloud size={14} />
              )}
              <span>{label}</span>
            </div>
          </div>
        </div>

        <div className="stat-grid">
          <div className="card">
            <div className="k">Synced books</div>
            <div className="v num">{books.length}</div>
            {pendingUploads > 0 && (
              <div className="sub">{pendingUploads} still uploading</div>
            )}
          </div>
          <div className="card">
            <div className="k">Sessions</div>
            <div className="v num">{formatCount(sessions.length)}</div>
          </div>
          <div className="card">
            <div className="k">Time read</div>
            <div className="v num">{formatDuration(t.ms)}</div>
          </div>
        </div>

        <div className="panel">
          <div className="row">
            <div>
              <div className="label">Sync now</div>
              <div className="hint">
                Progress, statistics, bookmarks and settings, both ways.
              </div>
            </div>
            <button
              className="btn"
              disabled={status === 'syncing'}
              onClick={() => void syncNow()}
            >
              <IconSync size={16} className={status === 'syncing' ? 'spin' : undefined} />
              {status === 'syncing' ? 'Syncing' : 'Sync'}
            </button>
          </div>

          <div className="row">
            <div>
              <div className="label">Books on this device</div>
              <div className="hint">
                {missingFiles === 0
                  ? 'Every book in your library is downloaded.'
                  : `${missingFiles} ${missingFiles === 1 ? 'book is' : 'books are'} in the cloud only — they download when you open them.`}
              </div>
            </div>
            <button
              className="btn"
              disabled={missingFiles === 0 || status === 'syncing'}
              onClick={() => void downloadAll()}
            >
              <IconDownload size={16} />
              Download all
            </button>
          </div>

          <div className="row">
            <div>
              <div className="label">Sign out</div>
              <div className="hint">
                Your books stay on this device. Sync stops until you sign back in.
              </div>
            </div>
            {confirming ? (
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn ghost" onClick={() => setConfirming(false)}>
                  Cancel
                </button>
                <button
                  className="btn primary"
                  disabled={busy}
                  onClick={() => {
                    void (async () => {
                      await syncNow();
                      await forget();
                      await onSignOut();
                    })();
                  }}
                >
                  Sign out
                </button>
              </div>
            ) : (
              <button className="btn" onClick={() => setConfirming(true)}>
                <IconExit size={16} />
                Sign out
              </button>
            )}
          </div>
        </div>

        {status === 'error' && error && <div className="auth-msg bad">{error}</div>}
      </div>
    </div>
  );
}

/* ── no backend configured ───────────────────────────────────────── */

function NotConfigured() {
  return (
    <div className="scroller">
      <div className="wrap auth">
        <div className="auth-mark">
          <IconAccount size={26} />
        </div>
        <h1 className="display">Sync is switched off</h1>
        <p className="auth-lede">
          Lumen is running without a backend, so everything stays on this device.
          Add <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code> to
          your environment, run <code>supabase/schema.sql</code> once, and accounts
          appear here.
        </p>
      </div>
    </div>
  );
}
