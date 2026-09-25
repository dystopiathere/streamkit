import { Injectable, Logger } from '@nestjs/common';
import { PlatformAuthError } from '../../common/http/platform-errors';
import type { ConnectorContext, DonationConnector } from './donation-provider';
import { KICK_ALERT_EVENTS, KickProvider } from './kick.provider';

/**
 * Как часто сверять подписки с Kick.
 *
 * Kick сам отписывает приложение от события, которое сутки не удаётся
 * доставить: авария у нас дольше суток — и оповещения молча перестали бы
 * приходить навсегда. Час — меньше этих суток с большим запасом и всего
 * два запроса на канал.
 */
export const KICK_SUBSCRIPTION_CHECK_MS = 60 * 60_000;

/**
 * Какие из нужных событий ещё не подписаны. Сравнение по имени: версия у всех
 * событий Kick сейчас одна.
 */
export function missingKickEvents(
  existing: ReadonlyArray<{ event: string }>,
  wanted: readonly string[] = KICK_ALERT_EVENTS,
): string[] {
  const have = new Set(existing.map((subscription) => subscription.event));
  return wanted.filter((event) => !have.has(event));
}

/**
 * События канала Kick для оповещений и сигнал эфира.
 *
 * Форма та же, что у EventSub Twitch (`DonationConnector` в воркере, запись в
 * `ConnectorManager`), а транспорт другой: сокета для сторонних приложений у
 * Kick нет, события приходят вебхуком в API (`KickWebhookController`). Поэтому
 * «соединение» здесь — это подписки приложения на события канала, которые
 * коннектор создаёт токеном стримера и раз в час сверяет.
 *
 * Остановка подписки НЕ удаляет: её зовут и при каждом деплое воркера, и
 * удалённые на время перезапуска подписки означали бы пропущенные оповещения.
 * Удаляются они при отвязке площадки (`KickProvider.revokeTokens`), а событие
 * выключенного канала отбрасывает вебхук.
 */
@Injectable()
export class KickEventsConnector implements DonationConnector {
  readonly provider = 'kick' as const;
  private readonly logger = new Logger(KickEventsConnector.name);

  constructor(private readonly kick: KickProvider) {}

  async connect(context: ConnectorContext): Promise<() => Promise<void>> {
    const broadcasterId = context.accountId;
    if (!broadcasterId) throw new Error('Не известен канал Kick для подписки на события');

    let stopped = false;
    const check = async (): Promise<void> => {
      if (stopped) return;
      try {
        await this.ensureSubscribed(context, broadcasterId);
      } catch (error) {
        if (error instanceof PlatformAuthError && error.status === 401) {
          stopped = true;
          clearInterval(timer);
          context.onAccessLost('Kick отозвал доступ к событиям канала');
          return;
        }
        // Остальное — сбой сети или площадки: следующая сверка попробует снова.
        context.reportFailure(error instanceof Error ? error.message : String(error));
      }
    };

    const timer = setInterval(() => void check(), KICK_SUBSCRIPTION_CHECK_MS);
    timer.unref();
    await check();

    return async () => {
      stopped = true;
      clearInterval(timer);
    };
  }

  private async ensureSubscribed(context: ConnectorContext, broadcasterId: string): Promise<void> {
    const token = await context.getAccessToken();
    const existing = await this.kick.listEventSubscriptions(token, broadcasterId);
    const missing = missingKickEvents(existing);
    if (missing.length === 0) return;
    await this.kick.subscribeEvents(token, broadcasterId, missing);
    this.logger.log({ userId: context.userId, events: missing.length }, 'Подписки Kick созданы');
  }
}
