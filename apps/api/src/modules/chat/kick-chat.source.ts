import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import type { ChatMessage, ChatState } from '@streamkit/contracts';
import { RealtimeBus } from '../../common/bus/realtime-bus.service';
import { PlatformAuthError } from '../../common/http/platform-errors';
import { PrismaService } from '../../common/prisma/prisma.service';
import { KICK_CHAT_EVENT, KickProvider } from '../integrations/kick.provider';
import { PlatformTokenService } from '../integrations/platform-token.service';
import { ChatRateLimiter, type ChatSource } from './chat-source';

/**
 * Как часто можно чистить подписку на чат канала, который никто не читает.
 * Строки такого канала идут сотнями, а удаление — запрос к Kick на каждую.
 */
export const KICK_STALE_CLEANUP_MS = 10 * 60_000;

/** Что знаем о канале, который сейчас читаем. */
interface KickChatChannel {
  state: ChatState;
  /** Идёт подписка: второй такт не должен отправить вторую. */
  busy: boolean;
}

/**
 * Чат Kick: подписка приложения на `chat.message.sent` канала, строки —
 * вебхуком в API и оттуда шиной сюда (`kick-chat`).
 *
 * Анонимного чтения у публичного API Kick нет, в отличие от IRC Twitch:
 * подписаться на чат канала можно только токеном с `events:subscribe`, то есть
 * токеном стримера, подключившего этот канал. Отсюда и форма: взять канал —
 * создать подписку, отпустить — удалить её. Пока подписки нет, Kick строк не
 * шлёт, и чат канала, который никто не показывает, через платформу не идёт.
 *
 * Гейт «читается ли канал» — здесь, у владельца аренды чата: вебхук в API не
 * знает состава и публикует всё, что пришло, а строки канала вне состава
 * отбрасываются и заодно чистят забытую подписку (упавший воркер мог её
 * оставить).
 */
@Injectable()
export class KickChatSource implements ChatSource, OnApplicationBootstrap, OnApplicationShutdown {
  readonly platform = 'kick' as const;

  private readonly logger = new Logger(KickChatSource.name);
  private readonly joined = new Map<string, KickChatChannel>();
  private readonly limiter = new ChatRateLimiter(this.logger);
  /** Канал → когда последний раз чистили его забытую подписку. */
  private readonly cleaned = new Map<string, number>();
  private sink: ((message: ChatMessage) => void) | null = null;
  private unsubscribe: (() => Promise<void>) | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: PlatformTokenService,
    private readonly kick: KickProvider,
    private readonly bus: RealtimeBus,
  ) {}

  get channels(): ReadonlySet<string> {
    return new Set(this.joined.keys());
  }

  /**
   * Подписка на шину — на всю жизнь процесса, а не на время аренды чата.
   * Отписка у шины снимает с Redis-канала ВЕСЬ процесс, и остановка источника
   * при потере аренды оглушила бы соседних слушателей воркера — сигнал эфира в
   * том числе. Строки без аренды отбрасывает пустой `sink`.
   */
  async onApplicationBootstrap(): Promise<void> {
    this.unsubscribe = await this.bus.subscribe((message) => {
      if (message.kind === 'kick-chat') this.receive(message.message);
    });
  }

  async onApplicationShutdown(): Promise<void> {
    await this.unsubscribe?.();
    this.unsubscribe = null;
  }

  async start(sink: (message: ChatMessage) => void): Promise<void> {
    this.sink = sink;
  }

  /**
   * Остановка подписки у Kick НЕ удаляет: её зовут при деплое и при потере
   * аренды, а в этот момент канал уже может держать соседняя реплика — удалить
   * значило бы оборвать чат ей. Забытая подписка вычистится на первой строке.
   */
  async stop(): Promise<void> {
    this.sink = null;
    this.joined.clear();
    this.limiter.clear();
    this.cleaned.clear();
  }

  async join(channel: string): Promise<void> {
    if (this.joined.has(channel)) return;
    const entry: KickChatChannel = { state: 'ok', busy: false };
    // В состав — до запроса к Kick: первые строки могут прийти раньше ответа.
    this.joined.set(channel, entry);
    await this.subscribe(channel, entry);
  }

  async leave(channel: string): Promise<void> {
    if (!this.joined.delete(channel)) return;
    this.limiter.forget(channel);
    await this.drop(channel).catch((error: unknown) =>
      this.logger.warn({ err: error, channel }, 'Подписка на чат Kick не удалена'),
    );
  }

  /** Такт: канал без доступа пробуем снова — стример мог переподключить Kick. */
  async tick(): Promise<void> {
    for (const [channel, entry] of this.joined) {
      if (entry.state === 'auth') await this.subscribe(channel, entry);
    }
  }

  states(): Array<[string, ChatState]> {
    return [...this.joined].map(([channel, entry]) => [channel, entry.state]);
  }

  private receive(message: ChatMessage): void {
    // Без аренды чата строки не наши: их обработает реплика, которая её держит.
    if (!this.sink || message.platform !== 'kick') return;
    if (!this.joined.has(message.channel)) {
      this.cleanupStale(message.channel);
      return;
    }
    if (this.limiter.allow(message.channel)) this.sink?.(message);
  }

  private async subscribe(channel: string, entry: KickChatChannel): Promise<void> {
    if (entry.busy) return;
    entry.busy = true;
    try {
      const token = await this.ownerToken(channel);
      if (!token) {
        entry.state = 'auth';
        return;
      }
      const existing = await this.kick.listEventSubscriptions(token, channel);
      if (!existing.some((subscription) => subscription.event === KICK_CHAT_EVENT)) {
        await this.kick.subscribeEvents(token, channel, [KICK_CHAT_EVENT]);
      }
      entry.state = 'ok';
      this.logger.log({ channel }, 'Чат Kick взят');
    } catch (error) {
      entry.state = error instanceof PlatformAuthError && error.status === 401 ? 'auth' : 'ok';
      this.logger.warn({ err: error, channel }, 'Подписка на чат Kick не создана');
    } finally {
      entry.busy = false;
    }
  }

  private async drop(channel: string): Promise<void> {
    const token = await this.ownerToken(channel);
    if (!token) return;
    const subscriptions = await this.kick.listEventSubscriptions(token, channel);
    await this.kick.unsubscribeEvents(
      token,
      subscriptions
        .filter((subscription) => subscription.event === KICK_CHAT_EVENT)
        .map((subscription) => subscription.id),
    );
    this.logger.log({ channel }, 'Чат Kick отпущен');
  }

  private cleanupStale(channel: string): void {
    const now = Date.now();
    if (now - (this.cleaned.get(channel) ?? 0) < KICK_STALE_CLEANUP_MS) return;
    this.cleaned.set(channel, now);
    void this.drop(channel).catch((error: unknown) =>
      this.logger.warn({ err: error, channel }, 'Забытая подписка на чат Kick не удалена'),
    );
  }

  /**
   * Токен того, кто подключил канал. Подключивших может быть несколько
   * (канал в дашбордах двух менеджеров) — берём первый живой.
   */
  private async ownerToken(channel: string): Promise<string | null> {
    const owners = await this.prisma.channel.findMany({
      where: {
        platform: 'KICK',
        externalId: channel,
        isEnabled: true,
        syncState: { not: 'AUTH_EXPIRED' },
      },
      orderBy: { createdAt: 'asc' },
      select: { userId: true },
    });
    for (const { userId } of owners) {
      try {
        return await this.tokens.getAccessToken(userId, 'kick');
      } catch (error) {
        if (!(error instanceof PlatformAuthError)) throw error;
      }
    }
    return null;
  }
}
