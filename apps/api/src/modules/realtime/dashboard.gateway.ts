import { Inject, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  ConnectedSocket,
  type OnGatewayConnection,
  type OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import {
  type ChatChannelRef,
  SOCKET_EVENTS,
  type StreamWatchAck,
  chatRoom,
  dashboardRoom,
} from '@streamkit/contracts';
import type { Server, Socket } from 'socket.io';
import type { Redis } from 'ioredis';
import { verifyAccessToken } from '../../common/auth/access-token';
import { RealtimeBus, type BusMessage } from '../../common/bus/realtime-bus.service';
import { PresenceService } from '../../common/redis/presence.service';
import { REDIS_CLIENT } from '../../common/redis/redis.module';
import { StreamService } from '../stream/stream.service';

/** Что шлюз держит на сокете: пользователь, когда (и если) токен проверен. */
interface SocketData {
  authenticated?: Promise<string | null>;
  /** Разрыв в момент истечения токена — см. `handleConnection`. */
  expiry?: NodeJS.Timeout;
}

/**
 * Живая лента событий в личном кабинете.
 *
 * В отличие от overlay здесь полноценная аутентификация access-токеном: комната
 * пользователя содержит его донаты с именами и суммами, и публичной ссылки на
 * неё существовать не должно.
 */
@WebSocketGateway({ namespace: '/dashboard', cors: { origin: true, credentials: true } })
export class DashboardGateway
  implements OnGatewayConnection, OnGatewayDisconnect, OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(DashboardGateway.name);
  private unsubscribe?: () => Promise<void>;

  @WebSocketServer()
  private readonly server!: Server;

  constructor(
    private readonly jwt: JwtService,
    private readonly bus: RealtimeBus,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly stream: StreamService,
    private readonly presence: PresenceService,
  ) {}

  async onModuleInit(): Promise<void> {
    this.unsubscribe = await this.bus.subscribe((message) => {
      void this.handleBusMessage(message);
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.unsubscribe?.();
  }

  async handleConnection(client: Socket): Promise<void> {
    const token = (client.handshake.auth as { token?: unknown } | undefined)?.token;
    if (typeof token !== 'string' || token.length === 0) {
      client.disconnect(true);
      return;
    }

    // Проверка токена идёт асинхронно, а клиент получает «connect» раньше, чем
    // она закончится, — и окно эфира тут же спрашивает свой чат. Без этого
    // обещания подписка видела сокет без пользователя, отвечала «чата нет», и
    // чат появлялся только на следующем повторе, через полминуты.
    const data = client.data as SocketData;
    data.authenticated = (async () => {
      try {
        // Админский токен ленту дашборда не открывает, заблокированный — тоже.
        const payload = await verifyAccessToken(this.jwt, this.redis, token, 'dashboard');
        await client.join(dashboardRoom(payload.sub));
        // Токен проверяется при подключении, а сокет живёт часами — окно эфира
        // открыто весь стрим. Без разрыва соединение переживало бы выход,
        // смену пароля и отзыв сессии: утёкший на пятнадцать минут токен давал
        // бы ленту донатов с именами навсегда. Клиент обновляет токен и
        // подключается заново (`connectDashboardSocket` в вебе).
        if (payload.exp) {
          data.expiry = setTimeout(() => client.disconnect(true), payload.exp * 1000 - Date.now());
          data.expiry.unref();
        }
        return payload.sub;
      } catch {
        client.disconnect(true);
        return null;
      }
    })();
    await data.authenticated;
  }

  handleDisconnect(client: Socket): void {
    clearTimeout((client.data as SocketData).expiry);
  }

  /**
   * Окно эфира открыто: отметка для воркера, что чат канала нужен, и комната
   * этого канала для сокета.
   *
   * Канал выбирает сервер по аккаунту — клиент его не называет, иначе любой
   * вошедший читал бы через нас любой чат. Окно повторяет событие каждые 30
   * секунд: отметка живёт 90, и закрытое окно отпускает чат само, без
   * отдельного «я ушло», которое при обрыве связи никто бы не прислал. Смена
   * канала (подключили площадку) подхватывается на следующем повторе.
   *
   * Отметку «чат нужен» получают только каналы, которые можно читать: YouTube
   * с отозванным доступом окно покажет с просьбой переподключить, но воркер
   * не будет стучаться в него за квоту.
   */
  @SubscribeMessage(SOCKET_EVENTS.streamWatch)
  async watchStream(@ConnectedSocket() client: Socket): Promise<StreamWatchAck> {
    const userId = await (client.data as SocketData).authenticated;
    if (!userId) return { chats: [] };

    const chats = await this.stream.chatChannels(userId);
    const rooms = new Set(chats.map((chat) => chatRoom(chat.platform, chat.channel)));
    for (const joined of client.rooms) {
      if (joined.startsWith('chat:') && !rooms.has(joined)) await client.leave(joined);
    }
    for (const room of rooms) await client.join(room);
    await this.presence.watchChats(
      chats
        .filter((chat) => chat.state !== 'auth')
        .map(({ platform, channel }) => ({ platform, channel }) as ChatChannelRef),
    );
    return { chats };
  }

  private async handleBusMessage(message: BusMessage): Promise<void> {
    try {
      switch (message.kind) {
        case 'alert':
          this.server.local
            .to(dashboardRoom(message.userId))
            .emit(SOCKET_EVENTS.eventCreated, { event: message.event });
          break;

        case 'analytics':
          this.server.local.to(dashboardRoom(message.userId)).emit(SOCKET_EVENTS.analyticsUpdated, {
            channelId: message.channelId,
            stats: message.stats,
          });
          break;

        // Чат — только окнам эфира, подписанным на канал. Сообщения не
        // сохраняются нигде: не было открытого окна — сообщение не пришло.
        case 'chat':
          this.server.local
            .to(chatRoom(message.message.platform, message.message.channel))
            .emit(SOCKET_EVENTS.chatMessage, message.message);
          break;

        case 'user-suspended':
          this.server.local.in(dashboardRoom(message.userId)).disconnectSockets(true);
          break;

        // Остальные сообщения шины адресованы оверлею, а не дашборду.
        default:
          break;
      }
    } catch (error) {
      this.logger.error(
        { err: error, kind: message.kind },
        'Не удалось доставить событие в дашборд',
      );
    }
  }
}
