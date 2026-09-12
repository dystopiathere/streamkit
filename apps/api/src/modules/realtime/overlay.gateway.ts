import { Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { type OnGatewayConnection, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import {
  SOCKET_EVENTS,
  type ConfigUpdatedMessage,
  type OverlayBootstrap,
  overlayRoom,
  shouldShowAlert,
} from '@streamkit/contracts';
import type { Server, Socket } from 'socket.io';
import { RealtimeBus, type BusMessage } from '../../common/bus/realtime-bus.service';
import { WidgetStateService } from '../widgets/widget-state.service';
import { WidgetsService } from '../widgets/widgets.service';

/** Комната всех сокетов одного виджета — по ней рассылается смена конфига. */
function widgetRoom(widgetId: string): string {
  return `widget:${widgetId}`;
}

/**
 * Сокет-шлюз для браузер-сорса OBS.
 *
 * Аутентификация — по overlay-токену из строки подключения. Никаких cookie и
 * никакого access-токена: страница открыта публично по ссылке, и любая попытка
 * привязать её к сессии пользователя означала бы, что ссылку нельзя никому
 * показать даже случайно.
 *
 * CORS для этого namespace не ограничивается origin'ом: OBS открывает страницу
 * как `null`-origin. Единственный секрет здесь — сам токен.
 */
@WebSocketGateway({ namespace: '/overlay', cors: { origin: true, credentials: false } })
export class OverlayGateway implements OnGatewayConnection, OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OverlayGateway.name);
  private unsubscribe?: () => Promise<void>;

  @WebSocketServer()
  private readonly server!: Server;

  constructor(
    private readonly widgets: WidgetsService,
    private readonly widgetState: WidgetStateService,
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
    const token = extractToken(client);
    if (!token) {
      client.disconnect(true);
      return;
    }

    const resolved = await this.widgets.resolveOverlayToken(token);
    if (!resolved) {
      // Не уточняем, отозван токен или не существовал: подбор ссылок не должен
      // получать обратную связь.
      client.disconnect(true);
      return;
    }

    await client.join(overlayRoom(resolved.tokenId));
    await client.join(widgetRoom(resolved.widgetId));

    const bootstrap: OverlayBootstrap = {
      widgetId: resolved.widgetId,
      name: resolved.name,
      isEnabled: resolved.isEnabled,
      // Состояние в первом же сообщении: цель, открытая в OBS, обязана
      // показать собранную сумму сразу, а не через первый донат.
      state: await this.widgetState.computeById(resolved.widgetId),
      ...resolved.widget,
    };
    client.emit(SOCKET_EVENTS.bootstrap, bootstrap);

    await this.widgets.touchOverlayToken(resolved.tokenId);
    this.logger.debug({ widgetId: resolved.widgetId }, 'Оверлей подключился');
  }

  /**
   * Событие из шины раскладывается по активным виджетам пользователя.
   *
   * Фильтр `shouldShowAlert` применяется здесь, а не в overlay: незачем гонять по
   * сети события, которые виджет всё равно не покажет, и незачем сообщать
   * публичной странице о донатах ниже её порога.
   */
  private async handleBusMessage(message: BusMessage): Promise<void> {
    try {
      switch (message.kind) {
        case 'alert': {
          const targets = await this.widgets.findDispatchTargets(message.userId);
          for (const target of targets) {
            if (!shouldShowAlert(message.event, target.config)) continue;
            for (const tokenId of target.tokenIds) {
              this.server.local
                .to(overlayRoom(tokenId))
                .emit(SOCKET_EVENTS.alert, { event: message.event });
            }
          }
          break;
        }

        case 'widget-config': {
          // Ни имени, ни состояния: это сообщение отвечает только за настройки.
          // Состояние приезжает своим сообщением следом — сервис виджетов
          // публикует его сразу после конфига.
          const payload: ConfigUpdatedMessage = {
            widgetId: message.widgetId,
            isEnabled: message.isEnabled,
            type: message.type,
            config: message.config,
          } as ConfigUpdatedMessage;
          this.server.local
            .to(widgetRoom(message.widgetId))
            .emit(SOCKET_EVENTS.configUpdated, payload);
          break;
        }

        case 'widget-state': {
          this.server.local
            .to(widgetRoom(message.widgetId))
            .emit(SOCKET_EVENTS.widgetState, { widgetId: message.widgetId, state: message.state });
          break;
        }

        case 'overlay-revoked': {
          const room = overlayRoom(message.tokenId);
          this.server.local.to(room).emit(SOCKET_EVENTS.revoked, { reason: message.reason });
          // Сообщение отправляем до разрыва: иначе оверлей не поймёт, почему упал,
          // и начнёт переподключаться по мёртвому токену.
          const sockets = await this.server.local.in(room).fetchSockets();
          for (const socket of sockets) {
            socket.disconnect(true);
          }
          break;
        }
      }
    } catch (error) {
      this.logger.error({ err: error, kind: message.kind }, 'Ошибка обработки события шины');
    }
  }
}

/**
 * Токен принимается и в `auth`, и в query.
 *
 * `auth` — правильный способ (не попадает в логи прокси), query — вынужденный:
 * браузер-сорс OBS настраивается вставкой URL, и задать заголовки там негде.
 */
function extractToken(client: Socket): string | null {
  const fromAuth = (client.handshake.auth as { token?: unknown } | undefined)?.token;
  if (typeof fromAuth === 'string' && fromAuth.length > 0) return fromAuth;

  const fromQuery = client.handshake.query.token;
  if (typeof fromQuery === 'string' && fromQuery.length > 0) return fromQuery;

  return null;
}
