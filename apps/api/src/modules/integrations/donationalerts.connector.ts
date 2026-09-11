import { Injectable, Logger } from '@nestjs/common';
import type { IncomingAlertEvent } from '@streamkit/contracts';
import type { ConnectorContext, DonationConnector } from './donation-provider';

/**
 * Коннектор DonationAlerts.
 *
 * Протокол (по публичной документации DonationAlerts API):
 *  1. OAuth2 authorization code со scope `oauth-donation-subscribe`;
 *  2. `GET /api/v1/user/oauth` — профиль и `socket_connection_token`;
 *  3. подключение к Centrifugo (`wss://centrifugo.donationalerts.com/connection/websocket`);
 *  4. приватный канал `$alerts:donation_<userId>` требует подписи: клиент
 *     запрашивает её у `POST /api/v1/centrifuge/subscribe` своим access-токеном.
 *
 * ВАЖНО: этот код написан по документации и НЕ проверен на живом аккаунте —
 * для этого нужно зарегистрированное приложение DonationAlerts. До первой
 * проверки на реальных данных рабочим путём приёма событий остаётся собственный
 * вебхук (`/api/webhooks/:sourceId`), который покрыт тестами.
 */
@Injectable()
export class DonationAlertsConnector implements DonationConnector {
  readonly provider = 'donationalerts' as const;

  private readonly logger = new Logger(DonationAlertsConnector.name);
  private readonly apiBase = 'https://www.donationalerts.com/api/v1';

  async connect(context: ConnectorContext): Promise<() => Promise<void>> {
    const profile = await this.fetchProfile(context.accessToken);

    this.logger.log(
      { userId: context.userId, externalId: profile.id },
      'Подключение к DonationAlerts',
    );

    // Реальное websocket-соединение с Centrifugo подключается здесь.
    // Пока соединение не реализовано, возвращаем корректную функцию остановки,
    // чтобы менеджер коннекторов вёл себя одинаково для всех провайдеров.
    const stop = async (): Promise<void> => {
      this.logger.log({ userId: context.userId }, 'Отключение от DonationAlerts');
    };

    return stop;
  }

  /** Профиль пользователя и токен для сокета. */
  private async fetchProfile(accessToken: string): Promise<{
    id: number;
    socketConnectionToken: string;
  }> {
    const response = await fetch(`${this.apiBase}/user/oauth`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!response.ok) {
      throw new Error(`DonationAlerts вернул ${response.status}`);
    }

    const payload = (await response.json()) as {
      data: { id: number; socket_connection_token: string };
    };

    return {
      id: payload.data.id,
      socketConnectionToken: payload.data.socket_connection_token,
    };
  }

  /**
   * Приведение события DonationAlerts к нашему виду.
   *
   * Вынесено отдельным чистым методом специально: это единственная часть
   * коннектора, которую можно проверить тестом без сети и без аккаунта, и
   * именно здесь живут все неприятности — валюта строкой, сумма дробным числом,
   * отсутствующее имя у анонимного доната.
   */
  normalize(raw: DonationAlertsMessage, userId: string): IncomingAlertEvent {
    return {
      userId,
      type: 'donation',
      provider: 'donationalerts',
      externalId: String(raw.id),
      username: raw.username?.trim() || 'Аноним',
      message: raw.message ?? '',
      amount: {
        // Сумма приходит дробным числом (например 100.5). Переводим в копейки
        // округлением: хранить деньги в float нельзя ни на одном этапе.
        amountMinor: Math.round(Number(raw.amount) * 100),
        currency: normalizeCurrency(raw.currency),
      },
      isTest: false,
      occurredAt: raw.created_at ? new Date(raw.created_at).toISOString() : undefined,
    };
  }
}

export interface DonationAlertsMessage {
  id: number | string;
  username?: string | null;
  message?: string | null;
  amount: number | string;
  currency: string;
  created_at?: string;
}

const SUPPORTED_CURRENCIES = new Set(['RUB', 'USD', 'EUR', 'KZT', 'BYN', 'UAH']);

/**
 * Валюта, которую мы не поддерживаем, не должна ронять приём события: донат
 * лучше показать в рублях с неверным символом, чем не показать вовсе.
 */
function normalizeCurrency(currency: string): 'RUB' | 'USD' | 'EUR' | 'KZT' | 'BYN' | 'UAH' {
  const upper = currency?.toUpperCase();
  return (SUPPORTED_CURRENCIES.has(upper) ? upper : 'RUB') as 'RUB';
}
