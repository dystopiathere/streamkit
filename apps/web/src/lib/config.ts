/**
 * Адреса бэкенда.
 *
 * Нужны два разных значения, и их легко перепутать — что и произошло однажды:
 * HTTP-запросы уходили на origin без префикса `/api` и получали 404, причём
 * только в собранном бандле, потому что в разработке работает прокси Vite.
 *
 *  - `API_BASE`   — база HTTP-запросов, ВСЕГДА с префиксом `/api`;
 *  - `SOCKET_URL` — origin для socket.io, БЕЗ префикса: namespace задаётся отдельно.
 *
 * `VITE_API_URL` задаёт именно origin (`https://api.example.com`). Пустое
 * значение означает «тот же хост»: в разработке запросы идут через прокси Vite,
 * в проде — через тот же nginx, что отдаёт статику.
 */
const ORIGIN = import.meta.env.VITE_API_URL?.replace(/\/+$/, '') ?? '';

export const API_BASE = `${ORIGIN}/api`;

export const SOCKET_URL = ORIGIN.length > 0 ? ORIGIN : window.location.origin;
