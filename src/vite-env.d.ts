/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Which backend to use: 'soluna' (the Worker, default) or 'none' (local
      only, no sync). Unset means 'soluna'. */
  readonly VITE_BACKEND?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
