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

  get youtubeChatDailyQuota(): number {
    return this.value('YOUTUBE_CHAT_DAILY_QUOTA');
  }

  get youtubeChatStreamCost(): number {
    return this.value('YOUTUBE_CHAT_STREAM_COST');
  }

  /**
   * Адреса Google без хвостового слэша. По умолчанию — боевые; переопределяются
   * только в тестах. Через `get`: переменные необязательны.
   */
  get youtubeEndpoints(): {
    auth: string;
    token: string;
    revoke: string;
    api: string;
    chatGrpc: string;
    chatGrpcInsecure: boolean;
  } {
    const trim = (value: string) => value.replace(/\/+$/, '');
    const insecure = this.config.get<string>('YOUTUBE_CHAT_GRPC_INSECURE') === 'true';
    if (insecure && this.isProduction) {
      throw new Error('YOUTUBE_CHAT_GRPC_INSECURE недопустим в production');
    }
    return {
      auth:
        this.config.get<string>('YOUTUBE_AUTH_URL') ??
        'https://accounts.google.com/o/oauth2/v2/auth',
      token: this.config.get<string>('YOUTUBE_TOKEN_URL') ?? 'https://oauth2.googleapis.com/token',
      revoke:
        this.config.get<string>('YOUTUBE_REVOKE_URL') ?? 'https://oauth2.googleapis.com/revoke',
      api: trim(
        this.config.get<string>('YOUTUBE_API_URL') ?? 'https://www.googleapis.com/youtube/v3',
      ),
      chatGrpc: this.config.get<string>('YOUTUBE_CHAT_GRPC_URL') ?? 'youtube.googleapis.com:443',
      chatGrpcInsecure: insecure,
    };
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
   * Адреса Twitch без хвостового слэша. По умолчанию — боевые; переопределяются
   * только в тестах. Через `get`: переменные необязательны.
   */
  get twitchEndpoints(): { auth: string; api: string; eventsub: string } {
    const trim = (value: string) => value.replace(/\/+$/, '');
    return {
      auth: trim(this.config.get<string>('TWITCH_AUTH_URL') ?? 'https://id.twitch.tv/oauth2'),
      api: trim(this.config.get<string>('TWITCH_API_URL') ?? 'https://api.twitch.tv/helix'),
      eventsub: this.config.get<string>('TWITCH_EVENTSUB_URL') ?? 'wss://eventsub.wss.twitch.tv/ws',
    };
  }

  /**
   * DonationAlerts: приложение и адреса, либо null — сервис не настроен.
   * Адреса по умолчанию — боевые; переопределяются только в тестах.
   */
  get donationAlerts(): {
    clientId: string;
    clientSecret: string;
    baseUrl: string;
    socketUrl: string;
  } | null {
    const clientId = this.config.get<string>('DONATIONALERTS_CLIENT_ID');
    const clientSecret = this.config.get<string>('DONATIONALERTS_CLIENT_SECRET');
    if (!clientId || !clientSecret) return null;
    return {
      clientId,
      clientSecret,
      baseUrl: (
        this.config.get<string>('DONATIONALERTS_BASE_URL') ?? 'https://www.donationalerts.com'
      ).replace(/\/+$/, ''),
      socketUrl:
        this.config.get<string>('DONATIONALERTS_SOCKET_URL') ??
        'wss://centrifugo.donationalerts.com/connection/websocket',
    };
  }

  /**
   * Подключение к LiveKit, либо null — комнаты не настроены.
   *
   * Через `get`, а не `value`, по той же причине, что и у площадок: без LiveKit
   * приложение обязано стартовать, а не падать на первом обращении.
   */
  get livekit(): { url: string; publicUrl: string; apiKey: string; apiSecret: string } | null {
    const url = this.config.get<string>('LIVEKIT_URL');
    const publicUrl = this.config.get<string>('LIVEKIT_PUBLIC_URL');
    const apiKey = this.config.get<string>('LIVEKIT_API_KEY');
    const apiSecret = this.config.get<string>('LIVEKIT_API_SECRET');
    if (!url || !publicUrl || !apiKey || !apiSecret) return null;
    return { url, publicUrl, apiKey, apiSecret };
  }

  /**
   * Приём оплаты в ЮKassa, либо null — оплата не настроена.
   *
   * Через `get`, как у LiveKit: без магазина приложение обязано стартовать, а
   * приватные комнаты в таком случае бесплатны.
   */
  get billing(): {
    shopId: string;
    secretKey: string;
    apiUrl: string;
    receipts: 'none' | 'fiscal';
    vatCode: number;
    taxSystemCode: number | undefined;
  } | null {
    const shopId = this.config.get<string>('YOOKASSA_SHOP_ID');
    const secretKey = this.config.get<string>('YOOKASSA_SECRET_KEY');
    if (!shopId || !secretKey) return null;
    return {
      shopId,
      secretKey,
      apiUrl: this.config.get<string>('YOOKASSA_API_URL') ?? 'https://api.yookassa.ru/v3',
      receipts: this.config.get<'none' | 'fiscal'>('YOOKASSA_RECEIPTS') ?? 'none',
      vatCode: this.config.get<number>('YOOKASSA_VAT_CODE') ?? 1,
      taxSystemCode: this.config.get<number>('YOOKASSA_TAX_SYSTEM_CODE'),
    };
  }

  /**
   * SMTP для служебных писем, либо null — почта не настроена.
   *
   * Через `get`, как у ЮKassa: без почты приложение стартует, а продления
   * подписки просто не списываются, пока не уйдёт предупреждение.
   */
  get mail(): {
    host: string;
    port: number;
    user: string | undefined;
    password: string | undefined;
    from: string;
  } | null {
    const host = this.config.get<string>('SMTP_HOST');
    const from = this.config.get<string>('MAIL_FROM');
    if (!host || !from) return null;
    return {
      host,
      port: this.config.get<number>('SMTP_PORT') ?? 587,
      user: this.config.get<string>('SMTP_USER'),
      password: this.config.get<string>('SMTP_PASSWORD'),
      from,
    };
  }

  /** Идентификатор сайта в Umami, либо null — статистика не настроена. */
  get umamiWebsiteId(): string | null {
    return this.config.get<string>('UMAMI_WEBSITE_ID') ?? null;
  }

  /** База Umami для уборки старой статистики, либо null — убирать нечего. */
  get umamiDatabaseUrl(): string | null {
    return this.config.get<string>('UMAMI_DATABASE_URL') ?? null;
  }

  /** Реквизиты продавца. Незаполненное — null: страница покажет, что его нет. */
  get seller(): {
    name: string | null;
    inn: string | null;
    email: string | null;
    phone: string | null;
  } {
    return {
      name: this.config.get<string>('SELLER_NAME') ?? null,
      inn: this.config.get<string>('SELLER_INN') ?? null,
      email: this.config.get<string>('SELLER_EMAIL') ?? null,
      phone: this.config.get<string>('SELLER_PHONE') ?? null,
    };
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
