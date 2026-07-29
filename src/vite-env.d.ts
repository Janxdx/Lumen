/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Supabase project URL, e.g. https://xxxx.supabase.co — optional. */
  readonly VITE_SUPABASE_URL?: string;
  /** Supabase anon/publishable key. Safe in the client: RLS does the guarding. */
  readonly VITE_SUPABASE_ANON_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
