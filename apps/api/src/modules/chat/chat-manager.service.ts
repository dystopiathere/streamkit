import { Injectable, Logger, type OnApplicationShutdown } from '@nestjs/common';
import { chatMessageSchema, chatWidgetConfigSchema, type ChatMessage } from '@streamkit/contracts';
import { RealtimeBus } from '../../common/bus/realtime-bus.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { RedisLock } from '../../common/redis/lock.service';
import { PresenceService } from '../../common/redis/presence.service';
import { TwitchChatSource } from './twitch-chat.source';

/**
 * Ключ владения соединением с чатом.
 *
 * Соединение обязано быть ОДНО на кластер. Две реплики воркера, подключённые к
 * одному каналу, опубликовали бы каждое сообщение дважды, и зрители увидели бы
 * чат в двух экземплярах.
 */
const OWNERSHIP_KEY = 'streamkit:owner:chat:twitch';

/**
 * Срок владения и шаг продления.
 *
 * Честная цена решения: при внезапной гибели владельца чат пропадает до
 * тридцати секунд, пока ключ не истечёт. Для чата это приемлемо. Для донатов —
 * нет, и поэтому там дедупликация по идентификатору события, а не владение:
 * пропущенный донат не восстановится, а пропущенная минута чата никому не
 * нужна уже через минуту.
 */
const OWNERSHIP_TTL_MS = 30_000;
export const CHAT_TICK_MS = 10_000;

/**
 * Кто читает чат и какие каналы слушает.
 *
 * Состав каналов сверяется опросом БД, а не командой по шине, и это осознанно:
 * механизма команд воркеру в проекте нет вовсе, и донат-коннекторы сверяются
 * так же (`ConnectorManager.reconcile`). Стример создал виджет и ждёт чат сейчас, а
 * не после следующего деплоя. Один лёгкий запрос раз в десять секунд дешевле,
 * чем заводить канал команд.
 */
@Injectable()
export class ChatManager implements OnApplicationShutdown {
  private readonly logger = new Logger(ChatManager.name);
  private ownership: string | null = null;
  private started = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly source: TwitchChatSource,
    private readonly bus: RealtimeBus,
    private readonly lock: RedisLock,
    private readonly presence: PresenceService,
  ) {}

  /** Один такт: подтвердить владение и свести состав каналов. */
  async tick(): Promise<void> {
    if (!(await this.holdOwnership())) {
      await this.releaseSource();
      return;
    }

    if (!this.started) {
      await this.source.start((message) => void this.publish(message));
      this.started = true;
    }
    await this.reconcile();
  }

  async onApplicationShutdown(): Promise<void> {
    await this.releaseSource();
    if (this.ownership) {
      // Отдаём владение явно: иначе соседняя реплика ждала бы истечения TTL,
      // и чат молчал бы полминуты на ровном месте при обычном деплое.
      await this.lock.release(OWNERSHIP_KEY, this.ownership);
      this.ownership = null;
    }
  }

  /** @returns владеем ли соединением после этой попытки. */
  private async holdOwnership(): Promise<boolean> {
    if (this.ownership) {
      if (await this.lock.renew(OWNERSHIP_KEY, this.ownership, OWNERSHIP_TTL_MS)) return true;
      // Ключ уже не наш: связь с Redis пропадала дольше TTL, и соединение
      // забрала другая реплика. Продолжать читать чат значит дублировать её.
      this.logger.warn('Владение чатом потеряно, соединение закрывается');
      this.ownership = null;
      return false;
    }

    this.ownership = await this.lock.acquire(OWNERSHIP_KEY, OWNERSHIP_TTL_MS);
    if (this.ownership) this.logger.log('Владение чатом получено');
    return this.ownership !== null;
  }

  /**
   * Состав каналов = логины из настроек всех включённых виджетов чата плюс
   * каналы открытых окон эфира (отметки `PresenceService.watchChat`). Окно
   * закрыли — отметка истекает, и канал отпускается на следующем такте.
   *
   * Разные стримеры вполне могут смотреть один канал — множество схлопывает
   * такие пары само, и соединение слушает его один раз.
   */
  private async reconcile(): Promise<void> {
    const wanted = await this.wantedChannels();

    for (const channel of wanted) {
      await this.source.join(channel);
    }
    for (const channel of this.source.channels) {
      if (!wanted.has(channel)) await this.source.leave(channel);
    }
  }

  private async wantedChannels(): Promise<Set<string>> {
    const widgets = await this.prisma.widget.findMany({
      where: { type: 'CHAT', isEnabled: true },
      select: { config: true },
    });

    const channels = await this.presence.watchedChats();
    for (const widget of widgets) {
      const config = chatWidgetConfigSchema.safeParse(widget.config);
      // Пустой канал — виджет создали, но ещё не настроили. Это не ошибка.
      if (config.success && config.data.channel.length > 0) channels.add(config.data.channel);
    }
    return channels;
  }

  private async publish(message: ChatMessage): Promise<void> {
    const parsed = chatMessageSchema.safeParse(message);
    if (!parsed.success) {
      // Сообщение собрано нами из чужих данных: в шину уходит только то, что
      // сходится со схемой, иначе разбирать мусор пришлось бы в каждом оверлее.
      this.logger.debug({ channel: message.channel }, 'Сообщение чата не прошло схему');
      return;
    }

    await this.bus
      .publish({ kind: 'chat', message: parsed.data })
      .catch((error: unknown) => this.logger.warn({ err: error }, 'Сообщение чата не доставлено'));
  }

  private async releaseSource(): Promise<void> {
    if (!this.started) return;
    await this.source.stop();
    this.started = false;
  }
}
