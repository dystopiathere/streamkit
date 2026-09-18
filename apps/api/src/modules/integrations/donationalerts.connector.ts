import { Injectable, Logger } from '@nestjs/common';
import {
  CURRENCIES,
  type Currency,
  type IncomingAlertEvent,
  parseMajorToMinor,
} from '@streamkit/contracts';
import { PlatformAuthError } from '../../common/http/platform-errors';
import { DonationAlertsApi } from './donationalerts.api';
import type { ConnectorContext, DonationConnector } from './donation-provider';

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

/**
 * Коннектор DonationAlerts: донаты в реальном времени через их Centrifugo.
 *
 * Порядок по документации DonationAlerts API:
 *  1. профиль `GET /api/v1/user/oauth` — в нём `socket_connection_token`;
 *  2. сокет `wss://centrifugo.donationalerts.com/connection/websocket`,
 *     подключение с этим токеном — в ответ идентификатор клиента;
 *  3. токен приватного канала `$alerts:donation_<id>` —
 *     `POST /api/v1/centrifuge/subscribe` с идентификатором клиента;
 *  4. подписка на канал, дальше донаты приходят сами.
 *
 * Проверен против поддельного сервера по этой же документации; на живом
 * аккаунте — после регистрации приложения DonationAlerts.
 */
@Injectable()
export class DonationAlertsConnector implements DonationConnector {
  readonly provider = 'donationalerts' as const;
  private readonly logger = new Logger(DonationAlertsConnector.name);

  constructor(private readonly api: DonationAlertsApi) {}

  async connect(context: ConnectorContext): Promise<() => Promise<void>> {
    const session = new DonationAlertsSession(this.api, context, this.logger);
    session.start();
    return () => session.stop();
  }
}

/** Одно долгоживущее соединение одного стримера, с переподключением. */
class DonationAlertsSession {
  private socket: WebSocket | null = null;
  private stopped = false;
  private attempt = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private pingTimer: NodeJS.Timeout | null = null;
  private handshakeTimer: NodeJS.Timeout | null = null;
  private stableTimer: NodeJS.Timeout | null = null;
  private nextId = SUBSCRIBE_ID + 1;

  constructor(
    private readonly api: DonationAlertsApi,
    private readonly context: ConnectorContext,
    private readonly logger: Logger,
  ) {}

  start(): void {
    void this.open();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.clearTimers();
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.socket?.close();
    this.socket = null;
  }

  private async open(): Promise<void> {
    if (this.stopped) return;

    let accessToken: string;
    let profile: Awaited<ReturnType<DonationAlertsApi['fetchProfile']>>;
    try {
      accessToken = await this.context.getAccessToken();
      profile = await this.api.fetchProfile(accessToken);
    } catch (error) {
      if (error instanceof PlatformAuthError) {
        // Доступ отозван или не продлевается: повторять бессмысленно.
        this.stopped = true;
        this.context.onAccessLost('Доступ к DonationAlerts потерян — подключите аккаунт заново');
        return;
      }
      this.context.reportFailure(`профиль DonationAlerts недоступен: ${describe(error)}`);
      this.scheduleReconnect();
      return;
    }
    if (this.stopped) return;

    const channel = `$alerts:donation_${profile.id}`;
    const socket = new WebSocket(this.api.socketUrl);
    this.socket = socket;

    socket.addEventListener('open', () => {
      this.send({ id: CONNECT_ID, params: { token: profile.socketConnectionToken } });
      this.handshakeTimer = setTimeout(() => {
        this.context.reportFailure('сокет DonationAlerts не ответил на подключение');
        socket.close();
      }, HANDSHAKE_TIMEOUT_MS);
    });

    socket.addEventListener('message', (message) => {
      // Centrifugo может прислать несколько ответов одним кадром — по строке на ответ.
      for (const line of String(message.data).split('\n')) {
        if (line.trim().length === 0) continue;
        void this.handle(line, accessToken, channel, socket);
      }
    });

    socket.addEventListener('close', () => {
      if (this.socket !== socket) return;
      this.socket = null;
      this.clearTimers();
      if (!this.stopped) {
        this.context.reportFailure('сокет DonationAlerts закрылся, переподключаемся');
        this.scheduleReconnect();
      }
    });

    // Подробности придут в close: обработчик ошибки WebSocket ничего не
    // сообщает, а переподключение живёт в одном месте.
    socket.addEventListener('error', () => undefined);
  }

  private async handle(
    line: string,
    accessToken: string,
    channel: string,
    socket: WebSocket,
  ): Promise<void> {
    let reply: CentrifugoReply;
    try {
      reply = JSON.parse(line) as CentrifugoReply;
    } catch {
      return;
    }

    if (reply.error) {
      this.context.reportFailure(`Centrifugo ответил ошибкой ${reply.error.code ?? ''}`);
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
        const token = await this.api.subscribeToken(accessToken, client, channel);
        this.send({ id: SUBSCRIBE_ID, method: METHOD_SUBSCRIBE, params: { channel, token } });
      } catch (error) {
        if (error instanceof PlatformAuthError) {
          this.stopped = true;
          this.context.onAccessLost('Доступ к DonationAlerts потерян — подключите аккаунт заново');
        } else {
          this.context.reportFailure(`подписка на донаты не выдана: ${describe(error)}`);
        }
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
      this.logger.log({ userId: this.context.userId }, 'Подписка на донаты DonationAlerts');
      return;
    }

    // Публикация в канал: у неё нет id, донат лежит в `result.data.data`.
    const push = reply.result;
    if (reply.id === undefined && push?.channel === channel && push.data?.data) {
      const event = normalizeDonation(push.data.data, this.context.userId);
      await this.context
        .emit(event)
        .catch((error: unknown) =>
          this.logger.error({ err: error, userId: this.context.userId }, 'Донат не принят'),
        );
    }
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
    data?: { data?: DonationAlertsMessage };
  };
}

/** Донат в том виде, в каком его присылает DonationAlerts. */
export interface DonationAlertsMessage {
  id: number | string;
  username?: string | null;
  message?: string | null;
  /** `text` или `audio`: у голосового доната в `message` не текст. */
  message_type?: string | null;
  amount: number | string;
  currency: string;
}

/**
 * Донат DonationAlerts → наше событие.
 *
 * Сумма приходит дробным числом (`100.5`) и переводится в копейки через
 * строку, без умножения в плавающей точке: деньги во float запрещены на любом
 * этапе. Валюта, которой у нас нет, не превращается в рубли — сумма тогда
 * неизвестна, а сам донат всё равно показывается: иначе десять долларов
 * засчитались бы в цель как десять рублей.
 */
export function normalizeDonation(raw: DonationAlertsMessage, userId: string): IncomingAlertEvent {
  const currency = raw.currency?.toUpperCase();
  const amountMinor = parseMajorToMinor(String(raw.amount));
  const knownCurrency = (CURRENCIES as readonly string[]).includes(currency);

  return {
    userId,
    type: 'donation',
    provider: 'donationalerts',
    externalId: String(raw.id),
    username: (raw.username?.trim() || 'Аноним').slice(0, 64),
    message: raw.message_type === 'audio' ? '' : (raw.message ?? '').slice(0, 500),
    amount:
      amountMinor !== null && amountMinor >= 0 && knownCurrency
        ? { amountMinor, currency: currency as Currency }
        : null,
    isTest: false,
  };
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
