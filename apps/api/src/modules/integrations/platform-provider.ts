import type { ChannelStats, Platform } from '@streamkit/contracts';

/** Пара токенов, как её отдаёт площадка после обмена кода или обновления. */
export interface OAuthTokens {
  accessToken: string;
  /**
   * Не все площадки возвращают refresh при обновлении: Twitch возвращает,
   * Google при повторном обмене — нет. Отсутствие означает «оставь прежний»,
   * а не «его больше нет».
   */
  refreshToken: string | null;
  scopes: string[];
  expiresAt: Date | null;
}

/** Канал на стороне площадки. */
export interface ChannelIdentity {
  externalId: string;
  login: string;
  displayName: string;
  avatarUrl: string | null;
}

/**
 * Контракт площадки для сбора аналитики.
 *
 * Отдельный интерфейс, а не расширение `DonationConnector`. Тот описывает
 * подписку: открыл соединение, получаешь события, закрыл. Здесь опрос: спроси
 * метрики — получи снимок. Натянуть один интерфейс на обе формы можно только
 * сделав половину методов необязательными, и тогда он перестанет что-либо
 * гарантировать. Общее у них — OAuth и хранение токенов, и это вынесено в
 * `PlatformTokenService`, а не в общий базовый класс.
 *
 * Новая площадка = новый класс по этому интерфейсу плюс запись в
 * `PlatformRegistry`. Ядро не трогается.
 */
export interface PlatformProvider {
  readonly platform: Platform;

  /** Человеческое название для интерфейса. */
  readonly title: string;

  /**
   * Стоимость одного `fetchStats` в единицах суточной квоты.
   *
   * У Twitch квоты нет — только лимит частоты, поэтому 0. У YouTube каждый
   * вызов списывает единицы из общего на весь проект суточного лимита, и без
   * учёта этой цифры опрос десятка каналов выедает квоту к обеду.
   */
  readonly statsQuotaCost: number;

  buildAuthorizeUrl(state: string): string;
  exchangeCode(code: string): Promise<OAuthTokens>;
  refreshTokens(refreshToken: string): Promise<OAuthTokens>;
  fetchIdentity(accessToken: string): Promise<ChannelIdentity>;
  fetchStats(accessToken: string, identity: ChannelIdentity): Promise<ChannelStats>;
}

/** Ответ токен-эндпоинта. Форма одинакова у Twitch и Google — это OAuth 2.0. */
export interface RawTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string | string[];
}

/**
 * Приведение ответа токен-эндпоинта к нашему виду.
 *
 * `scope` приходит то массивом (Twitch), то строкой через пробел (Google) —
 * спецификация допускает оба варианта, и площадки этим пользуются.
 */
export function normalizeTokens(raw: RawTokenResponse): OAuthTokens {
  return {
    accessToken: raw.access_token,
    refreshToken: raw.refresh_token ?? null,
    scopes: Array.isArray(raw.scope) ? raw.scope : (raw.scope?.split(' ').filter(Boolean) ?? []),
    expiresAt:
      typeof raw.expires_in === 'number' ? new Date(Date.now() + raw.expires_in * 1000) : null,
  };
}

/**
 * Число из ответа площадки.
 *
 * И Twitch, и YouTube отдают счётчики строками, а YouTube ещё и опускает поле
 * целиком, когда стример скрыл число подписчиков. Важно отличать «скрыто» от
 * нуля: ноль на графике выглядит как обвал, которого не было.
 */
export function optionalCount(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.trunc(parsed) : null;
}
