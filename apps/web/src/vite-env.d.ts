/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Базовый URL API. В разработке пусто — работает прокси Vite на /api. */
  readonly VITE_API_URL?: string;
  /** Адрес сайта для canonical, hreflang и sitemap. По умолчанию — боевой. */
  readonly VITE_SITE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
