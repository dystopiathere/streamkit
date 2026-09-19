import * as grpc from '@grpc/grpc-js';
import { Injectable, Logger } from '@nestjs/common';
import type { ChatMessage, ChatState } from '@streamkit/contracts';
import { HttpClient } from '../../common/http/http-client.service';
import { PlatformAuthError, PlatformQuotaError } from '../../common/http/platform-errors';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AppConfig } from '../../config/app-config.service';
import { nextQuotaReset, QuotaService, YOUTUBE_CHAT_QUOTA } from '../analytics/quota.service';
import { PlatformTokenService } from '../integrations/platform-token.service';
import { ChatRateLimiter, type ChatSource } from './chat-source';
import {
  createYouTubeChatClient,
  type YouTubeChatClient,
  youtubeToChatMessage,
} from './youtube-chat';
import type { YouTubeChatResponse } from './youtube-chat.proto';

/**
 * Как часто искать начавшийся эфир, пока чат нужен, а эфира нет.
 *
 * `liveBroadcasts.list` стоит единицу квоты. Две минуты — это 30 единиц за час
 * предэфира с открытым OBS, и чат появляется не позже чем через две минуты
 * после старта.
 */
export const DISCOVERY_INTERVAL_MS = 2 * 60_000;

/** Потолок паузы между переподключениями потока. */
const MAX_RECONNECT_MS = 60_000;

/**
 * Поток, закрытый сервером быстрее этого, — не штатная ротация, а сбой.
 * Без порога поток, который закрывается сразу после открытия, переоткрывался
 * бы раз в секунду и тратил квоту на каждое открытие.
 */
const HEALTHY_STREAM_MS = 30_000;

/**
 * Насколько старые сообщения показывать при первом подключении к эфиру.
 *
 * Первым ответом YouTube присылает недавнюю историю чата. В кадре она
 * выглядела бы как взрыв старых сообщений в момент открытия сцены; Twitch
 * истории не присылает вовсе, и чат должен вести себя одинаково.
 */
const HISTORY_GRACE_MS = 5_000;

interface Session {
  /** Id канала YouTube `UC…`. */
  channel: string;
  state: ChatState;
  /** Чей токен читает чат: владелец подключённого канала. */
  userId: string | null;
  liveChatId: string | null;
  /** Откуда продолжить после обрыва: без него сообщения терялись бы или повторялись. */
  pageToken: string | null;
  call: grpc.ClientReadableStream<YouTubeChatResponse> | null;
  openedAt: number;
  /** Сообщения старше не показываем: история при первом подключении. */
  since: number;
  /** Когда снова искать эфир или открывать поток. */
  nextAttemptAt: number;
  attempts: number;
  /** Отказ по токену уже повторяли — второй означает, что доступ отозван. */
  authRetried: boolean;
  busy: boolean;
}

/**
 * Чтение чата YouTube через `liveChatMessages.streamList` (gRPC).
 *
 * Чат YouTube существует только у идущего эфира, поэтому канал проходит два
 * состояния: ищем эфир (`liveBroadcasts.list` раз в две минуты) и читаем поток
 * его чата. Поток — по токену стримера: `youtube.readonly` хватает, чтобы
 * читать чат своего эфира, и нового разрешения Google не нужно.
 *
 * Квота — главное ограничение (docs/adr/0007, 0014): у проекта Google один
 * суточный лимит на всех. Каждое открытие потока и каждый поиск эфира
 * резервируются в бюджете чата ДО запроса.
 */
@Injectable()
export class YouTubeChatSource implements ChatSource {
  readonly platform = 'youtube' as const;

  private readonly logger = new Logger(YouTubeChatSource.name);
  private readonly sessions = new Map<string, Session>();
  private readonly limiter = new ChatRateLimiter(this.logger);
  private readonly joined = new Set<string>();
  private client: YouTubeChatClient | null = null;
  private sink: ((message: ChatMessage) => void) | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly http: HttpClient,
    private readonly tokens: PlatformTokenService,
    private readonly quota: QuotaService,
    private readonly config: AppConfig,
  ) {}

  get channels(): ReadonlySet<string> {
    return this.joined;
  }

  async start(sink: (message: ChatMessage) => void): Promise<void> {
    this.sink = sink;
  }

  async join(channel: string): Promise<void> {
    if (this.sessions.has(channel)) return;
    const session: Session = {
      channel,
      state: 'waiting',
      userId: null,
      liveChatId: null,
      pageToken: null,
      call: null,
      openedAt: 0,
      since: 0,
      nextAttemptAt: 0,
      attempts: 0,
      authRetried: false,
      busy: false,
    };
    this.sessions.set(channel, session);
    this.joined.add(channel);
    // Сразу, а не на следующем такте: стример открыл окно и ждёт чат.
    void this.advance(session);
  }

  async leave(channel: string): Promise<void> {
    const session = this.sessions.get(channel);
    if (!session) return;
    this.sessions.delete(channel);
    this.joined.delete(channel);
    this.limiter.forget(channel);
    this.closeCall(session);
  }

  async stop(): Promise<void> {
    for (const session of this.sessions.values()) this.closeCall(session);
    this.sessions.clear();
    this.joined.clear();
    this.limiter.clear();
    this.client?.close();
    this.client = null;
    this.sink = null;
  }

  /** Такт воркера: найти эфиры, дождавшиеся своей попытки, и переоткрыть потоки. */
  async tick(): Promise<void> {
    const now = Date.now();
    await Promise.all(
      [...this.sessions.values()]
        .filter((session) => !session.call && !session.busy && now >= session.nextAttemptAt)
        .map((session) => this.advance(session)),
    );
  }

  states(): Array<[string, ChatState]> {
    return [...this.sessions.values()].map((session) => [session.channel, session.state]);
  }

  /** Шаг: эфир известен — открыть поток, нет — искать эфир. */
  private async advance(session: Session): Promise<void> {
    if (session.busy || session.call) return;
    session.busy = true;
    try {
      if (!session.liveChatId) await this.discover(session);
      if (session.liveChatId && this.sessions.get(session.channel) === session) {
        await this.openStream(session);
      }
    } catch (error) {
      await this.handleFailure(session, error);
    } finally {
      session.busy = false;
    }
  }

  /** Идёт ли эфир и какой у него чат. Только свой эфир — `mine=true` токеном владельца. */
  private async discover(session: Session): Promise<void> {
    const owner = await this.prisma.channel.findFirst({
      where: { platform: 'YOUTUBE', externalId: session.channel },
      orderBy: { createdAt: 'asc' },
      select: { userId: true, syncState: true },
    });
    if (!owner || owner.syncState === 'AUTH_EXPIRED') {
      // Канал отключили или доступ отозван: сверка уберёт его из состава, а
      // до тех пор окно покажет, что нужно переподключение.
      this.wait(session, owner ? 'auth' : 'waiting', Date.now() + DISCOVERY_INTERVAL_MS);
      return;
    }
    session.userId = owner.userId;

    if (!(await this.quota.reserve(YOUTUBE_CHAT_QUOTA, 1))) {
      this.wait(session, 'quota', nextQuotaReset(new Date()).getTime());
      return;
    }
    const token = await this.tokens.getAccessToken(owner.userId, 'youtube');
    const response = await this.http.json<{
      items?: Array<{ snippet?: { liveChatId?: string } }>;
    }>({
      platform: 'youtube',
      url: `${this.config.youtubeEndpoints.api}/liveBroadcasts?part=snippet&broadcastStatus=active&broadcastType=all&mine=true`,
      accessToken: token,
    });

    const liveChatId = response.items?.find((item) => item.snippet?.liveChatId)?.snippet
      ?.liveChatId;
    if (!liveChatId) {
      this.wait(session, 'waiting', Date.now() + DISCOVERY_INTERVAL_MS);
      return;
    }
    session.liveChatId = liveChatId;
    session.pageToken = null;
    session.since = Date.now() - HISTORY_GRACE_MS;
  }

  private async openStream(session: Session): Promise<void> {
    if (!session.userId || !session.liveChatId) return;
    if (!(await this.quota.reserve(YOUTUBE_CHAT_QUOTA, this.config.youtubeChatStreamCost))) {
      this.wait(session, 'quota', nextQuotaReset(new Date()).getTime());
      return;
    }

    const token = await this.tokens.getAccessToken(session.userId, 'youtube');
    const metadata = new grpc.Metadata();
    metadata.set('authorization', `Bearer ${token}`);

    const call = this.grpcClient().StreamList(
      {
        liveChatId: session.liveChatId,
        part: ['id', 'snippet', 'authorDetails'],
        ...(session.pageToken ? { pageToken: session.pageToken } : {}),
      },
      metadata,
    );
    session.call = call;
    session.openedAt = Date.now();
    session.state = 'ok';

    call.on('data', (response: YouTubeChatResponse) => this.onResponse(session, call, response));
    call.on('error', (error: grpc.ServiceError) => this.onError(session, call, error));
    call.on('end', () => this.onEnd(session, call));
  }

  private onResponse(
    session: Session,
    call: grpc.ClientReadableStream<YouTubeChatResponse>,
    response: YouTubeChatResponse,
  ): void {
    if (session.call !== call) return;
    session.attempts = 0;
    session.authRetried = false;
    if (response.nextPageToken) session.pageToken = response.nextPageToken;

    for (const item of response.items ?? []) {
      if (item.snippet?.type === 'CHAT_ENDED_EVENT') {
        this.endBroadcast(session);
        return;
      }
      const message = youtubeToChatMessage(item, session.channel);
      if (!message || Date.parse(message.sentAt) < session.since) continue;
      if (this.limiter.allow(session.channel)) this.sink?.(message);
    }
    if (response.offlineAt) this.endBroadcast(session);
  }

  /**
   * Отказ потока. Коды gRPC, а не HTTP: 403 здесь — `PERMISSION_DENIED`, и он
   * так же двусмыслен, как у REST, — и квота, и «чат выключен».
   */
  private onError(
    session: Session,
    call: grpc.ClientReadableStream<YouTubeChatResponse>,
    error: grpc.ServiceError,
  ): void {
    if (session.call !== call) return;
    session.call = null;
    const details = (error.details ?? error.message ?? '').toLowerCase();

    if (details.includes('quota')) {
      // Лимит проекта: чат и метрики стоят до полуночи по тихоокеанскому времени.
      void this.quota.exhaust(YOUTUBE_CHAT_QUOTA).catch(() => undefined);
      session.liveChatId = null;
      this.wait(session, 'quota', nextQuotaReset(new Date()).getTime());
      return;
    }

    switch (error.code) {
      case grpc.status.UNAUTHENTICATED:
        if (!session.authRetried) {
          // Токен живёт час, и поток переживает его: переоткрываем со свежим.
          session.authRetried = true;
          this.reconnect(session, 0);
          return;
        }
        void this.markAuthExpired(session);
        return;

      case grpc.status.NOT_FOUND:
      case grpc.status.FAILED_PRECONDITION:
      case grpc.status.PERMISSION_DENIED:
        // Чат закончился, эфир снят или чат выключен стримером: ищем эфир заново.
        this.logger.log({ code: error.code }, 'Чат YouTube недоступен, ищем эфир заново');
        this.endBroadcast(session);
        return;

      case grpc.status.INVALID_ARGUMENT:
        // Протухший pageToken: начинаем с текущего момента, без истории.
        session.pageToken = null;
        session.since = Date.now() - HISTORY_GRACE_MS;
        this.reconnect(session);
        return;

      default:
        this.logger.warn({ code: error.code }, 'Поток чата YouTube оборвался, переподключаемся');
        this.reconnect(session);
    }
  }

  /** Сервер закрыл поток штатно — продолжаем с того же места. */
  private onEnd(session: Session, call: grpc.ClientReadableStream<YouTubeChatResponse>): void {
    if (session.call !== call) return;
    session.call = null;
    const healthy = Date.now() - session.openedAt >= HEALTHY_STREAM_MS;
    if (healthy) session.attempts = 0;
    this.reconnect(session, healthy ? 0 : undefined);
  }

  /**
   * Переоткрыть поток. Пауза растёт лесенкой 1, 2, 4… до минуты: каждое
   * открытие стоит квоты, и сбойный поток не должен сжечь суточный бюджет.
   */
  private reconnect(session: Session, delay?: number): void {
    session.attempts += 1;
    const wait = delay ?? Math.min(2 ** (session.attempts - 1) * 1000, MAX_RECONNECT_MS);
    session.nextAttemptAt = Date.now() + wait;
    if (wait === 0) void this.advance(session);
    // Иначе — на такте воркера, когда подойдёт время.
  }

  /** Эфир закончился: закрыть поток и вернуться к поиску. */
  private endBroadcast(session: Session): void {
    this.closeCall(session);
    session.liveChatId = null;
    session.pageToken = null;
    this.wait(session, 'waiting', Date.now() + DISCOVERY_INTERVAL_MS);
  }

  private wait(session: Session, state: ChatState, until: number): void {
    session.state = state;
    session.nextAttemptAt = until;
  }

  private async handleFailure(session: Session, error: unknown): Promise<void> {
    if (error instanceof PlatformQuotaError) {
      if (error.isDaily) await this.quota.exhaust(YOUTUBE_CHAT_QUOTA).catch(() => undefined);
      this.wait(
        session,
        'quota',
        error.isDaily ? nextQuotaReset(new Date()).getTime() : Date.now() + DISCOVERY_INTERVAL_MS,
      );
      return;
    }
    if (error instanceof PlatformAuthError) {
      await this.markAuthExpired(session);
      return;
    }
    this.logger.warn({ err: error }, 'Не удалось подключиться к чату YouTube');
    this.wait(session, session.liveChatId ? 'ok' : 'waiting', Date.now() + DISCOVERY_INTERVAL_MS);
  }

  /**
   * Доступ отозван: канал уходит в `AUTH_EXPIRED` тем же путём, что при опросе
   * метрик, — карточка канала просит переподключить YouTube, а сверка чата
   * перестаёт его подключать.
   */
  private async markAuthExpired(session: Session): Promise<void> {
    this.closeCall(session);
    session.liveChatId = null;
    this.wait(session, 'auth', Date.now() + DISCOVERY_INTERVAL_MS);
    if (!session.userId) return;
    await this.prisma.channel
      .updateMany({
        where: { userId: session.userId, platform: 'YOUTUBE', externalId: session.channel },
        data: { syncState: 'AUTH_EXPIRED', syncError: 'Площадка отвергла доступ к чату' },
      })
      .catch((error: unknown) =>
        this.logger.warn({ err: error }, 'Состояние канала YouTube не записано'),
      );
    this.logger.warn('Доступ к чату YouTube отозван, канал требует переподключения');
  }

  private closeCall(session: Session): void {
    const call = session.call;
    // Сначала отвязываем: отмена приходит в обработчик ошибкой CANCELLED, и он
    // не должен принять её за обрыв и переподключаться.
    session.call = null;
    call?.cancel();
  }

  private grpcClient(): YouTubeChatClient {
    if (!this.client) {
      const { chatGrpc, chatGrpcInsecure } = this.config.youtubeEndpoints;
      this.client = createYouTubeChatClient(chatGrpc, chatGrpcInsecure);
    }
    return this.client;
  }
}
