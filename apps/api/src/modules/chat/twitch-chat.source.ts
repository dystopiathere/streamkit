import { Injectable, Logger } from '@nestjs/common';
import type { ChatMessage } from '@streamkit/contracts';
import { AppConfig } from '../../config/app-config.service';
import { parseIrcLine, toChatMessage } from './irc';

/**
 * Источник чата: ОДНО соединение, МНОГО каналов.
 *
 * Третья форма интеграции в проекте, и она не случайна (см. docs/adr/0009).
 * `DonationConnector` — подписка на пользователя: площадка присылает события
 * одного стримера, и соединение заводится на каждого. `PlatformProvider` —
 * опрос: спроси метрики, получи снимок, закрой соединение.
 *
 * Чат не похож ни на то, ни на другое. Единица работы здесь — КАНАЛ, а
 * соединение у всех каналов общее: анонимный IRC Twitch держит около сотни
 * каналов в одном сокете и ограничивает вход двадцатью JOIN за десять секунд.
 * Форма «соединение на стримера» дала бы полсотни сокетов к одному хосту вместо
 * одного, а поле с токеном осталось бы пустым — читать чат можно анонимно.
 */
export interface ChatSource {
  readonly platform: 'twitch';
  /** На какие каналы подписаны сейчас. */
  readonly channels: ReadonlySet<string>;
  start(sink: (message: ChatMessage) => void): Promise<void>;
  join(channel: string): Promise<void>;
  leave(channel: string): Promise<void>;
  stop(): Promise<void>;
}

const DEFAULT_IRC_URL = 'wss://irc-ws.chat.twitch.tv:443';

/** Потолок паузы между попытками переподключения. */
const MAX_RECONNECT_MS = 60_000;

/**
 * Сколько сообщений в секунду публикуем с одного канала.
 *
 * Популярный канал даёт сотни сообщений в минуту, и каждое уходит в Redis и в
 * сокет каждого открытого браузер-сорса. Виджет всё равно показывает два
 * десятка строк. Это не защита от абьюза, а отказ превращать шину в узкое место
 * ради строк, которые никто не успеет прочитать.
 */
const MAX_MESSAGES_PER_SECOND = 20;

/**
 * Пауза между JOIN.
 *
 * Twitch разрешает 20 попыток входа за 10 секунд, а лишние молча отбрасывает.
 * Раньше состав уходил одной пачкой при подключении, и двадцать первый канал не
 * подключался никогда: он уже числился вошедшим, и сверка его не повторяла.
 * 600 мс — это 17 входов за окно, с запасом на рассинхрон часов сервера.
 */
export const JOIN_INTERVAL_MS = 600;

/**
 * Чтение чата Twitch по анонимному IRC поверх WebSocket.
 *
 * Без единой зависимости: WebSocket входит в Node начиная с 22-й версии.
 */
@Injectable()
export class TwitchChatSource implements ChatSource {
  readonly platform = 'twitch' as const;

  private readonly logger = new Logger(TwitchChatSource.name);
  private socket: WebSocket | null = null;
  private sink: ((message: ChatMessage) => void) | null = null;
  /** Каналы, на которые подписаны. Состав восстанавливается при переподключении. */
  private readonly joined = new Set<string>();
  /** Каналы, JOIN которых ещё не отправлен: темп задаёт лимит Twitch. */
  private joinQueue: string[] = [];
  private joinTimer: NodeJS.Timeout | null = null;
  private stopped = true;
  private attempts = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  /** Счётчики ограничителя: канал → [начало секунды, сколько пропущено]. */
  private readonly rate = new Map<string, { second: number; count: number; dropped: number }>();

  constructor(private readonly config: AppConfig) {}

  async start(sink: (message: ChatMessage) => void): Promise<void> {
    this.sink = sink;
    this.stopped = false;
    this.connect();
  }

  async join(channel: string): Promise<void> {
    if (this.joined.has(channel)) return;
    this.joined.add(channel);
    this.enqueueJoin(channel);
  }

  async leave(channel: string): Promise<void> {
    if (!this.joined.delete(channel)) return;
    const queued = this.joinQueue.indexOf(channel);
    if (queued >= 0) {
      // JOIN ещё не уходил — и PART слать незачем.
      this.joinQueue.splice(queued, 1);
      return;
    }
    this.send(`PART #${channel}`);
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.joined.clear();
    this.resetJoinQueue();
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.socket?.close();
    this.socket = null;
  }

  /** На какие каналы подписаны сейчас. Менять состав можно только join/leave. */
  get channels(): ReadonlySet<string> {
    return this.joined;
  }

  /** Открыто ли соединение прямо сейчас — для диагностики и тестов. */
  get isConnected(): boolean {
    return this.socket?.readyState === WebSocket.OPEN;
  }

  private connect(): void {
    if (this.stopped) return;

    const socket = new WebSocket(this.config.twitchIrcUrl ?? DEFAULT_IRC_URL);
    this.socket = socket;

    // Каждый обработчик сверяет, что сокет всё ещё текущий. Закрытие живого
    // соединения ждёт ответного кадра, а при оборванной сети — таймаута TCP, и
    // close приходит, когда источник уже остановлен и запущен заново. Без
    // проверки такое запоздавшее close планировало переподключение и поднимало
    // второе соединение рядом с живым: каждое сообщение чата уходило в эфир дважды.
    const current = (): boolean => socket === this.socket;

    socket.addEventListener('open', () => {
      if (!current()) return;
      this.attempts = 0;

      // Без тегов нет ни цвета ника, ни значков, ни эмоутов, ни идентификатора
      // сообщения — то есть нет ничего, кроме голого текста.
      socket.send('CAP REQ :twitch.tv/tags');
      // Анонимный вход: ник вида justinfan<число>, пароль не нужен вовсе.
      socket.send(`NICK justinfan${Math.floor(Math.random() * 80_000) + 10_000}`);

      // Состав каналов восстанавливается ПОЛНОСТЬЮ: соединение новое, и сервер
      // о прежних подписках ничего не знает. Через очередь, а не пачкой.
      this.resetJoinQueue();
      for (const channel of this.joined) this.enqueueJoin(channel);
      this.logger.log({ channels: this.joined.size }, 'Чат Twitch подключён');
    });

    socket.addEventListener('message', (event: MessageEvent) => {
      if (!current()) return;
      const data = typeof event.data === 'string' ? event.data : String(event.data);
      // В одном кадре приезжает несколько строк, разделённых CRLF.
      for (const raw of data.split('\r\n')) this.handleLine(raw);
    });

    socket.addEventListener('close', () => {
      if (this.stopped || !current()) return;
      // Неотправленные JOIN соберутся заново из состава при следующем open.
      this.resetJoinQueue();
      this.scheduleReconnect();
    });

    socket.addEventListener('error', () => {
      // Подробности придут в close: обработчик ошибки WebSocket ничего не
      // добавляет, а необработанное событие роняет процесс.
      this.logger.warn('Ошибка соединения с чатом Twitch');
    });
  }

  private handleLine(raw: string): void {
    const line = parseIrcLine(raw);
    if (!line) return;

    switch (line.command) {
      case 'PING':
        // Ответ обязателен: без него сервер закроет соединение через несколько
        // минут, и выглядеть это будет как «чат просто перестал идти».
        this.send(`PONG :${line.params[0] ?? 'tmi.twitch.tv'}`);
        return;

      case 'RECONNECT':
        // Плановое обслуживание Twitch. Игнорировать — значит потерять чат в
        // момент, когда сервер честно предупредил.
        this.logger.log('Twitch просит переподключиться');
        this.socket?.close();
        return;

      case 'NOTICE': {
        const reason = line.tags['msg-id'];
        if (reason) this.logger.warn({ reason }, 'Twitch отказал по каналу');
        return;
      }

      case 'PRIVMSG': {
        const message = toChatMessage(line);
        if (message && this.allow(message.channel)) this.sink?.(message);
        return;
      }

      default:
        return;
    }
  }

  /** Ограничитель потока: скользящая секунда на канал. */
  private allow(channel: string): boolean {
    const second = Math.floor(Date.now() / 1000);
    const state = this.rate.get(channel);

    if (!state || state.second !== second) {
      if (state && state.dropped > 0) {
        this.logger.debug({ channel, dropped: state.dropped }, 'Поток чата подрезан');
      }
      this.rate.set(channel, { second, count: 1, dropped: 0 });
      return true;
    }

    if (state.count >= MAX_MESSAGES_PER_SECOND) {
      state.dropped += 1;
      return false;
    }
    state.count += 1;
    return true;
  }

  private scheduleReconnect(): void {
    this.attempts += 1;
    // Та же лесенка, что у опроса площадок: 1, 2, 4... до минуты.
    const delay = Math.min(2 ** (this.attempts - 1) * 1000, MAX_RECONNECT_MS);
    this.logger.warn({ delay, attempts: this.attempts }, 'Чат Twitch отключился, переподключаемся');
    this.reconnectTimer = setTimeout(() => this.connect(), delay);
  }

  private enqueueJoin(channel: string): void {
    if (!this.joinQueue.includes(channel)) this.joinQueue.push(channel);
    this.pumpJoins();
  }

  /** Отправляет один JOIN из очереди и назначает следующий через паузу. */
  private pumpJoins(): void {
    if (this.joinTimer || this.socket?.readyState !== WebSocket.OPEN) return;
    const channel = this.joinQueue.shift();
    if (!channel) return;

    this.socket.send(`JOIN #${channel}`);
    this.joinTimer = setTimeout(() => {
      this.joinTimer = null;
      this.pumpJoins();
    }, JOIN_INTERVAL_MS);
  }

  private resetJoinQueue(): void {
    this.joinQueue = [];
    if (this.joinTimer) clearTimeout(this.joinTimer);
    this.joinTimer = null;
  }

  private send(command: string): void {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(command);
  }
}
