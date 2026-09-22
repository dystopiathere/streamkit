import { Injectable, Logger } from '@nestjs/common';
import type { IncomingAlertEvent } from '@streamkit/contracts';
import { PlatformAuthError, PlatformError } from '../../common/http/platform-errors';
import { AppConfig } from '../../config/app-config.service';
import type { ConnectorContext, DonationConnector } from './donation-provider';
import { TwitchProvider } from './twitch.provider';

/** Пауза перед переподключением: от секунды до минуты, с джиттером. */
const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS = 60_000;
/** Соединение, продержавшееся столько, считается здоровым — пауза сбрасывается. */
const STABLE_CONNECTION_MS = 60_000;
/**
 * Запас к сроку keepalive из приветствия. Twitch шлёт keepalive, когда событий
 * нет; тишина дольше срока значит, что соединение умерло, даже если TCP об этом
 * ещё не знает.
 */
const KEEPALIVE_MARGIN_MS = 5_000;

/** Имя вместо скрытого автора: анонимные биты и подарки. */
const ANONYMOUS = 'Аноним';

/**
 * На что подписываемся. Права — в `TWITCH_SCOPES`: фолловеры и подписки были
 * нужны ещё аналитике, биты и баллы добавились ради оповещений. Рейду права не
 * нужны.
 *
 * `channel.subscribe` приходит и на каждую подарочную подписку — отдельно на
 * каждого получателя. Такие пропускаем: подарок показывается одним алертом
 * дарителя из `channel.subscription.gift`, а не пятьюдесятью подряд.
 */
function subscriptionsFor(
  broadcasterId: string,
): Array<{ type: string; version: string; condition: Record<string, string> }> {
  const broadcaster = { broadcaster_user_id: broadcasterId };
  return [
    // Начало и конец эфира. Прав не требуют вовсе — это публичные события
    // канала, — и алертами не становятся: они нужны сбору метрик, чтобы окно
    // эфира не ждало следующего такта опроса (до пятнадцати минут вне эфира).
    { type: 'stream.online', version: '1', condition: broadcaster },
    { type: 'stream.offline', version: '1', condition: broadcaster },
    {
      type: 'channel.follow',
      version: '2',
      condition: { ...broadcaster, moderator_user_id: broadcasterId },
    },
    { type: 'channel.subscribe', version: '1', condition: broadcaster },
    { type: 'channel.subscription.gift', version: '1', condition: broadcaster },
    { type: 'channel.subscription.message', version: '1', condition: broadcaster },
    { type: 'channel.cheer', version: '1', condition: broadcaster },
    { type: 'channel.raid', version: '1', condition: { to_broadcaster_user_id: broadcasterId } },
    {
      type: 'channel.channel_points_custom_reward_redemption.add',
      version: '1',
      condition: broadcaster,
    },
  ];
}

/** Сообщение сокета EventSub — только то, что читаем. */
export interface EventSubMessage {
  metadata: {
    message_id: string;
    message_type: string;
    message_timestamp?: string;
    subscription_type?: string;
  };
  payload: {
    session?: {
      id: string;
      keepalive_timeout_seconds?: number | null;
      reconnect_url?: string | null;
    };
    subscription?: { type: string; status: string };
    event?: Record<string, unknown>;
  };
}

/**
 * Уведомление EventSub → наше событие.
 *
 * Ключ дедупликации — `message_id`: Twitch повторяет доставку с тем же
 * идентификатором, а два настоящих события его не делят. Время — по часам
 * Twitch: уведомление могло задержаться.
 *
 * @returns null — событие не для алерта (подарок получателю, незнакомый тип).
 */
export function normalizeEventSubNotification(
  message: EventSubMessage,
  userId: string,
): IncomingAlertEvent | null {
  const event = message.payload.event ?? {};
  const text = (value: unknown): string => (typeof value === 'string' ? value : '');
  const count = (value: unknown): number | null =>
    typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;
  const author = (anonymous: unknown, name: unknown): string =>
    anonymous === true ? ANONYMOUS : text(name).trim() || ANONYMOUS;

  const base = {
    userId,
    provider: 'twitch' as const,
    externalId: message.metadata.message_id,
    amount: null,
    // Голосовых донатов у Twitch нет: записи приходят только от донат-сервисов.
    audioUrl: null,
    isTest: false,
    occurredAt: message.metadata.message_timestamp,
  };
  const build = (
    type: IncomingAlertEvent['type'],
    username: string,
    extra: { message?: string; count?: number | null } = {},
  ): IncomingAlertEvent => ({
    ...base,
    type,
    username: username.slice(0, 64),
    message: (extra.message ?? '').slice(0, 500),
    count: extra.count ?? null,
  });

  switch (message.metadata.subscription_type) {
    case 'channel.follow':
      return build('follow', author(false, event.user_name));

    case 'channel.subscribe':
      return event.is_gift === true ? null : build('subscription', author(false, event.user_name));

    case 'channel.subscription.gift':
      return build('gift', author(event.is_anonymous, event.user_name), {
        count: count(event.total),
      });

    case 'channel.subscription.message':
      return build('resubscription', author(false, event.user_name), {
        message: text((event.message as { text?: unknown } | undefined)?.text),
        count: count(event.cumulative_months),
      });

    case 'channel.cheer':
      return build('cheer', author(event.is_anonymous, event.user_name), {
        message: text(event.message),
        count: count(event.bits),
      });

    case 'channel.raid':
      return build('raid', author(false, event.from_broadcaster_user_name), {
        count: count(event.viewers),
      });

    case 'channel.channel_points_custom_reward_redemption.add': {
      // Название награды — в тексте: без него алерт «взял награду» не говорит,
      // какую. Ввод зрителя, если награда его просит, — после двоеточия.
      const reward = text((event.reward as { title?: unknown } | undefined)?.title);
      const input = text(event.user_input).trim();
      return build('reward', author(false, event.user_name), {
        message: input ? `${reward}: ${input}` : reward,
      });
    }

    default:
      return null;
  }
}

/**
 * События канала Twitch — фолловеры, подписки, подарки, биты, рейды, баллы —
 * через EventSub поверх WebSocket.
 *
 * Та же форма, что у DonationAlerts: одно соединение на стримера, живёт в
 * воркере, переподключается само. WebSocket, а не вебхуки: вебхукам нужен
 * публичный адрес с подписью на каждый запрос и токен приложения, а сокет
 * работает из воркера за NAT с токеном самого стримера.
 */
@Injectable()
export class TwitchEventSubConnector implements DonationConnector {
  readonly provider = 'twitch' as const;
  private readonly logger = new Logger(TwitchEventSubConnector.name);

  constructor(
    private readonly twitch: TwitchProvider,
    private readonly config: AppConfig,
  ) {}

  async connect(context: ConnectorContext): Promise<() => Promise<void>> {
    if (!context.accountId) throw new Error('Не известен канал Twitch для EventSub');
    const session = new EventSubSession(
      this.twitch,
      this.config.twitchEndpoints.eventsub,
      context,
      context.accountId,
      this.logger,
    );
    session.start();
    return () => session.stop();
  }
}

/** Одно долгоживущее соединение одного стримера, с переподключением. */
class EventSubSession {
  private socket: WebSocket | null = null;
  private stopped = false;
  private attempt = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private keepaliveTimer: NodeJS.Timeout | null = null;
  private stableTimer: NodeJS.Timeout | null = null;
  private keepaliveMs = 0;

  constructor(
    private readonly twitch: TwitchProvider,
    private readonly url: string,
    private readonly context: ConnectorContext,
    private readonly broadcasterId: string,
    private readonly logger: Logger,
  ) {}

  start(): void {
    this.open(this.url, false);
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.clearTimers();
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.socket?.close();
    this.socket = null;
  }

  /**
   * @param migrating — переезд по `session_reconnect`: Twitch переносит
   *   подписки на новый сокет сам, а старый живёт, пока новый не поздоровается.
   *   Иначе события этих секунд пропали бы.
   */
  private open(url: string, migrating: boolean): void {
    if (this.stopped) return;
    const socket = new WebSocket(url);
    if (!migrating) this.socket = socket;

    socket.addEventListener('message', (message) => {
      void this.handle(socket, String(message.data), migrating).catch((error: unknown) =>
        this.logger.error(
          { err: error, userId: this.context.userId },
          'Сообщение EventSub не разобрано',
        ),
      );
    });

    socket.addEventListener('close', () => {
      // Закрылся не текущий сокет — старый после переезда: так и задумано.
      if (socket !== this.socket) return;
      this.socket = null;
      this.clearTimers();
      if (!this.stopped) {
        this.context.reportFailure('сокет EventSub закрылся, переподключаемся');
        this.scheduleReconnect();
      }
    });

    // Подробности придут в close: переподключение живёт в одном месте.
    socket.addEventListener('error', () => undefined);
  }

  private async handle(socket: WebSocket, raw: string, migrating: boolean): Promise<void> {
    let message: EventSubMessage;
    try {
      message = JSON.parse(raw) as EventSubMessage;
    } catch {
      return;
    }

    switch (message.metadata?.message_type) {
      case 'session_welcome': {
        if (migrating) {
          const previous = this.socket;
          this.socket = socket;
          previous?.close();
        }
        this.keepaliveMs =
          (message.payload.session?.keepalive_timeout_seconds ?? 10) * 1000 + KEEPALIVE_MARGIN_MS;
        this.touch(socket);
        if (!migrating && message.payload.session?.id) {
          await this.subscribe(message.payload.session.id, socket);
        }
        return;
      }

      case 'session_keepalive':
        this.touch(socket);
        return;

      case 'notification': {
        this.touch(socket);
        // Эфир начался или закончился — это не алерт, а сигнал сбору метрик.
        // Разбирается до нормализации: у события нет ни автора, ни суммы, и в
        // ленте событий стримера ему делать нечего.
        const type = message.metadata.subscription_type;
        if (type === 'stream.online' || type === 'stream.offline') {
          this.context.onStreamState?.(type === 'stream.online');
          return;
        }
        const event = normalizeEventSubNotification(message, this.context.userId);
        if (!event) return;
        await this.context
          .emit(event)
          .catch((error: unknown) =>
            this.logger.error(
              { err: error, userId: this.context.userId },
              'Событие Twitch не принято',
            ),
          );
        return;
      }

      case 'session_reconnect': {
        const next = message.payload.session?.reconnect_url;
        if (next) this.open(next, true);
        return;
      }

      case 'revocation': {
        // Отзыв доступа стримером или удаление аккаунта — дальше пробовать
        // бессмысленно. Прочие причины (версия устарела) — сбой, не приговор.
        const status = message.payload.subscription?.status;
        if (status === 'authorization_revoked' || status === 'user_removed') {
          this.lose('Доступ к событиям Twitch отозван — подключите Twitch заново');
          socket.close();
        } else {
          this.context.reportFailure(`Twitch отменил подписку: ${status ?? 'без причины'}`);
        }
        return;
      }

      default:
        return;
    }
  }

  /**
   * Подписки на события — на каждую новую сессию: они живут, пока жив сокет.
   *
   * Отказ по одному типу не отменяет остальные. 403 значит, что у токена нет
   * нужного права — стример подключал Twitch до того, как появились оповещения
   * о битах и баллах. Остальные события при этом работают.
   */
  private async subscribe(sessionId: string, socket: WebSocket): Promise<void> {
    let accessToken: string;
    try {
      accessToken = await this.context.getAccessToken();
    } catch (error) {
      if (error instanceof PlatformAuthError) {
        this.lose('Доступ к Twitch потерян — подключите Twitch заново');
        socket.close();
        return;
      }
      throw error;
    }

    const missing: string[] = [];
    const created: string[] = [];
    for (const subscription of subscriptionsFor(this.broadcasterId)) {
      if (this.stopped || socket !== this.socket) return;
      try {
        await this.twitch.createEventSubSubscription(accessToken, {
          ...subscription,
          transport: { method: 'websocket', session_id: sessionId },
        });
        created.push(subscription.type);
      } catch (error) {
        if (error instanceof PlatformAuthError && error.status === 401) {
          this.lose('Доступ к Twitch потерян — подключите Twitch заново');
          socket.close();
          return;
        }
        if (error instanceof PlatformAuthError) {
          missing.push(subscription.type);
          continue;
        }
        // Такая подписка у сессии уже есть — цель достигнута.
        if (error instanceof PlatformError && error.status === 409) continue;
        this.context.reportFailure(`подписка ${subscription.type} не создана: ${describe(error)}`);
      }
    }

    if (missing.length > 0) {
      this.context.reportFailure(`нет прав на ${missing.join(', ')} — нужно переподключить Twitch`);
    }
    // Пауза сбрасывается не сразу: соединение, которое падает через секунду
    // после подписки, иначе переподключалось бы без паузы по кругу.
    this.stableTimer = setTimeout(() => (this.attempt = 0), STABLE_CONNECTION_MS);
    // Состав подписок — в журнал, а не только их число: «алерта о фолловере не
    // было» — самый частый вопрос, и первый ответ на него должен находиться в
    // логах воркера, а не отладкой. Типы, а не данные: имён и сообщений здесь
    // нет и быть не может.
    this.logger.log(
      { userId: this.context.userId, created, missing },
      `Подписка на события Twitch: ${created.length} из ${created.length + missing.length}`,
    );
  }

  private lose(reason: string): void {
    this.stopped = true;
    this.context.onAccessLost(reason);
  }

  /** Сообщение пришло — соединение живо; следующее обязано прийти до срока. */
  private touch(socket: WebSocket): void {
    if (this.keepaliveTimer) clearTimeout(this.keepaliveTimer);
    this.keepaliveTimer = setTimeout(() => {
      if (socket !== this.socket) return;
      this.context.reportFailure('EventSub молчит дольше срока keepalive');
      socket.close();
    }, this.keepaliveMs);
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer) return;
    this.attempt += 1;
    const base = Math.min(RECONNECT_BASE_MS * 2 ** (this.attempt - 1), RECONNECT_MAX_MS);
    const delay = Math.round(base * (0.5 + Math.random() / 2));
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.open(this.url, false);
    }, delay);
  }

  private clearTimers(): void {
    for (const timer of [this.keepaliveTimer, this.stableTimer]) {
      if (timer) clearTimeout(timer);
    }
    this.keepaliveTimer = null;
    this.stableTimer = null;
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
