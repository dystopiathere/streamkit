import { Injectable, Logger } from '@nestjs/common';
import {
  CURRENCIES,
  type Currency,
  type IncomingAlertEvent,
  parseMajorToMinor,
} from '@streamkit/contracts';
import { CentrifugoSubscription } from './centrifugo-subscription';
import { DonationAlertsApi } from './donationalerts.api';
import type { ConnectorContext, DonationConnector } from './donation-provider';

/**
 * Коннектор DonationAlerts: донаты в реальном времени через их Centrifugo.
 *
 * Порядок по документации DonationAlerts API:
 *  1. профиль `GET /api/v1/user/oauth` — в нём `socket_connection_token`;
 *  2. сокет `wss://centrifugo.donationalerts.com/connection/websocket`,
 *     подключение с этим токеном — в ответ идентификатор клиента;
 *  3. токен приватного канала `$alerts:donation_<id>` —
 *     `POST /api/v1/centrifuge/subscribe` с идентификатором клиента;
 *  4. подписка на канал, дальше донаты приходят сами.
 *
 * Проверен против поддельного сервера по этой же документации; на живом
 * аккаунте — после регистрации приложения DonationAlerts.
 */
@Injectable()
export class DonationAlertsConnector implements DonationConnector {
  readonly provider = 'donationalerts' as const;
  private readonly logger = new Logger(DonationAlertsConnector.name);

  constructor(private readonly api: DonationAlertsApi) {}

  async connect(context: ConnectorContext): Promise<() => Promise<void>> {
    const lost = (): void =>
      context.onAccessLost('Доступ к DonationAlerts потерян — подключите аккаунт заново');
    const subscription = new CentrifugoSubscription({
      service: 'DonationAlerts',
      userId: context.userId,
      logger: this.logger,
      resolve: async () => {
        const accessToken = await context.getAccessToken();
        const profile = await this.api.fetchProfile(accessToken);
        const channel = `$alerts:donation_${profile.id}`;
        return {
          url: this.api.socketUrl,
          connectToken: profile.socketConnectionToken,
          channel,
          subscribeToken: (client) => this.api.subscribeToken(accessToken, client, channel),
        };
      },
      onPublication: async (data) =>
        context.emit(normalizeDonation(data as DonationAlertsMessage, context.userId)),
      onAccessLost: lost,
      reportFailure: context.reportFailure,
    });
    subscription.start();
    return async () => subscription.stop();
  }
}

/** Донат в том виде, в каком его присылает DonationAlerts. */
export interface DonationAlertsMessage {
  id: number | string;
  username?: string | null;
  message?: string | null;
  /** `text` или `audio`: у голосового доната в `message` не текст. */
  message_type?: string | null;
  /**
   * Ссылка на запись голосового доната.
   *
   * Поля нет в документации DonationAlerts, и на живом аккаунте оно ещё не
   * проверено: разбор написан «если придёт». Не пришло — донат показывается
   * без голоса, как раньше, а не теряется.
   */
  audio_url?: string | null;
  amount: number | string;
  currency: string;
}

/**
 * Донат DonationAlerts → наше событие.
 *
 * Сумма приходит дробным числом (`100.5`) и переводится в копейки через
 * строку, без умножения в плавающей точке: деньги во float запрещены на любом
 * этапе. Валюта, которой у нас нет, не превращается в рубли — сумма тогда
 * неизвестна, а сам донат всё равно показывается: иначе десять долларов
 * засчитались бы в цель как десять рублей.
 */
export function normalizeDonation(raw: DonationAlertsMessage, userId: string): IncomingAlertEvent {
  const currency = raw.currency?.toUpperCase();
  const amountMinor = parseMajorToMinor(String(raw.amount));
  const knownCurrency = (CURRENCIES as readonly string[]).includes(currency);

  return {
    userId,
    type: 'donation',
    provider: 'donationalerts',
    externalId: String(raw.id),
    username: (raw.username?.trim() || 'Аноним').slice(0, 64),
    message: raw.message_type === 'audio' ? '' : (raw.message ?? '').slice(0, 500),
    audioUrl: raw.message_type === 'audio' ? voiceUrl(raw.audio_url) : null,
    amount:
      amountMinor !== null && amountMinor >= 0 && knownCurrency
        ? { amountMinor, currency: currency as Currency }
        : null,
    count: null,
    isTest: false,
  };
}

/**
 * Ссылка на голосовой донат — только https и только в пределах длины поля.
 *
 * Проверяется здесь, а не схемой события: непригодная ссылка не повод потерять
 * донат целиком — он покажется без голоса. Схема же на `null` не ругается.
 */
function voiceUrl(url: string | null | undefined): string | null {
  const value = url?.trim();
  return value && value.startsWith('https://') && value.length <= 2048 ? value : null;
}
