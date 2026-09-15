import { Injectable } from '@nestjs/common';
import type { ChannelStats } from '@streamkit/contracts';
import { HttpClient } from '../../common/http/http-client.service';
import { AppConfig } from '../../config/app-config.service';
import {
  type ChannelIdentity,
  normalizeTokens,
  type OAuthTokens,
  optionalCount,
  type PlatformProvider,
  type RawTokenResponse,
} from './platform-provider';

const AUTHORIZE_URL = 'https://id.twitch.tv/oauth2/authorize';
const TOKEN_URL = 'https://id.twitch.tv/oauth2/token';
const HELIX = 'https://api.twitch.tv/helix';

/**
 * Запрашиваемые права.
 *
 * `moderator:read:followers` — не опечатка: с 2023 года число фолловеров
 * отдаётся только этим правом, старый эндпоинт без него закрыт.
 *
 * `user:read:email` здесь был и не использовался: почта аккаунта Twitch нигде
 * не читалась и не хранилась. Право, которое не нужно, — это данные, которые
 * можно получить, и строка в политике, которую пришлось бы объяснять.
 */
const SCOPES = ['moderator:read:followers', 'channel:read:subscriptions'];

interface TwitchUser {
  id: string;
  login: string;
  display_name: string;
  profile_image_url?: string;
}

interface TwitchStream {
  viewer_count?: number;
  title?: string;
  game_name?: string;
}

/** Ответы Helix всегда завёрнуты в `data`, даже когда там ровно один объект. */
interface TwitchList<T> {
  data: T[];
  total?: number;
}

export function normalizeIdentity(raw: TwitchUser): ChannelIdentity {
  return {
    externalId: raw.id,
    login: raw.login,
    displayName: raw.display_name || raw.login,
    avatarUrl: raw.profile_image_url ?? null,
  };
}

export function normalizeStats(input: {
  stream: TwitchStream | undefined;
  followersTotal: unknown;
  subscribersTotal: unknown;
  capturedAt: Date;
}): ChannelStats {
  const isLive = input.stream !== undefined;
  return {
    capturedAt: input.capturedAt.toISOString(),
    isLive,
    // Зрители только когда есть эфир. Вне эфира это не ноль, а «неизвестно»:
    // ноль означал бы, что шёл стрим и никто не смотрел.
    viewers: isLive ? optionalCount(input.stream?.viewer_count) : null,
    followers: optionalCount(input.followersTotal),
    subscribers: optionalCount(input.subscribersTotal),
    // Twitch не отдаёт суммарные просмотры канала с 2022 года — счётчик убран.
    totalViews: null,
    title: input.stream?.title ?? null,
    category: input.stream?.game_name ?? null,
  };
}

@Injectable()
export class TwitchProvider implements PlatformProvider {
  readonly platform = 'twitch' as const;
  readonly title = 'Twitch';
  /** Квоты по объёму у Twitch нет — только лимит частоты, его держит бэкофф. */
  readonly statsQuotaCost = 0;

  constructor(
    private readonly http: HttpClient,
    private readonly config: AppConfig,
  ) {}

  buildAuthorizeUrl(state: string): string {
    const url = new URL(AUTHORIZE_URL);
    url.searchParams.set('client_id', this.credentials().clientId);
    url.searchParams.set('redirect_uri', this.redirectUri());
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', SCOPES.join(' '));
    url.searchParams.set('state', state);
    // Экран подтверждения показывается даже при повторном подключении: иначе
    // сменить аккаунт невозможно — Twitch молча переиспользует текущий.
    url.searchParams.set('force_verify', 'true');
    return url.toString();
  }

  async exchangeCode(code: string): Promise<OAuthTokens> {
    const { clientId, clientSecret } = this.credentials();
    return normalizeTokens(
      await this.http.json<RawTokenResponse>({
        platform: this.platform,
        url: TOKEN_URL,
        method: 'POST',
        form: {
          client_id: clientId,
          client_secret: clientSecret,
          code,
          grant_type: 'authorization_code',
          redirect_uri: this.redirectUri(),
        },
      }),
    );
  }

  async refreshTokens(refreshToken: string): Promise<OAuthTokens> {
    const { clientId, clientSecret } = this.credentials();
    return normalizeTokens(
      await this.http.json<RawTokenResponse>({
        platform: this.platform,
        url: TOKEN_URL,
        method: 'POST',
        form: {
          client_id: clientId,
          client_secret: clientSecret,
          refresh_token: refreshToken,
          grant_type: 'refresh_token',
        },
      }),
    );
  }

  async fetchIdentity(accessToken: string): Promise<ChannelIdentity> {
    const response = await this.get<TwitchList<TwitchUser>>(`${HELIX}/users`, accessToken);
    const user = response.data[0];
    if (!user) {
      throw new Error('Twitch не вернул профиль пользователя');
    }
    return normalizeIdentity(user);
  }

  async fetchStats(accessToken: string, identity: ChannelIdentity): Promise<ChannelStats> {
    const broadcaster = encodeURIComponent(identity.externalId);

    // Три запроса параллельно: последовательно это три задержки сети подряд на
    // каждый канал, а каналов в тике опроса много.
    //
    // `first=1` в запросах фолловеров и подписчиков — мы берём только поле
    // `total`, сам список не нужен, а страница по умолчанию тянет двадцать
    // записей с персональными данными, которые нам незачем даже получать.
    const [stream, followers, subscribers] = await Promise.all([
      this.get<TwitchList<TwitchStream>>(`${HELIX}/streams?user_id=${broadcaster}`, accessToken),
      this.get<TwitchList<never>>(
        `${HELIX}/channels/followers?broadcaster_id=${broadcaster}&first=1`,
        accessToken,
      ),
      this.get<TwitchList<never>>(
        `${HELIX}/subscriptions?broadcaster_id=${broadcaster}&first=1`,
        accessToken,
      ),
    ]);

    return normalizeStats({
      stream: stream.data[0],
      followersTotal: followers.total,
      subscribersTotal: subscribers.total,
      capturedAt: new Date(),
    });
  }

  /** Helix требует Client-Id на каждом запросе — без него отвечает 401. */
  private get<T>(url: string, accessToken: string): Promise<T> {
    return this.http.json<T>({
      platform: this.platform,
      url,
      accessToken,
      headers: { 'Client-Id': this.credentials().clientId },
    });
  }

  private credentials(): { clientId: string; clientSecret: string } {
    const credentials = this.config.oauthCredentials('twitch');
    if (!credentials) {
      throw new Error(
        'Приложение Twitch не настроено: нет TWITCH_CLIENT_ID и TWITCH_CLIENT_SECRET',
      );
    }
    return credentials;
  }

  private redirectUri(): string {
    return `${this.config.oauthRedirectBaseUrl.replace(/\/+$/, '')}/api/integrations/twitch/callback`;
  }
}
