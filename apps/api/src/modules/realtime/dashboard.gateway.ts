import { Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { type OnGatewayConnection, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { SOCKET_EVENTS, dashboardRoom } from '@streamkit/contracts';
import type { Server, Socket } from 'socket.io';
import type { AccessTokenPayload } from '../../common/auth/access-token.guard';
import { RealtimeBus, type BusMessage } from '../../common/bus/realtime-bus.service';

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
      const payload = await this.jwt.verifyAsync<AccessTokenPayload>(token);
      await client.join(dashboardRoom(payload.sub));
    } catch {
      client.disconnect(true);
    }
  }

  private async handleBusMessage(message: BusMessage): Promise<void> {
    if (message.kind !== 'alert') return;
    try {
      this.server.local
        .to(dashboardRoom(message.userId))
        .emit(SOCKET_EVENTS.eventCreated, { event: message.event });
    } catch (error) {
      this.logger.error({ err: error }, 'Не удалось доставить событие в дашборд');
    }
  }
}
