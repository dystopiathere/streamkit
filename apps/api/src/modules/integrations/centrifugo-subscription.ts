import type { Logger } from '@nestjs/common';
import { PlatformAuthError } from '../../common/http/platform-errors';

/** Пауза перед переподключением: от секунды до минуты, с джиттером. */
const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS = 60_000;
/** Соединение, продержавшееся столько, считается здоровым — пауза сбрасывается. */
const STABLE_CONNECTION_MS = 60_000;
/**
 * Пинг клиента. Centrifugo закрывает молчащее соединение, а NAT и прокси по
 * дороге режут простаивающий TCP без единого сообщения — снаружи это выглядит
 * как «донаты перестали приходить», хотя сокет формально открыт.
 */
const PING_INTERVAL_MS = 25_000;
/** Ответ на подключение и подписку дольше этого — соединение считаем мёртвым. */
const HANDSHAKE_TIMEOUT_MS = 15_000;

/** Методы протокола Centrifugo (JSON): 0 — connect, 1 — subscribe, 7 — ping. */
const METHOD_SUBSCRIBE = 1;
const METHOD_PING = 7;
const CONNECT_ID = 1;
const SUBSCRIBE_ID = 2;

/** Куда и с чем подключаться — на каждое (пере)подключение заново. */
export interface CentrifugoTarget {
  url: string;
  /** Токен подключения к сокету. */
  connectToken: string;
  /** Приватный канал (`$…`), на который подписываемся. */
  channel: string;
  /**
   * Токен подписки на канал под идентификатор клиента из ответа на подключение.
   * Бросает `PlatformAuthError`, когда сервис доступ не даёт.
   */
  subscribeToken: (client: string) => Promise<string>;
}

export interface CentrifugoSubscriptionOptions {
  /** Название сервиса для журнала. */
  service: string;
  userId: string;
  logger: Logger;
  /** Бросает `PlatformAuthError`, когда доступ мёртв: переподключения не будет. */
  resolve: () => Promise<CentrifugoTarget>;
  /** Полезная нагрузка публикации в канал (`result.data.data`). */
  onPublication: (data: unknown) => Promise<void>;
  /** Подписка подтверждена — с этого момента публикации идут. */
  onSubscribed?: () => void;
  /** Соединение потеряно; переподключение уже запланировано. */
  onDown?: () => void;
  onAccessLost: () => void;
  reportFailure: (reason: string) => void;
}

/**
 * Подписка на один приватный канал Centrifugo с переподключением.
 *
 * Общая для сервисов, которые доставляют донаты через Centrifugo
 * (DonationAlerts, DonatePay): различаются они только тем, откуда берутся
 * токены и что лежит в публикации.
 */
export class CentrifugoSubscription {
  private socket: WebSocket | null = null;
  private stopped = false;
  private attempt = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private pingTimer: NodeJS.Timeout | null = null;
  private handshakeTimer: NodeJS.Timeout | null = null;
  private stableTimer: NodeJS.Timeout | null = null;
  private nextId = SUBSCRIBE_ID + 1;

  constructor(private readonly options: CentrifugoSubscriptionOptions) {}

  start(): void {
    void this.open();
  }

  stop(): void {
    this.stopped = true;
    this.clearTimers();
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.socket?.close();
    this.socket = null;
  }

  private async open(): Promise<void> {
    if (this.stopped) return;
    const { service } = this.options;

    let target: CentrifugoTarget;
    try {
      target = await this.options.resolve();
    } catch (error) {
      if (error instanceof PlatformAuthError) {
        // Доступ отозван или не продлевается: повторять бессмысленно.
        this.loseAccess();
        return;
      }
      this.options.reportFailure(
        `подключение к сокету ${service} не подготовлено: ${describe(error)}`,
      );
      this.scheduleReconnect();
      return;
    }
    if (this.stopped) return;

    const socket = new WebSocket(target.url);
    this.socket = socket;

    socket.addEventListener('open', () => {
      this.send({ id: CONNECT_ID, params: { token: target.connectToken } });
      this.handshakeTimer = setTimeout(() => {
        this.options.reportFailure(`сокет ${service} не ответил на подключение`);
        socket.close();
      }, HANDSHAKE_TIMEOUT_MS);
    });

    socket.addEventListener('message', (message) => {
      // Centrifugo может прислать несколько ответов одним кадром — по строке на ответ.
      for (const line of String(message.data).split('\n')) {
        if (line.trim().length === 0) continue;
        void this.handle(line, target, socket);
      }
    });

    socket.addEventListener('close', () => {
      if (this.socket !== socket) return;
      this.socket = null;
      this.clearTimers();
      if (!this.stopped) {
        this.options.reportFailure(`сокет ${service} закрылся, переподключаемся`);
        this.options.onDown?.();
        this.scheduleReconnect();
      }
    });

    // Подробности придут в close: обработчик ошибки WebSocket ничего не
    // сообщает, а переподключение живёт в одном месте.
    socket.addEventListener('error', () => undefined);
  }

  private async handle(line: string, target: CentrifugoTarget, socket: WebSocket): Promise<void> {
    let reply: CentrifugoReply;
    try {
      reply = JSON.parse(line) as CentrifugoReply;
    } catch {
      return;
    }

    if (reply.error) {
      this.options.reportFailure(`Centrifugo ответил ошибкой ${reply.error.code ?? ''}`);
      socket.close();
      return;
    }

    if (reply.id === CONNECT_ID) {
      const client = reply.result?.client;
      if (!client) {
        socket.close();
        return;
      }
      try {
        const token = await target.subscribeToken(client);
        this.send({
          id: SUBSCRIBE_ID,
          method: METHOD_SUBSCRIBE,
          params: { channel: target.channel, token },
        });
      } catch (error) {
        if (error instanceof PlatformAuthError) this.loseAccess();
        else this.options.reportFailure(`подписка на донаты не выдана: ${describe(error)}`);
        socket.close();
      }
      return;
    }

    if (reply.id === SUBSCRIBE_ID) {
      if (this.handshakeTimer) clearTimeout(this.handshakeTimer);
      this.handshakeTimer = null;
      this.pingTimer = setInterval(
        () => this.send({ id: this.nextId++, method: METHOD_PING }),
        PING_INTERVAL_MS,
      );
      // Пауза сбрасывается не сразу: соединение, которое падает через секунду
      // после подписки, иначе переподключалось бы без паузы по кругу.
      this.stableTimer = setTimeout(() => (this.attempt = 0), STABLE_CONNECTION_MS);
      this.options.logger.log(
        { userId: this.options.userId },
        `Подписка на донаты ${this.options.service}`,
      );
      this.options.onSubscribed?.();
      return;
    }

    // Публикация в канал: у неё нет id, полезная нагрузка — в `result.data.data`.
    const push = reply.result;
    if (reply.id === undefined && push?.channel === target.channel && push.data?.data) {
      await this.options
        .onPublication(push.data.data)
        .catch((error: unknown) =>
          this.options.logger.error(
            { err: error, userId: this.options.userId },
            `Публикация ${this.options.service} не обработана`,
          ),
        );
    }
  }

  private loseAccess(): void {
    this.stopped = true;
    this.options.onAccessLost();
  }

  private send(frame: Record<string, unknown>): void {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(frame));
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer) return;
    this.attempt += 1;
    const base = Math.min(RECONNECT_BASE_MS * 2 ** (this.attempt - 1), RECONNECT_MAX_MS);
    const delay = Math.round(base * (0.5 + Math.random() / 2));
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.open();
    }, delay);
  }

  private clearTimers(): void {
    for (const timer of [this.pingTimer, this.handshakeTimer, this.stableTimer]) {
      if (timer) clearTimeout(timer);
    }
    this.pingTimer = null;
    this.handshakeTimer = null;
    this.stableTimer = null;
  }
}

interface CentrifugoReply {
  id?: number;
  error?: { code?: number; message?: string };
  result?: {
    client?: string;
    channel?: string;
    data?: { data?: unknown };
  };
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
