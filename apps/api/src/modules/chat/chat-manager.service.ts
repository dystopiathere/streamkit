import { Injectable, Logger, type OnApplicationShutdown } from '@nestjs/common';
import {
  type ChatChannelRef,
  type ChatMessage,
  chatMessageSchema,
  type ChatPlatform,
  type ChatState,
  type IncomingAlertEvent,
} from '@streamkit/contracts';
import { RealtimeBus } from '../../common/bus/realtime-bus.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { RedisLock } from '../../common/redis/lock.service';
import { PresenceService } from '../../common/redis/presence.service';
import { EventsService } from '../events/events.service';
import { chatChannels } from './chat-channel';
import type { ChatSource } from './chat-source';
import { TwitchChatSource } from './twitch-chat.source';
import { YouTubeChatSource } from './youtube-chat.source';

/**
 * Ключ владения чтением чата — один на все площадки.
 *
 * Чтение обязано быть ОДНО на кластер. Две реплики воркера, подключённые к
 * одному каналу, опубликовали бы каждое сообщение дважды, и зрители увидели бы
 * чат в двух экземплярах; у YouTube вдобавок каждый лишний поток тратит квоту
 * проекта. Одна аренда на все источники, а не на каждый: реплика, держащая
 * Twitch, но не YouTube, ничего не выигрывает, а два ключа — это две гонки.
 */
const OWNERSHIP_KEY = 'streamkit:owner:chat';

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
  /** Чьи виджеты оповещений просили события YouTube — сверка состава её обновляет. */
  private eventUsers = new Set<string>();
  private started = false;
  private readonly sources: ChatSource[];

  constructor(
    private readonly prisma: PrismaService,
    twitch: TwitchChatSource,
    youtube: YouTubeChatSource,
    private readonly bus: RealtimeBus,
    private readonly lock: RedisLock,
    private readonly presence: PresenceService,
    private readonly events: EventsService,
  ) {
    this.sources = [twitch, youtube];
  }

  /** Один такт: подтвердить владение и свести состав каналов. */
  async tick(): Promise<void> {
    if (!(await this.holdOwnership())) {
      await this.releaseSource();
      return;
    }

    if (!this.started) {
      for (const source of this.sources) {
        await source.start(
          (message) => void this.publish(message),
          (event) => void this.record(event),
        );
      }
      this.started = true;
    }
    await this.reconcile();
    await this.reportStates();
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
   * Состав каналов = подключённые площадки владельцев виджетов чата, чей оверлей
   * сейчас открыт в OBS, плюс каналы открытых окон эфира (отметки
   * `PresenceService`). Сцену или окно закрыли — отметка истекает, и канал
   * отпускается на следующем такте.
   *
   * Раньше в состав шли все включённые виджеты чата, открыты они или нет. Это
   * значит читать чужие чаты, которые никто не показывает, — сообщения зрителей
   * шли через платформу без всякой цели, — и копить каналы к потолку около
   * сотни на одно анонимное соединение. У YouTube цена ещё и в квоте.
   *
   * Разные стримеры вполне могут смотреть один канал — множество схлопывает
   * такие пары само, и канал слушается один раз.
   */
  private async reconcile(): Promise<void> {
    const wanted = await this.wantedChannels();

    for (const source of this.sources) {
      const channels = wanted.get(source.platform) ?? new Set<string>();
      for (const channel of channels) await source.join(channel);
      for (const channel of source.channels) {
        if (!channels.has(channel)) await source.leave(channel);
      }
      await source.tick?.();
    }
  }

  private async wantedChannels(): Promise<Map<ChatPlatform, Set<string>>> {
    // Оповещения — рядом с чатом в одном запросе: у YouTube события приходят
    // тем же потоком, и виджет оповещений с включёнными событиями YouTube
    // держит этот поток так же, как виджет чата.
    const widgets = await this.prisma.widget.findMany({
      where: {
        type: { in: ['CHAT', 'ALERTS'] },
        isEnabled: true,
        tokens: { some: { revokedAt: null } },
      },
      select: {
        userId: true,
        type: true,
        config: true,
        tokens: { where: { revokedAt: null }, select: { id: true } },
      },
    });
    const online = await this.presence.onlineOverlays(
      widgets.flatMap((widget) => widget.tokens.map((token) => token.id)),
    );
    const shown = widgets.filter((widget) => widget.tokens.some((token) => online.has(token.id)));

    const wanted = new Map<ChatPlatform, Set<string>>();
    const add = (ref: ChatChannelRef) => {
      const set = wanted.get(ref.platform) ?? new Set<string>();
      set.add(ref.channel);
      wanted.set(ref.platform, set);
    };

    // Каналы виджета — подключённые площадки его владельца, кроме тех, что
    // выключены в настройках виджета: чат YouTube, который виджет не покажет,
    // незачем читать за квоту проекта.
    const connected = await chatChannels(this.prisma, [...new Set(shown.map((w) => w.userId))]);
    const events = new Set<string>();
    for (const widget of shown) {
      if (widget.type === 'ALERTS') {
        // Оповещения держат поток только ради событий и только у YouTube:
        // события Twitch приходят своей дорогой, и чат ради них не нужен.
        if ((widget.config as { youtubeEvents?: boolean }).youtubeEvents !== true) continue;
        events.add(widget.userId);
        for (const chat of connected.get(widget.userId) ?? []) {
          if (chat.platform === 'youtube' && !chat.authExpired) add(chat);
        }
        continue;
      }
      const platforms = (widget.config as { platforms?: Partial<Record<ChatPlatform, boolean>> })
        .platforms;
      for (const chat of connected.get(widget.userId) ?? []) {
        if (chat.authExpired || platforms?.[chat.platform] === false) continue;
        add(chat);
      }
    }
    // Кому события нужны, известно только здесь: поток мог быть открыт ради
    // чужого виджета чата, и тогда события с него не наши.
    this.eventUsers = events;
    for (const ref of await this.presence.watchedChats()) add(ref);
    return wanted;
  }

  /** Состояние каналов — окну эфира: «ждём эфира», «квота», «переподключите». */
  private async reportStates(): Promise<void> {
    const states: Array<[ChatChannelRef, ChatState]> = [];
    for (const source of this.sources) {
      for (const [channel, state] of source.states?.() ?? []) {
        states.push([{ platform: source.platform, channel } as ChatChannelRef, state]);
      }
    }
    await this.presence
      .setChatStates(states)
      .catch((error: unknown) => this.logger.warn({ err: error }, 'Состояние чата не записано'));
  }

  /**
   * Событие из потока чата YouTube — в общую ленту событий.
   *
   * Тот же путь, что у вебхука и донат-коннекторов, с той же дедупликацией по
   * `externalId`: поток переоткрывается с последней страницы, и те же строки
   * приходят второй раз.
   */
  private async record(event: IncomingAlertEvent): Promise<void> {
    if (!this.eventUsers.has(event.userId)) return;
    await this.events
      .ingest(event)
      .catch((error: unknown) =>
        this.logger.error({ err: error, provider: event.provider }, 'Событие YouTube не принято'),
      );
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
    for (const source of this.sources) await source.stop();
    this.started = false;
  }
}
