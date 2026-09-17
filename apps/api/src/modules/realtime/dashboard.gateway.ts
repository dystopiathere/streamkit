import { Inject, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { type OnGatewayConnection, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { SOCKET_EVENTS, dashboardRoom } from '@streamkit/contracts';
import type { Server, Socket } from 'socket.io';
import type { Redis } from 'ioredis';
import { verifyAccessToken } from '../../common/auth/access-token';
import { RealtimeBus, type BusMessage } from '../../common/bus/realtime-bus.service';
import { REDIS_CLIENT } from '../../common/redis/redis.module';

/**
 * Живая лента событий в личном кабинете.
 *
 * В отличие от overlay здесь полноценная аутентификация access-токеном: комната
 * пользователя содержит его донаты с именами и суммами, и публичной ссылки на
 * неё существовать не должно.
 */
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

    try {
      // Админский токен ленту дашборда не открывает, заблокированный — тоже.
      const payload = await verifyAccessToken(this.jwt, this.redis, token, 'dashboard');
      await client.join(dashboardRoom(payload.sub));
    } catch {
      client.disconnect(true);
    }
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
