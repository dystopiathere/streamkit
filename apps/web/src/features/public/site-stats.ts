import { readCookieChoice } from '@/lib/cookie-consent';

declare global {
  interface Window {
    umami?: { track: (event?: string, data?: Record<string, string | number>) => void };
    [SITE_STATS_BEFORE_SEND]?: (type: string, payload: SiteStatsPayload) => SiteStatsPayload;
  }
}

interface SiteStatsPayload {
  url?: string;
  referrer?: string;
  [key: string]: unknown;
}

const SITE_STATS_BEFORE_SEND = 'streamkitSiteStatsBeforeSend';

/**
 * Что уходит в статистику из адресов.
 *
 * Из адреса страницы — путь и только метки `utm_*`: по ним видно, из какой
 * рекламы или поста пришёл человек, а всё прочее в строке запроса (код входа
 * площадки, чей-то токен в ссылке) статистике не нужно. Из адреса перехода —
 * сайт и путь: в строке запроса поисковика или мессенджера бывает что угодно.
 */
export function sanitizeSiteStatsPayload(payload: SiteStatsPayload): SiteStatsPayload {
  const origin = window.location.origin;
  const result = { ...payload };
  if (payload.url) {
    const url = new URL(payload.url, origin);
    const utm = [...url.searchParams].filter(([key]) => key.startsWith('utm_'));
    const query = new URLSearchParams(utm).toString();
    result.url = `${url.pathname}${query ? `?${query}` : ''}`;
  }
  if (payload.referrer) {
    try {
      const referrer = new URL(payload.referrer, origin);
      result.referrer = `${referrer.origin}${referrer.pathname}`;
    } catch {
      result.referrer = '';
    }
  }
  return result;
}

/**
 * Umami отдаётся через основной домен по префиксу `/u`, а не со своего
 * поддомена: скрипт и отправка событий — тот же origin, CSP менять не нужно, а
 * блокировщики режут сторонние счётчики чаще, чем путь на самом сайте.
 */
export const SITE_STATS_PREFIX = '/u';

/**
 * Страницы, где считается посещаемость: главная, документы, вход и регистрация.
 *
 * Дашборд, комнаты и страница гостя сюда не входят намеренно: в дашборде —
 * донаты и почта, у гостя в адресе токен приглашения. Статистике нужны пути, по
 * которым человек приходит и регистрируется, а не то, что он делает внутри.
 */
export function isTrackedPath(pathname: string): boolean {
  return (
    pathname === '/' ||
    pathname === '/login' ||
    pathname === '/register' ||
    pathname.startsWith('/legal/')
  );
}

let loading: Promise<void> | null = null;

/**
 * Загрузить счётчик один раз на вкладку.
 *
 * Автоматический учёт выключен: он считал бы каждый переход внутри SPA, включая
 * дашборд. Просмотры отправляет `SiteStats` сам, только на страницах из списка.
 * Фрагмент адреса не уходит вовсе, строка запроса — только метками `utm_*`.
 */
export function loadSiteStats(websiteId: string): Promise<void> {
  loading ??= new Promise<void>((resolve, reject) => {
    window[SITE_STATS_BEFORE_SEND] = (_type, payload) => sanitizeSiteStatsPayload(payload);
    const script = document.createElement('script');
    script.src = `${SITE_STATS_PREFIX}/script.js`;
    script.defer = true;
    script.dataset.websiteId = websiteId;
    script.dataset.hostUrl = `${window.location.origin}${SITE_STATS_PREFIX}`;
    script.dataset.autoTrack = 'false';
    script.dataset.excludeHash = 'true';
    script.dataset.beforeSend = SITE_STATS_BEFORE_SEND;
    script.onload = () => resolve();
    script.onerror = () => {
      loading = null;
      script.remove();
      reject(new Error('Счётчик статистики не загрузился'));
    };
    document.head.append(script);
  });
  return loading;
}

/**
 * Выключатель счётчика на стороне самого Umami: при нём уже загруженный скрипт
 * ничего не отправляет. Нужен на случай отзыва согласия посреди сессии.
 */
export function setSiteStatsDisabled(disabled: boolean): void {
  try {
    if (disabled) window.localStorage.setItem('umami.disabled', '1');
    else window.localStorage.removeItem('umami.disabled');
  } catch {
    // Хранилище недоступно (приватный режим) — счётчик и так не грузится без согласия.
  }
}

/** Шаги воронки. Без данных о человеке: только название шага. */
export type SiteStatsEvent = 'signup' | 'checkout';

export function trackSiteEvent(event: SiteStatsEvent): void {
  if (readCookieChoice() !== 'all') return;
  window.umami?.track(event);
}

/** Только для тестов: следующий вызов загрузит скрипт заново. */
export function resetSiteStatsForTests(): void {
  loading = null;
}
