/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Which backend to use: 'lumen' (the Worker), 'supabase', or 'none'.
      Unset means: Supabase if it is configured, otherwise the Worker. */
  readonly VITE_BACKEND?: string;
  /** Supabase project URL, e.g. https://xxxx.supabase.co — optional. */
  readonly VITE_SUPABASE_URL?: string;
  /** Supabase anon/publishable key. Safe in the client: RLS does the guarding. */
  readonly VITE_SUPABASE_ANON_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
