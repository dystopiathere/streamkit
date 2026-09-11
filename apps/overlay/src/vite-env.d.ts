/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Базовый URL API. Указывается при сборке образа, не в рантайме. */
  readonly VITE_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
