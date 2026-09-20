import { Inject, Injectable, Logger } from '@nestjs/common';
import type {
  ChatChannelRef,
  AlertEvent,
  ChannelStats,
  ChatMessage,
  OverlayRevokeReason,
  Platform,
  WidgetConfig,
  WidgetState,
} from '@streamkit/contracts';
import type { Redis } from 'ioredis';
import { REDIS_PUBLISHER, REDIS_SUBSCRIBER } from '../redis/redis.module';

export const BUS_CHANNEL = 'streamkit:realtime';

export type BusMessage =
  | { kind: 'alert'; userId: string; event: AlertEvent }
  | ({
      kind: 'widget-config';
      userId: string;
      widgetId: string;
      isEnabled: boolean;
    } & WidgetConfig)
  | { kind: 'widget-state'; widgetId: string; state: WidgetState }
  // Чат адресуется КАНАЛОМ, а не пользователем: комната доставки общая на
  // канал, и раскладывать сообщение по виджетам на каждой реплике не нужно.
  | { kind: 'chat'; message: ChatMessage }
  // Каналы чата пользователя сменились: подключили другой аккаунт площадки или
  // отключили её. Оверлеи его виджетов чата переходят в новые комнаты.
  | { kind: 'chat-channel'; userId: string; channels: ChatChannelRef[] }
  | { kind: 'overlay-revoked'; tokenId: string; reason: OverlayRevokeReason }
  | { kind: 'analytics'; userId: string; channelId: string; stats: ChannelStats }
  // Площадка сообщила о начале или конце эфира. Адресат — не браузер, а сбор
  // метрик в воркере: сокет EventSub висит на одной реплике, а опрос идёт на
  // той, что держит блокировку, и другого пути между ними нет.
  | { kind: 'channel-live'; userId: string; platform: Platform; isLive: boolean }
  // Аккаунт заблокирован: открытые вкладки дашборда отключаются, а не
  // досматривают ленту событий до конца срока токена.
  | { kind: 'user-suspended'; userId: string };

/**
 * Шина реального времени поверх Redis pub/sub.
 *
 * Нужна по двум причинам.
 *
 * 1. Масштабирование: сокет клиента висит на одном инстансе API, а событие может
 *    прийти на любой другой. Без общей шины алерт просто не дойдёт.
 * 2. Развязка модулей: виджеты публикуют «конфиг изменился», ничего не зная о
 *    gateway, а gateway ничего не знает о сервисе виджетов на уровне модулей.
 *    Иначе получается цикл импортов.
 *
 * Доставка socket.io между инстансами при этом обеспечивается redis-адаптером;
 * эта шина отвечает за доменные события, а не за транспорт сокета.
 */
@Injectable()
export class RealtimeBus {
  private readonly logger = new Logger(RealtimeBus.name);

  constructor(
    @Inject(REDIS_PUBLISHER) private readonly publisher: Redis,
    @Inject(REDIS_SUBSCRIBER) private readonly subscriber: Redis,
  ) {}

  async publish(message: BusMessage): Promise<void> {
    await this.publisher.publish(BUS_CHANNEL, JSON.stringify(message));
  }

  /**
   * Подписка. Возвращает функцию отписки. Ошибки разбора сообщения не должны
   * ронять подписчика: чужой мусор в канале — не повод терять живые события.
   */
  async subscribe(handler: (message: BusMessage) => void): Promise<() => Promise<void>> {
    const listener = (channel: string, payload: string): void => {
      if (channel !== BUS_CHANNEL) return;
      try {
        handler(JSON.parse(payload) as BusMessage);
      } catch (error) {
        this.logger.warn({ err: error }, 'Не удалось разобрать сообщение шины');
      }
    };

    this.subscriber.on('message', listener);
    await this.subscriber.subscribe(BUS_CHANNEL);

    return async () => {
      this.subscriber.off('message', listener);
      await this.subscriber.unsubscribe(BUS_CHANNEL).catch(() => undefined);
    };
  }
}
