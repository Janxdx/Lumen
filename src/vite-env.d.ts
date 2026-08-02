/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Which backend to use: 'lumen' (the Worker, default) or 'none' (local
      only, no sync). Unset means 'lumen'. */
  readonly VITE_BACKEND?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
