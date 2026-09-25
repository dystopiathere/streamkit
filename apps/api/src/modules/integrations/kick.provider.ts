import { Injectable, Logger } from '@nestjs/common';
import type { ChannelStats } from '@streamkit/contracts';
import { HttpClient } from '../../common/http/http-client.service';
import { AppConfig } from '../../config/app-config.service';
import {
  type ChannelIdentity,
  normalizeTokens,
  type OAuthTokens,
  optionalCount,
  optionalInstant,
  type PlatformProvider,
  type RawTokenResponse,
} from './platform-provider';

/**
 * Запрашиваемые права — ровно то, что читается.
 *
 * `user:read` — id и имя владельца токена, `channel:read` — адрес канала,
 * эфир и число подписчиков, `events:subscribe` — подписка на события канала
 * для оповещений и чата. Писать в чат, модерировать и читать ключ трансляции
 * сервису незачем, и этих прав он не просит.
 */
export const KICK_SCOPES = ['user:read', 'channel:read', 'events:subscribe'];

/**
 * События канала, на которые подписываются оповещения и сигнал эфира.
 *
 * KICKs идут своим сценарием, а не битами: это валюта площадки, и «{count}
 * битов» в кадре назвал бы её неправдой. `chat.message.sent` здесь нет: на чат
 * подписывается источник чата и только пока чат кто-то показывает.
 */
export const KICK_ALERT_EVENTS = [
  'channel.followed',
  'channel.subscription.new',
  'channel.subscription.renewal',
  'channel.subscription.gifts',
  'channel.reward.redemption.updated',
  'kicks.gifted',
  'livestream.status.updated',
] as const;

/** Событие чата — подписка источника чата, а не коннектора событий. */
export const KICK_CHAT_EVENT = 'chat.message.sent';

/** Ответы публичного API Kick завёрнуты в `data`, даже одиночный объект. */
interface KickEnvelope<T> {
  data: T;
  message?: string;
}

interface KickUser {
  user_id: number;
  name: string;
  profile_picture?: string | null;
}

interface KickChannel {
  broadcaster_user_id: number;
  slug: string;
  stream_title?: string | null;
  category?: { name?: string | null } | null;
  stream?: {
    is_live?: boolean;
    viewer_count?: number;
    start_time?: string;
  } | null;
  /**
   * Действующие подписки, с подаренными (с августа 2026 года — как на самом
   * Kick). Отдаётся только владельцу канала.
   */
  active_subscribers_count?: number;
}

/** Подписка приложения на событие канала (`GET /public/v1/events/subscriptions`). */
export interface KickEventSubscription {
  id: string;
  broadcaster_user_id: number;
  event: string;
  version: number;
}

/** Итог подписки по каждому событию из запроса. */
interface KickSubscribeResult {
  name: string;
  version: number;
  subscription_id?: string;
  error?: string;
}

/**
 * Ответ токен-эндпоинта Kick. Документация показывает `expires_in` строкой, а
 * общий разбор ждёт число: строка дала бы токен «без срока», и он умер бы через
 * пару часов, так ни разу и не продлившись.
 */
type KickTokenResponse = Omit<RawTokenResponse, 'expires_in'> & { expires_in?: number | string };

export function normalizeKickTokens(raw: KickTokenResponse): OAuthTokens {
  const expiresIn = Number(raw.expires_in);
  return normalizeTokens({
    ...raw,
    // Без `scope` ответ значит «выдано ровно то, что просили» (RFC 6749, 5.1).
    // Пустой список прав вместо этого навсегда требовал бы переподключения.
    scope: raw.scope || KICK_SCOPES,
    expires_in: Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn : undefined,
  });
}

export function normalizeIdentity(user: KickUser, channel: KickChannel): ChannelIdentity {
  return {
    externalId: String(user.user_id),
    // Адрес канала: kick.com/<slug>. Имя пользователя от него может
    // отличаться регистром и знаками.
    login: channel.slug,
    displayName: user.name || channel.slug,
    avatarUrl: user.profile_picture || null,
  };
}

export function normalizeStats(channel: KickChannel, capturedAt: Date): ChannelStats {
  const isLive = channel.stream?.is_live === true;
  return {
    capturedAt: capturedAt.toISOString(),
    isLive,
    viewers: isLive ? optionalCount(channel.stream?.viewer_count) : null,
    // Числа фолловеров публичный API Kick не отдаёт — ни владельцу, ни кому-то
    // ещё. null, а не ноль: на графике ноль выглядел бы потерей всей аудитории.
    followers: null,
    subscribers: optionalCount(channel.active_subscribers_count),
    totalViews: null,
    title: channel.stream_title || null,
    category: channel.category?.name || null,
    liveSince: isLive ? optionalInstant(channel.stream?.start_time) : null,
  };
}

/**
 * Kick: вход по OAuth 2.1 с PKCE, метрики канала и подписки на события.
 *
 * События Kick приходят только вебхуком на адрес приложения, сокета для
 * сторонних приложений у Kick нет. Поэтому подписки создаёт воркер
 * (`KickEventsConnector`, `KickChatSource`), а сами события принимает API
 * (`KickWebhookController`).
 */
@Injectable()
export class KickProvider implements PlatformProvider {
  readonly platform = 'kick' as const;
  readonly title = 'Kick';
  readonly usesPkce = true;
  /** Квоты по объёму у публичного API Kick нет. */
  readonly statsQuotaCost = 0;
  private readonly logger = new Logger(KickProvider.name);

  constructor(
    private readonly http: HttpClient,
    private readonly config: AppConfig,
  ) {}

  buildAuthorizeUrl(state: string, codeChallenge?: string): string {
    if (!codeChallenge) throw new Error('Вход в Kick без PKCE невозможен');
    const url = new URL(`${this.endpoints.auth}/oauth/authorize`);
    url.searchParams.set('client_id', this.credentials().clientId);
    url.searchParams.set('redirect_uri', this.redirectUri());
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', KICK_SCOPES.join(' '));
    url.searchParams.set('state', state);
    url.searchParams.set('code_challenge', codeChallenge);
    url.searchParams.set('code_challenge_method', 'S256');
    return url.toString();
  }

  async exchangeCode(code: string, codeVerifier?: string): Promise<OAuthTokens> {
    if (!codeVerifier) throw new Error('Нет code_verifier для обмена кода Kick');
    const { clientId, clientSecret } = this.credentials();
    return normalizeKickTokens(
      await this.http.json<KickTokenResponse>({
        platform: this.platform,
        url: `${this.endpoints.auth}/oauth/token`,
        method: 'POST',
        form: {
          grant_type: 'authorization_code',
          client_id: clientId,
          client_secret: clientSecret,
          redirect_uri: this.redirectUri(),
          code_verifier: codeVerifier,
          code,
        },
      }),
    );
  }

  async refreshTokens(refreshToken: string): Promise<OAuthTokens> {
    const { clientId, clientSecret } = this.credentials();
    return normalizeKickTokens(
      await this.http.json<KickTokenResponse>({
        platform: this.platform,
        url: `${this.endpoints.auth}/oauth/token`,
        method: 'POST',
        form: {
          grant_type: 'refresh_token',
          client_id: clientId,
          client_secret: clientSecret,
          refresh_token: refreshToken,
        },
      }),
    );
  }

  /**
   * Отзыв — refresh-токеном: он переживает access, и отозвать только access
   * значило бы оставить приложению способ выпустить новый. Токен Kick ждёт в
   * строке запроса, а не в теле.
   */
  async revokeTokens(tokens: { accessToken: string; refreshToken: string | null }): Promise<void> {
    await this.dropSubscriptions(tokens.accessToken);
    const url = new URL(`${this.endpoints.auth}/oauth/revoke`);
    url.searchParams.set('token', tokens.refreshToken ?? tokens.accessToken);
    url.searchParams.set('token_hint_type', tokens.refreshToken ? 'refresh_token' : 'access_token');
    await this.http.json<void>({
      platform: this.platform,
      url: url.toString(),
      method: 'POST',
      form: {},
      ignoreBody: true,
    });
  }

  /**
   * Подписки на события канала — до отзыва токена: после него удалять было бы
   * нечем, а вебхуки канала шли бы на наш адрес и дальше. По возможности, как и
   * сам отзыв: протухший access-токен отвязку не останавливает, а события
   * отвязанного канала вебхук всё равно отбросит.
   */
  private async dropSubscriptions(accessToken: string): Promise<void> {
    try {
      const [user] = await this.get<KickUser[]>('/public/v1/users', accessToken);
      if (!user) return;
      const subscriptions = await this.listEventSubscriptions(accessToken, String(user.user_id));
      await this.unsubscribeEvents(
        accessToken,
        subscriptions.map((subscription) => subscription.id),
      );
    } catch (error) {
      this.logger.warn({ err: error }, 'Подписки Kick при отвязке не удалены');
    }
  }

  /**
   * Профиль и канал — два запроса: адрес канала (`slug`) живёт в канале, а имя
   * и картинка — у пользователя. Без параметров оба отвечают про владельца
   * токена.
   */
  async fetchIdentity(accessToken: string): Promise<ChannelIdentity> {
    const [users, channels] = await Promise.all([
      this.get<KickUser[]>('/public/v1/users', accessToken),
      this.get<KickChannel[]>('/public/v1/channels', accessToken),
    ]);
    const user = users[0];
    const channel = channels[0];
    if (!user || !channel) {
      throw new Error('Kick не вернул профиль или канал пользователя');
    }
    return normalizeIdentity(user, channel);
  }

  /**
   * Один запрос на снимок: эфир, зрители, название и подписчики лежат в самом
   * канале. Отдельного опроса эфира нет — `livestream.status.updated` приходит
   * вебхуком и будит опрос так же, как `stream.online` у Twitch.
   */
  async fetchStats(accessToken: string, identity: ChannelIdentity): Promise<ChannelStats> {
    const channels = await this.get<KickChannel[]>(
      `/public/v1/channels?broadcaster_user_id=${encodeURIComponent(identity.externalId)}`,
      accessToken,
    );
    const channel = channels[0];
    if (!channel) throw new Error('Kick не вернул канал');
    return normalizeStats(channel, new Date());
  }

  /** Подписки приложения на события канала. */
  async listEventSubscriptions(
    accessToken: string,
    broadcasterUserId: string,
  ): Promise<KickEventSubscription[]> {
    return this.get<KickEventSubscription[]>(
      `/public/v1/events/subscriptions?broadcaster_user_id=${encodeURIComponent(broadcasterUserId)}`,
      accessToken,
    );
  }

  /**
   * Подписать приложение на события канала владельца токена.
   *
   * Kick отвечает итогом по каждому событию: одно может не пройти, а остальные
   * — пройти. Отказ по отдельному событию пишется в журнал и не роняет
   * подписку на остальные.
   */
  async subscribeEvents(
    accessToken: string,
    broadcasterUserId: string,
    events: readonly string[],
  ): Promise<void> {
    if (events.length === 0) return;
    const results = await this.http.json<KickEnvelope<KickSubscribeResult[]>>({
      platform: this.platform,
      url: `${this.endpoints.api}/public/v1/events/subscriptions`,
      method: 'POST',
      accessToken,
      json: {
        broadcaster_user_id: Number(broadcasterUserId),
        events: events.map((name) => ({ name, version: 1 })),
        method: 'webhook',
      },
    });
    for (const result of results.data ?? []) {
      if (result.error) {
        this.logger.warn({ event: result.name, reason: result.error }, 'Kick не принял подписку');
      }
    }
  }

  async unsubscribeEvents(accessToken: string, ids: readonly string[]): Promise<void> {
    if (ids.length === 0) return;
    const query = new URLSearchParams();
    for (const id of ids) query.append('id', id);
    await this.http.json<void>({
      platform: this.platform,
      url: `${this.endpoints.api}/public/v1/events/subscriptions?${query.toString()}`,
      method: 'DELETE',
      accessToken,
      ignoreBody: true,
    });
  }

  private get endpoints(): { auth: string; api: string } {
    return this.config.kickEndpoints;
  }

  private async get<T>(path: string, accessToken: string): Promise<T> {
    const response = await this.http.json<KickEnvelope<T>>({
      platform: this.platform,
      url: `${this.endpoints.api}${path}`,
      accessToken,
    });
    return response.data;
  }

  private credentials(): { clientId: string; clientSecret: string } {
    const credentials = this.config.oauthCredentials('kick');
    if (!credentials) {
      throw new Error('Приложение Kick не настроено: нет KICK_CLIENT_ID и KICK_CLIENT_SECRET');
    }
    return credentials;
  }

  private redirectUri(): string {
    return `${this.config.oauthRedirectBaseUrl.replace(/\/+$/, '')}/api/integrations/kick/callback`;
  }
}
