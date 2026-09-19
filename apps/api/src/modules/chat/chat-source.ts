import type { Logger } from '@nestjs/common';
import type { ChatMessage, ChatPlatform, ChatState } from '@streamkit/contracts';

/**
 * Источник чата площадки: единица работы — КАНАЛ.
 *
 * Третья форма интеграции в проекте, и она не случайна (docs/adr/0009, 0014).
 * `DonationConnector` — подписка на пользователя: площадка присылает события
 * одного стримера, и соединение заводится на каждого. `PlatformProvider` —
 * опрос: спроси метрики, получи снимок, закрой соединение.
 *
 * Чат не похож ни на то, ни на другое: воркер подписывается на каналы, а как
 * источник их держит — его дело. Twitch держит все каналы в одном анонимном
 * сокете IRC; YouTube — поток gRPC на каждый идущий эфир, и все они
 * мультиплексируются в одном HTTP/2-соединении.
 */
export interface ChatSource {
  readonly platform: ChatPlatform;
  /** На какие каналы подписаны сейчас. */
  readonly channels: ReadonlySet<string>;
  start(sink: (message: ChatMessage) => void): Promise<void>;
  join(channel: string): Promise<void>;
  leave(channel: string): Promise<void>;
  stop(): Promise<void>;
  /**
   * Такт воркера — для источников, которым есть что делать по времени (искать
   * начавшийся эфир). Вызывается после сверки состава.
   */
  tick?(): Promise<void>;
  /** Что происходит с каналами — для окна эфира. Нет метода — всё читается. */
  states?(): Array<[string, ChatState]>;
}

/**
 * Сколько сообщений в секунду публикуем с одного канала.
 *
 * Популярный канал даёт сотни сообщений в минуту, и каждое уходит в Redis и в
 * сокет каждого открытого браузер-сорса. Виджет всё равно показывает два
 * десятка строк. Это не защита от абьюза, а отказ превращать шину в узкое место
 * ради строк, которые никто не успеет прочитать.
 */
export const MAX_MESSAGES_PER_SECOND = 20;

/** Ограничитель потока: скользящая секунда на канал. */
export class ChatRateLimiter {
  /** Канал → [начало секунды, сколько пропущено, сколько отброшено]. */
  private readonly rate = new Map<string, { second: number; count: number; dropped: number }>();

  constructor(
    private readonly logger: Logger,
    private readonly perSecond = MAX_MESSAGES_PER_SECOND,
  ) {}

  allow(channel: string): boolean {
    const second = Math.floor(Date.now() / 1000);
    const state = this.rate.get(channel);

    if (!state || state.second !== second) {
      if (state && state.dropped > 0) {
        this.logger.debug({ channel, dropped: state.dropped }, 'Поток чата подрезан');
      }
      this.rate.set(channel, { second, count: 1, dropped: 0 });
      return true;
    }

    if (state.count >= this.perSecond) {
      state.dropped += 1;
      return false;
    }
    state.count += 1;
    return true;
  }

  /**
   * Счётчик живёт, пока канал в составе: иначе карта копила бы все каналы,
   * когда-либо открытые за жизнь процесса.
   */
  forget(channel: string): void {
    this.rate.delete(channel);
  }

  clear(): void {
    this.rate.clear();
  }
}
