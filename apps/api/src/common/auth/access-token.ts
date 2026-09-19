import type { JwtService } from '@nestjs/jwt';
import type { Redis } from 'ioredis';

/**
 * Аудитория админского access-токена.
 *
 * У токена дашборда аудитории нет — так выпускались все токены до появления
 * админки, и живые токены пользователей не должны были стать недействительными
 * в момент выкатки.
 */
export const ADMIN_AUDIENCE = 'streamkit-admin';

export type TokenAudience = 'dashboard' | 'admin';

export interface AccessTokenPayload {
  /** subject — id пользователя */
  sub: string;
  email: string;
  aud?: string | string[];
  /** Срок в секундах эпохи — его ставит JwtService при выпуске. */
  exp?: number;
}

export function audienceOf(payload: Pick<AccessTokenPayload, 'aud'>): TokenAudience {
  const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  return audiences.includes(ADMIN_AUDIENCE) ? 'admin' : 'dashboard';
}

/**
 * Отметка «аккаунт заблокирован» для уже выданных access-токенов.
 *
 * Токен живёт до своего срока, и без отметки заблокированный пользователь ещё
 * пятнадцать минут работал бы с дашбордом. Статус из БД на каждый запрос —
 * лишний запрос на каждый запрос каждого стримера; отметка в Redis — одна
 * команда и живёт ровно срок самого долгого токена.
 */
export const blockedUserKey = (userId: string): string => `auth:blocked:${userId}`;

export class InvalidAccessToken extends Error {}

/**
 * Проверка access-токена — общая для HTTP и сокета дашборда.
 *
 * Аудитория сверяется с тем, куда токен предъявлен: админский токен не
 * открывает дашборд, токен дашборда не открывает админку.
 */
export async function verifyAccessToken(
  jwt: JwtService,
  redis: Redis,
  token: string,
  expected: TokenAudience,
): Promise<AccessTokenPayload> {
  let payload: AccessTokenPayload;
  try {
    payload = await jwt.verifyAsync<AccessTokenPayload>(token);
  } catch {
    // Не различаем «истёк» и «подделан»: снаружи это одно и то же состояние.
    throw new InvalidAccessToken();
  }
  if (audienceOf(payload) !== expected) throw new InvalidAccessToken();
  if ((await redis.exists(blockedUserKey(payload.sub))) === 1) throw new InvalidAccessToken();
  return payload;
}
