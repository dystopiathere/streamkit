import type { Request, Response } from 'express';
import type { AppConfig } from '../../config/app-config.service';
import { REFRESH_COOKIE_PATH } from './refresh-cookie';

/**
 * Метка браузера для писем о входе с нового устройства.
 *
 * Случайная строка, а не отпечаток браузера: она ничего не говорит о
 * человеке и живёт, пока её не стёрли вместе с остальными cookie. Отправляется
 * только на `/api/auth`, как refresh-cookie: нужна она лишь входу и обновлению
 * сессии. 400 дней — предел срока cookie в Chromium; дальше браузер обрежет
 * его сам.
 */
export const DEVICE_COOKIE_NAME = 'sk_device';
const DEVICE_COOKIE_MAX_AGE_MS = 400 * 24 * 60 * 60 * 1000;
const DEVICE_ID_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;

/** Метка из cookie, если она похожа на выданную нами. */
export function readDeviceCookie(request: Pick<Request, 'cookies'>): string | undefined {
  const value: unknown = request.cookies?.[DEVICE_COOKIE_NAME];
  return typeof value === 'string' && DEVICE_ID_PATTERN.test(value) ? value : undefined;
}

export function setDeviceCookie(response: Response, deviceId: string, config: AppConfig): void {
  response.cookie(DEVICE_COOKIE_NAME, deviceId, {
    httpOnly: true,
    secure: config.isProduction,
    sameSite: 'lax',
    path: REFRESH_COOKIE_PATH,
    domain: config.cookieDomain,
    maxAge: DEVICE_COOKIE_MAX_AGE_MS,
  });
}
