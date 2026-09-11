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

  get throttleLimit(): number {
    return this.value('THROTTLE_LIMIT');
  }

  get throttleAuthLimit(): number {
    return this.value('THROTTLE_AUTH_LIMIT');
  }
}
