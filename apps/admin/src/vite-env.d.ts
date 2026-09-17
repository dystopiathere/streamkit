/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Origin API. В разработке пусто — работает прокси Vite на /api. */
  readonly VITE_API_URL?: string;
  /** Адрес интерфейса Umami (`https://stats.<домен>`). Пусто — ссылки нет. */
  readonly VITE_STATS_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
