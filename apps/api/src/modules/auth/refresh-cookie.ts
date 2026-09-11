import type { CookieOptions, Response } from 'express';
import type { AppConfig } from '../../config/app-config.service';

/**
 * Имя cookie с refresh-токеном.
 *
 * Префикс `__Host-` не используем намеренно: он требует Secure и запрещает
 * атрибут Path, а нам нужен узкий Path. Вместо этого ограничиваем путь и домен.
 */
export const REFRESH_COOKIE_NAME = 'sk_refresh';

/**
 * Cookie отдаётся ТОЛЬКО на путь обновления и выхода. Браузер не приложит её
 * ни к одному другому запросу — значит XSS на других ручках её не утащит,
 * а поверхность CSRF сводится к двум эндпоинтам.
 */
export const REFRESH_COOKIE_PATH = '/api/auth';

function baseOptions(config: AppConfig): CookieOptions {
  return {
    httpOnly: true,
    // В dev сервер работает по http, и Secure-cookie браузер просто не сохранит.
    secure: config.isProduction,
    // Lax, а не Strict: при переходе по ссылке из письма сессия не должна теряться.
    // Кросс-сайтовый POST с Lax cookie браузер не отправит — это и закрывает CSRF.
    sameSite: 'lax',
    path: REFRESH_COOKIE_PATH,
    domain: config.cookieDomain,
  };
}

export function setRefreshCookie(response: Response, token: string, config: AppConfig): void {
  response.cookie(REFRESH_COOKIE_NAME, token, {
    ...baseOptions(config),
    maxAge: config.refreshTtlMs,
  });
}

export function clearRefreshCookie(response: Response, config: AppConfig): void {
  response.clearCookie(REFRESH_COOKIE_NAME, baseOptions(config));
}

export function readRefreshCookie(request: {
  cookies?: Record<string, string>;
}): string | undefined {
  return request.cookies?.[REFRESH_COOKIE_NAME];
}
