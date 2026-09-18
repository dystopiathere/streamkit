import { Inject, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  ConnectedSocket,
  type OnGatewayConnection,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { SOCKET_EVENTS, type StreamWatchAck, chatRoom, dashboardRoom } from '@streamkit/contracts';
import type { Server, Socket } from 'socket.io';
import type { Redis } from 'ioredis';
import { verifyAccessToken } from '../../common/auth/access-token';
import { RealtimeBus, type BusMessage } from '../../common/bus/realtime-bus.service';
import { PresenceService } from '../../common/redis/presence.service';
import { REDIS_CLIENT } from '../../common/redis/redis.module';
import { StreamService } from '../stream/stream.service';

/**
 * Живая лента событий в личном кабинете.
 *
 * В отличие от overlay здесь полноценная аутентификация access-токеном: комната
 * пользователя содержит его донаты с именами и суммами, и публичной ссылки на
 * неё существовать не должно.
 */
/** Что шлюз держит на сокете: пользователь, когда (и если) токен проверен. */
interface SocketData {
  authenticated?: Promise<string | null>;
}

@WebSocketGateway({ namespace: '/dashboard', cors: { origin: true, credentials: true } })
export class DashboardGateway implements OnGatewayConnection, OnModuleInit, OnModuleDestroy {
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
        return payload.sub;
      } catch {
        client.disconnect(true);
        return null;
      }
    })();
    await data.authenticated;
  }

  /**
   * Окно эфира открыто: отметка для воркера, что чат канала нужен, и комната
   * этого канала для сокета.
   *
   * Канал выбирает сервер по аккаунту — клиент его не называет, иначе любой
   * вошедший читал бы через нас любой чат. Окно повторяет событие каждые 30
   * секунд: отметка живёт 90, и закрытое окно отпускает чат само, без
   * отдельного «я ушло», которое при обрыве связи никто бы не прислал. Смена
   * канала (подключили Twitch) подхватывается на следующем повторе.
   */
  @SubscribeMessage(SOCKET_EVENTS.streamWatch)
  async watchStream(@ConnectedSocket() client: Socket): Promise<StreamWatchAck> {
    const userId = await (client.data as SocketData).authenticated;
    if (!userId) return { chat: null };

    const chat = await this.stream.chatChannel(userId);
    const room = chat ? chatRoom(chat.platform, chat.channel) : null;
    for (const joined of client.rooms) {
      if (joined.startsWith('chat:') && joined !== room) await client.leave(joined);
    }
    if (chat && room) {
      await client.join(room);
      await this.presence.watchChat(chat.channel);
    }
    return { chat };
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
