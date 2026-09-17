/**
 * Адрес API. `VITE_API_URL` — origin без `/api`, как в дашборде; пустое
 * значение — тот же хост (в разработке это прокси Vite).
 */
const ORIGIN = import.meta.env.VITE_API_URL?.replace(/\/+$/, '') ?? '';

export const API_BASE = `${ORIGIN}/api`;

/** Интерфейс статистики посещений — ссылка из обзора, сами визиты здесь не дублируются. */
export const STATS_URL = import.meta.env.VITE_STATS_URL ?? '';
