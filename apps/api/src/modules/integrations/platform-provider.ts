import type { ChannelStats, Platform } from '@streamkit/contracts';
import { PlatformAuthError, PlatformQuotaError } from '../../common/http/platform-errors';

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
  /**
   * Отозвать выданный доступ у площадки — при отвязке и удалении аккаунта.
   * Удалить свою копию токенов мало: разрешение приложения оставалось бы в
   * аккаунте площадки, пока человек не найдёт его и не снимет сам.
   */
  revokeTokens(tokens: { accessToken: string; refreshToken: string | null }): Promise<void>;
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
 * Метка времени площадки → ISO с миллисекундами, как у остальных дат контракта.
 * Непонятное значение — null: время стрима лучше не показать, чем показать
 * «1970-й».
 */
export function optionalInstant(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
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

/** Минимум от логгера — чтобы помощник ниже не тянул за собой весь Nest. */
interface WarnLogger {
  warn(message: unknown, context?: unknown): void;
}

/**
 * Необязательная часть снимка метрик.
 *
 * Снимок собирается из нескольких запросов, и они не равны по важности. У
 * YouTube счётчик подписчиков лежит в `channels.list`, а состояние эфира — в
 * `liveBroadcasts.list`, и второй отвечает 403 `liveStreamingNotEnabled`
 * каналу, у которого трансляции не включены. Пока запросы шли одним
 * `Promise.all`, такой отказ ронял ВЕСЬ сбор: снимка не появлялось ни разу,
 * в дашборде вместо подписчиков стояли прочерки, а канал вдобавок уезжал в
 * `AUTH_EXPIRED` — с требованием переподключить площадку, которое ничего не
 * лечит. Отказ необязательной части — `undefined` и строка в журнале.
 *
 * Мёртвый токен (401) и квота пропускаются наружу: на них опрос обязан
 * отреагировать, иначе канал с отозванным доступом опрашивался бы вечно, а
 * исчерпанный суточный бюджет Google — до полуночи.
 */
export async function optionalPart<T>(
  part: string,
  logger: WarnLogger,
  request: () => Promise<T>,
): Promise<T | undefined> {
  try {
    return await request();
  } catch (error) {
    if (error instanceof PlatformQuotaError) throw error;
    if (error instanceof PlatformAuthError && error.status === 401) throw error;
    logger.warn({ err: error, part }, 'Площадка не отдала часть метрик');
    return undefined;
  }
}
