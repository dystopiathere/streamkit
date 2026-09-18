import { BadRequestException, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { HttpClient } from '../../common/http/http-client.service';
import { AppConfig } from '../../config/app-config.service';
import { normalizeTokens, type OAuthTokens, type RawTokenResponse } from './platform-provider';

/**
 * Права приложения.
 *
 * `oauth-user-show` нужен не ради профиля: только в нём приходит
 * `socket_connection_token`, без которого к сокету донатов не подключиться.
 * Вместе с ним DonationAlerts отдаёт и почту аккаунта — мы её не читаем и не
 * храним (политика, раздел о подключённых площадках).
 */
const SCOPES = ['oauth-user-show', 'oauth-donation-subscribe'];

/** Путь возврата — под `/api/integrations`: там живёт cookie, привязывающая state к браузеру. */
export const DONATIONALERTS_CALLBACK_PATH = '/api/integrations/donations/donationalerts/callback';

const profileSchema = z.object({
  data: z.object({
    id: z.union([z.number(), z.string()]),
    name: z.string().nullish(),
    code: z.string().nullish(),
    socket_connection_token: z.string().min(1),
  }),
});

const subscribeSchema = z.object({
  channels: z.array(z.object({ channel: z.string(), token: z.string().min(1) })),
});

export interface DonationAlertsProfile {
  id: string;
  /** Имя аккаунта для дашборда. Почту из ответа сознательно не берём. */
  name: string;
  socketConnectionToken: string;
}

/**
 * HTTP-часть DonationAlerts: OAuth, профиль, подпись приватного канала.
 *
 * Сокет живёт отдельно, в воркере (`DonationAlertsConnector`): у API и
 * воркера общие только эти запрос-ответ вызовы.
 */
@Injectable()
export class DonationAlertsApi {
  constructor(
    private readonly http: HttpClient,
    private readonly config: AppConfig,
  ) {}

  get isConfigured(): boolean {
    return this.config.donationAlerts !== null;
  }

  buildAuthorizeUrl(state: string): string {
    const settings = this.settings();
    const url = new URL(`${settings.baseUrl}/oauth/authorize`);
    url.searchParams.set('client_id', settings.clientId);
    url.searchParams.set('redirect_uri', this.redirectUri());
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', SCOPES.join(' '));
    url.searchParams.set('state', state);
    return url.toString();
  }

  async exchangeCode(code: string): Promise<OAuthTokens> {
    const settings = this.settings();
    return normalizeTokens(
      await this.http.json<RawTokenResponse>({
        platform: 'donationalerts',
        url: `${settings.baseUrl}/oauth/token`,
        method: 'POST',
        form: {
          grant_type: 'authorization_code',
          client_id: settings.clientId,
          client_secret: settings.clientSecret,
          redirect_uri: this.redirectUri(),
          code,
        },
      }),
    );
  }

  async refreshTokens(refreshToken: string): Promise<OAuthTokens> {
    const settings = this.settings();
    return normalizeTokens(
      await this.http.json<RawTokenResponse>({
        platform: 'donationalerts',
        url: `${settings.baseUrl}/oauth/token`,
        method: 'POST',
        form: {
          grant_type: 'refresh_token',
          client_id: settings.clientId,
          client_secret: settings.clientSecret,
          refresh_token: refreshToken,
          scope: SCOPES.join(' '),
        },
      }),
    );
  }

  async fetchProfile(accessToken: string): Promise<DonationAlertsProfile> {
    const raw = profileSchema.parse(
      await this.http.json<unknown>({
        platform: 'donationalerts',
        url: `${this.settings().baseUrl}/api/v1/user/oauth`,
        accessToken,
      }),
    );
    return {
      id: String(raw.data.id),
      name: raw.data.name?.trim() || raw.data.code?.trim() || String(raw.data.id),
      socketConnectionToken: raw.data.socket_connection_token,
    };
  }

  /**
   * Токен подписки на приватный канал сокета.
   *
   * Канал донатов приватный: Centrifugo пускает в него только с токеном,
   * который DonationAlerts выдаёт под конкретного клиента сокета — его
   * идентификатор приходит в ответе на подключение.
   */
  async subscribeToken(accessToken: string, client: string, channel: string): Promise<string> {
    const raw = subscribeSchema.parse(
      await this.http.json<unknown>({
        platform: 'donationalerts',
        url: `${this.settings().baseUrl}/api/v1/centrifuge/subscribe`,
        method: 'POST',
        accessToken,
        json: { channels: [channel], client },
      }),
    );
    const match = raw.channels.find((entry) => entry.channel === channel);
    if (!match) throw new Error('DonationAlerts не выдал токен канала донатов');
    return match.token;
  }

  get socketUrl(): string {
    return this.settings().socketUrl;
  }

  private redirectUri(): string {
    return `${this.config.oauthRedirectBaseUrl.replace(/\/+$/, '')}${DONATIONALERTS_CALLBACK_PATH}`;
  }

  private settings(): NonNullable<AppConfig['donationAlerts']> {
    const settings = this.config.donationAlerts;
    if (!settings) throw new BadRequestException('DonationAlerts не настроен на этом сервере');
    return settings;
  }
}
