/* Account state.

   Deliberately thin: it owns *who is signed in* and nothing else. Sync is a
   separate module that reads the user id from here, so the reader keeps
   working in full when this store says "signed out" — which is also what it
   says when no backend is configured at all. */

import { create } from 'zustand';
import { humanError, supabase, syncEnabled } from '../sync/client';

export interface AuthUser {
  id: string;
  email: string;
}

interface AuthState {
  /** false until the persisted session has been checked on boot */
  ready: boolean;
  user: AuthUser | null;
  busy: boolean;
  error: string | null;
  /** set after sign-up when the project requires email confirmation */
  notice: string | null;

  init(): void;
  signUp(email: string, password: string): Promise<boolean>;
  signIn(email: string, password: string): Promise<boolean>;
  signOut(): Promise<void>;
  resetPassword(email: string): Promise<boolean>;
  clearMessages(): void;
}

let subscribed = false;

export const useAuth = create<AuthState>((set, get) => ({
  ready: !syncEnabled, // nothing to wait for when sync is switched off
  user: null,
  busy: false,
  error: null,
  notice: null,

  init() {
    if (!supabase || subscribed) return;
    subscribed = true;

    void supabase.auth.getSession().then(({ data }) => {
      const u = data.session?.user;
      set({
        ready: true,
        user: u ? { id: u.id, email: u.email ?? '' } : null,
      });
    });

    // fires on token refresh and on sign-in/out in another tab
    supabase.auth.onAuthStateChange((_event, session) => {
      const u = session?.user;
      set({ user: u ? { id: u.id, email: u.email ?? '' } : null, ready: true });
    });
  },

  async signUp(email, password) {
    if (!supabase) return false;
    set({ busy: true, error: null, notice: null });
    const { data, error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      // point the confirmation link at wherever this page actually runs,
      // rather than trusting the project's default Site URL (Supabase seeds
      // that with localhost:3000, which is never right for a deployed app)
      options: { emailRedirectTo: location.origin },
    });
    if (error) {
      set({ busy: false, error: humanError(error) });
      return false;
    }
    // no session back means the project has email confirmation switched on
    if (!data.session) {
      set({
        busy: false,
        notice: `Almost there — confirm the link we sent to ${email.trim()}, then sign in.`,
      });
      return false;
    }
    set({ busy: false });
    return true;
  },

  async signIn(email, password) {
    if (!supabase) return false;
    set({ busy: true, error: null, notice: null });
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    if (error) {
      set({ busy: false, error: humanError(error) });
      return false;
    }
    set({ busy: false });
    return true;
  },

  async signOut() {
    if (!supabase) return;
    set({ busy: true, error: null, notice: null });
    await supabase.auth.signOut();
    set({ busy: false, user: null });
  },

  async resetPassword(email) {
    if (!supabase) return false;
    if (!email.trim()) {
      set({ error: 'Enter your email address first.' });
      return false;
    }
    set({ busy: true, error: null, notice: null });
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: location.origin,
    });
    set({
      busy: false,
      error: error ? humanError(error) : null,
      notice: error ? null : 'Reset link sent. Check your inbox.',
    });
    return !error;
  },

  clearMessages() {
    if (get().error || get().notice) set({ error: null, notice: null });
  },
}));
