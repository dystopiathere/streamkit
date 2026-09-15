import type { CookieOptions, Response } from 'express';
import type { AppConfig } from '../../config/app-config.service';

/**
 * Cookie, привязывающая OAuth `state` к браузеру, который начал подключение.
 *
 * Серверный state привязан к пользователю, но этого мало. Без cookie
 * злоумышленник получал state для СВОЕГО аккаунта, отправлял жертве ссылку на
 * экран подтверждения площадки, и после «Разрешить» канал жертвы вместе с
 * токенами доступа (почта, подписчики, закрытые данные YouTube) подключался к
 * аккаунту злоумышленника. Callback теперь принимает state, только если тот же
 * браузер получил его на шаге authorize.
 */
export const OAUTH_STATE_COOKIE = 'sk_oauth_state';

/** Только callback площадок: ни одному другому запросу cookie не нужна. */
export const OAUTH_STATE_COOKIE_PATH = '/api/integrations';

/** Столько же, сколько живёт сам state в Redis. */
const MAX_AGE_MS = 10 * 60 * 1000;

function baseOptions(config: AppConfig): CookieOptions {
  return {
    httpOnly: true,
    secure: config.isProduction,
    // Lax, а не Strict: на callback браузер приходит редиректом с домена
    // площадки, и Strict cookie в такой переход не приложил бы.
    sameSite: 'lax',
    path: OAUTH_STATE_COOKIE_PATH,
    domain: config.cookieDomain,
  };
}

export function setOAuthStateCookie(response: Response, state: string, config: AppConfig): void {
  response.cookie(OAUTH_STATE_COOKIE, state, { ...baseOptions(config), maxAge: MAX_AGE_MS });
}

export function clearOAuthStateCookie(response: Response, config: AppConfig): void {
  response.clearCookie(OAUTH_STATE_COOKIE, baseOptions(config));
}

export function readOAuthStateCookie(request: {
  cookies?: Record<string, string>;
}): string | undefined {
  return request.cookies?.[OAUTH_STATE_COOKIE];
}
