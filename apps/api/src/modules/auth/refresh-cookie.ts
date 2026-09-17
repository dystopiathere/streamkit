import type { SessionScope } from '@prisma/client';
import type { CookieOptions, Response } from 'express';
import type { AppConfig } from '../../config/app-config.service';
import { ADMIN_REFRESH_TTL_MS } from './token.service';

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

/**
 * Сессия админки — своя cookie на своём пути.
 *
 * Сотрудник обычно вошёл и в дашборд в том же браузере. Общая cookie означала
 * бы, что выход из одного гасит другое, а обновление токена дашборда
 * предъявляет админский refresh — и наоборот.
 */
export const ADMIN_REFRESH_COOKIE_NAME = 'sk_admin_refresh';
export const ADMIN_REFRESH_COOKIE_PATH = '/api/admin/auth';

function cookieFor(scope: SessionScope): { name: string; path: string } {
  return scope === 'ADMIN'
    ? { name: ADMIN_REFRESH_COOKIE_NAME, path: ADMIN_REFRESH_COOKIE_PATH }
    : { name: REFRESH_COOKIE_NAME, path: REFRESH_COOKIE_PATH };
}

function baseOptions(config: AppConfig, scope: SessionScope): CookieOptions {
  return {
    httpOnly: true,
    // В dev сервер работает по http, и Secure-cookie браузер просто не сохранит.
    secure: config.isProduction,
    // Lax, а не Strict: при переходе по ссылке из письма сессия не должна теряться.
    // Кросс-сайтовый POST с Lax cookie браузер не отправит — это и закрывает CSRF.
    // Админке переходы по ссылкам не нужны: там Strict.
    sameSite: scope === 'ADMIN' ? 'strict' : 'lax',
    path: cookieFor(scope).path,
    domain: config.cookieDomain,
  };
}

export function setRefreshCookie(
  response: Response,
  token: string,
  config: AppConfig,
  scope: SessionScope = 'USER',
): void {
  response.cookie(cookieFor(scope).name, token, {
    ...baseOptions(config, scope),
    maxAge: scope === 'ADMIN' ? ADMIN_REFRESH_TTL_MS : config.refreshTtlMs,
  });
}

export function clearRefreshCookie(
  response: Response,
  config: AppConfig,
  scope: SessionScope = 'USER',
): void {
  response.clearCookie(cookieFor(scope).name, baseOptions(config, scope));
}

export function readRefreshCookie(
  request: { cookies?: Record<string, string> },
  scope: SessionScope = 'USER',
): string | undefined {
  return request.cookies?.[cookieFor(scope).name];
}
