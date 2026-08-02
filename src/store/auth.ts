/* Account state.

   Deliberately thin: it owns *who is signed in* and nothing else. Sync is a
   separate module that reads the user id from here, so the reader keeps
   working in full when this store says "signed out" — which is also what it
   says when no backend is configured at all.

   It speaks to the backend port rather than to any particular server, and
   exposes the same handful of actions whichever one is live. Which of them
   are actually usable is `capabilities`: the account screen renders from
   that rather than assuming, so a backend without passwords doesn't show a
   password field. */

import { create } from 'zustand';
import { backend, humanError, syncEnabled } from '../sync/client';
import type { AuthCapabilities, AuthUser, Passkey } from '../sync/backend';

export type { AuthUser } from '../sync/backend';

interface AuthState {
  /** false until the persisted session has been checked on boot */
  ready: boolean;
  user: AuthUser | null;
  busy: boolean;
  error: string | null;
  /** something went right and is worth saying — a link sent, a key added */
  notice: string | null;
  capabilities: AuthCapabilities;
  passkeys: Passkey[];
  /** whether this browser can do WebAuthn at all */
  passkeysUsable: boolean;

  init(): void;
  /* password backends */
  signUp(email: string, password: string): Promise<boolean>;
  signIn(email: string, password: string): Promise<boolean>;
  resetPassword(email: string): Promise<boolean>;
  resendConfirmation(): Promise<boolean>;
  /* link backends */
  requestLink(email: string): Promise<boolean>;
  /* passkeys */
  loadPasskeys(): Promise<void>;
  addPasskey(label: string): Promise<boolean>;
  removePasskey(id: string): Promise<void>;
  signInWithPasskey(): Promise<boolean>;

  signOut(): Promise<void>;
  recheck(): Promise<void>;
  clearMessages(): void;
}

const NO_CAPS: AuthCapabilities = { passwords: false, magicLink: false, passkeys: false };

let subscribed = false;

export const useAuth = create<AuthState>((set, get) => ({
  ready: !syncEnabled, // nothing to wait for when sync is switched off
  user: null,
  busy: false,
  error: null,
  notice: null,
  capabilities: backend?.auth.capabilities ?? NO_CAPS,
  passkeys: [],
  passkeysUsable: false,

  init() {
    if (!backend || subscribed) return;
    subscribed = true;

    void backend.auth
      .current()
      .then((user) => set({ ready: true, user }))
      /* A failure here is "no session", not a crash. On the Worker adapter
         it also covers the case where no Worker is running behind the dev
         server — the account screen then simply offers to sign in, and the
         attempt reports something legible. */
      .catch(() => set({ ready: true, user: null }));

    backend.auth.subscribe((user) => set({ user, ready: true }));

    void backend.auth.passkeysUsable?.().then((usable) => set({ passkeysUsable: usable }));

    /* A magic link opens in Mail, not here, and a passkey prompt can be
       answered on another device. Coming back to the app is the moment to
       find out whether either happened. */
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && !get().user) void get().recheck();
    });

    /* The Worker redirects back with a marker after a link is spent. Strip
       it once read, so a reload doesn't replay the message. */
    const params = new URLSearchParams(location.hash.split('?')[1] ?? '');
    if (params.get('welcome')) {
      set({ notice: 'Signed in.' });
      history.replaceState(null, '', location.pathname + location.hash.split('?')[0]);
    } else if (params.get('error')) {
      const why = params.get('error');
      set({
        error:
          why === 'expired'
            ? 'That link has expired — ask for a new one.'
            : 'That link could not be used. Ask for a new one.',
      });
      history.replaceState(null, '', location.pathname + location.hash.split('?')[0]);
    }
  },

  /* ── passwords ─────────────────────────────────────────────────── */

  async signUp(email, password) {
    if (!backend?.auth.signUp) return false;
    set({ busy: true, error: null, notice: null });
    try {
      const user = await backend.auth.signUp(email, password);
      if (user && !user.verified) {
        set({
          busy: false,
          user,
          notice: `Almost there — confirm the link we sent to ${email.trim()}, then sync will start.`,
        });
        return false;
      }
      set({ busy: false, user });
      return true;
    } catch (e) {
      set({ busy: false, error: humanError(e) });
      return false;
    }
  },

  async signIn(email, password) {
    if (!backend?.auth.signIn) return false;
    set({ busy: true, error: null, notice: null });
    try {
      const user = await backend.auth.signIn(email, password);
      set({ busy: false, user });
      return true;
    } catch (e) {
      set({ busy: false, error: humanError(e) });
      return false;
    }
  },

  async resetPassword(email) {
    if (!backend?.auth.resetPassword) return false;
    if (!email.trim()) {
      set({ error: 'Enter your email address first.' });
      return false;
    }
    set({ busy: true, error: null, notice: null });
    try {
      await backend.auth.resetPassword(email);
      set({ busy: false, notice: 'Reset link sent. Check your inbox.' });
      return true;
    } catch (e) {
      set({ busy: false, error: humanError(e) });
      return false;
    }
  },

  async resendConfirmation() {
    const email = get().user?.email;
    if (!backend?.auth.resendConfirmation || !email) return false;
    set({ busy: true, error: null, notice: null });
    try {
      await backend.auth.resendConfirmation(email);
      set({ busy: false, notice: `Sent again to ${email}.` });
      return true;
    } catch (e) {
      set({ busy: false, error: humanError(e) });
      return false;
    }
  },

  /* ── magic link ────────────────────────────────────────────────── */

  async requestLink(email) {
    if (!backend?.auth.requestLink) return false;
    set({ busy: true, error: null, notice: null });
    try {
      await backend.auth.requestLink(email);
      set({
        busy: false,
        notice: `Check ${email.trim()} — the link works once and expires in 15 minutes.`,
      });
      return true;
    } catch (e) {
      set({ busy: false, error: humanError(e) });
      return false;
    }
  },

  /* ── passkeys ──────────────────────────────────────────────────── */

  async loadPasskeys() {
    if (!backend?.auth.listPasskeys || !get().user) return;
    try {
      set({ passkeys: await backend.auth.listPasskeys() });
    } catch {
      /* a listing that fails is not worth interrupting anyone over */
    }
  },

  async addPasskey(label) {
    if (!backend?.auth.registerPasskey) return false;
    set({ busy: true, error: null, notice: null });
    try {
      const passkeys = await backend.auth.registerPasskey(label);
      set({ busy: false, passkeys, notice: 'Passkey added — next time, just Face ID.' });
      return true;
    } catch (e) {
      set({ busy: false, error: humanError(e) });
      return false;
    }
  },

  async removePasskey(id) {
    if (!backend?.auth.removePasskey) return;
    set({ busy: true, error: null, notice: null });
    try {
      set({ busy: false, passkeys: await backend.auth.removePasskey(id) });
    } catch (e) {
      set({ busy: false, error: humanError(e) });
    }
  },

  async signInWithPasskey() {
    if (!backend?.auth.signInWithPasskey) return false;
    set({ busy: true, error: null, notice: null });
    try {
      const user = await backend.auth.signInWithPasskey();
      set({ busy: false, user });
      return true;
    } catch (e) {
      set({ busy: false, error: humanError(e) });
      return false;
    }
  },

  /* ── shared ────────────────────────────────────────────────────── */

  async signOut() {
    if (!backend) return;
    set({ busy: true, error: null, notice: null });
    await backend.auth.signOut().catch(() => undefined);
    set({ busy: false, user: null, passkeys: [] });
  },

  async recheck() {
    if (!backend) return;
    const before = get().user;
    const user = await backend.auth.current().catch(() => null);
    if (!before && user) set({ notice: 'Signed in.' });
    set({ user });
  },

  clearMessages() {
    if (get().error || get().notice) set({ error: null, notice: null });
  },
}));
