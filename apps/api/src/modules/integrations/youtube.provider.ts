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

const AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const API = 'https://www.googleapis.com/youtube/v3';

const SCOPES = ['https://www.googleapis.com/auth/youtube.readonly'];

/**
 * Цена одного сбора метрик в единицах квоты.
 *
 * `channels.list` + `liveBroadcasts.list` + `videos.list` — по единице каждый.
 * Считать это вручную приходится потому, что Google не сообщает остаток квоты
 * в ответах: узнать об исчерпании можно, только получив 403 с причиной
 * `quotaExceeded`, то есть уже после того, как всё потрачено.
 *
 * Принципиально НЕ используем `search.list` для поиска активного эфира: он
 * стоит 100 единиц, и минутный опрос одного канала им сжёг бы всю суточную
 * квоту проекта за полтора часа.
 */
const STATS_QUOTA_COST = 3;

interface YouTubeChannel {
  id: string;
  snippet?: {
    title?: string;
    customUrl?: string;
    thumbnails?: { default?: { url?: string }; medium?: { url?: string } };
  };
  statistics?: { subscriberCount?: string; viewCount?: string; hiddenSubscriberCount?: boolean };
}

interface YouTubeBroadcast {
  id: string;
  snippet?: { title?: string };
}

interface YouTubeVideo {
  liveStreamingDetails?: { concurrentViewers?: string };
  snippet?: { title?: string; categoryId?: string };
}

interface YouTubeList<T> {
  items?: T[];
}

export function normalizeIdentity(raw: YouTubeChannel): ChannelIdentity {
  const title = raw.snippet?.title ?? raw.id;
  return {
    externalId: raw.id,
    // customUrl вида «@handle» есть не у всех каналов: он появляется только
    // после того, как канал выбрал себе адрес.
    login: raw.snippet?.customUrl ?? raw.id,
    displayName: title,
    avatarUrl:
      raw.snippet?.thumbnails?.medium?.url ?? raw.snippet?.thumbnails?.default?.url ?? null,
  };
}

export function normalizeStats(input: {
  channel: YouTubeChannel | undefined;
  broadcast: YouTubeBroadcast | undefined;
  video: YouTubeVideo | undefined;
  capturedAt: Date;
}): ChannelStats {
  const isLive = input.broadcast !== undefined;
  const statistics = input.channel?.statistics;

  return {
    capturedAt: input.capturedAt.toISOString(),
    isLive,
    viewers: isLive ? optionalCount(input.video?.liveStreamingDetails?.concurrentViewers) : null,
    // Фолловеров у YouTube нет как понятия — есть подписчики, и они ниже.
    followers: null,
    // Скрытый счётчик подписчиков обязан остаться null, а не стать нулём:
    // «скрыто» и «ноль подписчиков» — разные утверждения.
    subscribers: statistics?.hiddenSubscriberCount
      ? null
      : optionalCount(statistics?.subscriberCount),
    totalViews: optionalCount(statistics?.viewCount),
    title: input.broadcast?.snippet?.title ?? input.video?.snippet?.title ?? null,
    // Категорию YouTube отдаёт числовым id, расшифровка которого стоит
    // отдельного запроса. Показывать пользователю «24» бессмысленно.
    category: null,
  };
}

@Injectable()
export class YouTubeProvider implements PlatformProvider {
  readonly platform = 'youtube' as const;
  readonly title = 'YouTube';
  readonly statsQuotaCost = STATS_QUOTA_COST;

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
    // Обязательная пара: без access_type=offline Google не даст refresh-токен
    // вовсе, а без prompt=consent — не даст его при повторном подключении.
    // Опрос идёт неделями, access-токен живёт час: без refresh это одноразовая
    // интеграция.
    url.searchParams.set('access_type', 'offline');
    url.searchParams.set('prompt', 'consent');
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
    const response = await this.http.json<YouTubeList<YouTubeChannel>>({
      platform: this.platform,
      url: `${API}/channels?part=snippet,statistics&mine=true`,
      accessToken,
    });
    const channel = response.items?.[0];
    if (!channel) {
      throw new Error('У аккаунта Google нет канала YouTube');
    }
    return normalizeIdentity(channel);
  }

  async fetchStats(accessToken: string): Promise<ChannelStats> {
    const [channels, broadcasts] = await Promise.all([
      this.http.json<YouTubeList<YouTubeChannel>>({
        platform: this.platform,
        url: `${API}/channels?part=snippet,statistics&mine=true`,
        accessToken,
      }),
      this.http.json<YouTubeList<YouTubeBroadcast>>({
        platform: this.platform,
        url: `${API}/liveBroadcasts?part=id,snippet&broadcastStatus=active&broadcastType=all&mine=true`,
        accessToken,
      }),
    ]);

    const broadcast = broadcasts.items?.[0];
    // Число зрителей лежит не в трансляции, а в видео: liveBroadcasts его не
    // отдаёт вовсе. Второй запрос делаем только когда эфир действительно идёт —
    // вне эфира он был бы чистой тратой квоты.
    const video = broadcast
      ? (
          await this.http.json<YouTubeList<YouTubeVideo>>({
            platform: this.platform,
            url: `${API}/videos?part=liveStreamingDetails,snippet&id=${encodeURIComponent(broadcast.id)}`,
            accessToken,
          })
        ).items?.[0]
      : undefined;

    return normalizeStats({
      channel: channels.items?.[0],
      broadcast,
      video,
      capturedAt: new Date(),
    });
  }

  private credentials(): { clientId: string; clientSecret: string } {
    const credentials = this.config.oauthCredentials('youtube');
    if (!credentials) {
      throw new Error(
        'Приложение YouTube не настроено: нет YOUTUBE_CLIENT_ID и YOUTUBE_CLIENT_SECRET',
      );
    }
    return credentials;
  }

  private redirectUri(): string {
    const base = this.config.oauthRedirectBaseUrl.replace(/\/+$/, '');
    return `${base}/api/integrations/youtube/callback`;
  }
}
