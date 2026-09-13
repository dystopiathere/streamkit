import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from './env';

/**
 * Типизированная обёртка над ConfigService.
 *
 * `ConfigService.get('KEY', { infer: true })` выводит типы неустойчиво: стоит
 * появиться в схеме полю-массиву, и вывод для соседних ключей начинает давать
 * что-то неожиданное. Здесь же каждый параметр — именованный геттер с честным
 * типом, и опечатка в названии ключа не компилируется.
 */
@Injectable()
export class AppConfig {
  constructor(private readonly config: ConfigService<Env, true>) {}

  private value<K extends keyof Env>(key: K): Env[K] {
    // `as never` обходит перегрузки ConfigService, типы которых завязаны на
    // внутренние типы Zod-схемы. Снаружи геттеры всё равно строго типизированы.
    return this.config.getOrThrow(key as never) as Env[K];
  }

  get nodeEnv(): Env['NODE_ENV'] {
    return this.value('NODE_ENV');
  }

  get isProduction(): boolean {
    return this.nodeEnv === 'production';
  }

  get port(): number {
    return this.value('PORT');
  }

  get logLevel(): Env['LOG_LEVEL'] {
    return this.value('LOG_LEVEL');
  }

  get redisUrl(): string {
    return this.value('REDIS_URL');
  }

  get jwtSecret(): string {
    return this.value('JWT_SECRET');
  }

  get accessTtlSeconds(): number {
    return this.value('JWT_ACCESS_TTL');
  }

  get refreshTtlDays(): number {
    return this.value('REFRESH_TTL_DAYS');
  }

  get refreshTtlMs(): number {
    return this.refreshTtlDays * 24 * 60 * 60 * 1000;
  }

  get encryptionKey(): Buffer {
    return Buffer.from(this.value('ENCRYPTION_KEY'), 'base64');
  }

  get ipHashPepper(): string {
    return this.value('IP_HASH_PEPPER');
  }

  get tokenHashPepper(): string {
    return this.value('TOKEN_HASH_PEPPER');
  }

  get corsOrigins(): string[] {
    return this.value('CORS_ORIGINS');
  }

  /** Необязательный параметр: на localhost домен у cookie не указывается. */
  get cookieDomain(): string | undefined {
    return this.config.get<string>('COOKIE_DOMAIN');
  }

  get overlayBaseUrl(): string {
    return this.value('OVERLAY_BASE_URL');
  }

  get webBaseUrl(): string {
    return this.value('WEB_BASE_URL');
  }

  get oauthRedirectBaseUrl(): string {
    return this.value('OAUTH_REDIRECT_BASE_URL');
  }

  get youtubeDailyQuota(): number {
    return this.value('YOUTUBE_DAILY_QUOTA');
  }

  /**
   * Адрес IRC-шлюза Twitch. undefined — берём стандартный.
   *
   * Через `get`, а не `value`: последний бросает на незаданном ключе, а эта
   * переменная необязательна и в боевом окружении пуста всегда.
   */
  get twitchIrcUrl(): string | undefined {
    return this.config.get<string>('TWITCH_IRC_URL');
  }

  /**
   * Учётные данные приложения площадки, либо null, если оно не настроено.
   *
   * Через `config.get`, а не `value`: `value` использует getOrThrow и уронил бы
   * приложение там, где отсутствие ключа — штатная ситуация.
   */
  oauthCredentials(
    platform: 'twitch' | 'youtube',
  ): { clientId: string; clientSecret: string } | null {
    const prefix = platform === 'twitch' ? 'TWITCH' : 'YOUTUBE';
    const clientId = this.config.get<string>(`${prefix}_CLIENT_ID` as keyof Env);
    const clientSecret = this.config.get<string>(`${prefix}_CLIENT_SECRET` as keyof Env);
    if (!clientId || !clientSecret) return null;
    return { clientId, clientSecret };
  }

  get throttleLimit(): number {
    return this.value('THROTTLE_LIMIT');
  }

  get throttleAuthLimit(): number {
    return this.value('THROTTLE_AUTH_LIMIT');
  }
}
