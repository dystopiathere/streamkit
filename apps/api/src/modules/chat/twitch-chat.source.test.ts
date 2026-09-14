import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '../../config/app-config.service';
import { JOIN_INTERVAL_MS, TwitchChatSource } from './twitch-chat.source';

/**
 * Поддельный WebSocket: сеть здесь не нужна, нужны управляемые события.
 *
 * Весь путь через настоящий сокет проверяет интеграционный тест. Здесь — то,
 * что там не воспроизвести: темп JOIN на поддельных часах и запоздавшее событие
 * закрытия от сокета, который уже заменён.
 */
class FakeSocket {
  static readonly OPEN = 1;
  static instances: FakeSocket[] = [];

  readyState = 0;
  readonly sent: string[] = [];
  private readonly listeners = new Map<string, Array<(event?: unknown) => void>>();

  constructor(readonly url: string) {
    FakeSocket.instances.push(this);
  }

  addEventListener(type: string, listener: (event?: unknown) => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  /** Как у настоящего: close приходит позже, а не внутри вызова. */
  close(): void {}

  emit(type: 'open' | 'close'): void {
    if (type === 'open') this.readyState = FakeSocket.OPEN;
    if (type === 'close') this.readyState = 3;
    for (const listener of this.listeners.get(type) ?? []) listener();
  }

  get joins(): string[] {
    return this.sent.filter((line) => line.startsWith('JOIN'));
  }
}

const config = { twitchIrcUrl: 'ws://fake' } as AppConfig;

describe('источник чата Twitch', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    FakeSocket.instances = [];
    vi.stubGlobal('WebSocket', FakeSocket);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('не шлёт больше двадцати JOIN за десять секунд', async () => {
    // Лишние JOIN Twitch молча отбрасывает, а канал уже числится вошедшим:
    // пачка из 25 каналов оставляла пятерых стримеров без чата навсегда.
    const source = new TwitchChatSource(config);
    for (let index = 0; index < 25; index += 1) await source.join(`channel_${index}`);
    await source.start(() => undefined);

    const socket = FakeSocket.instances[0]!;
    socket.emit('open');
    expect(socket.joins).toHaveLength(1);

    vi.advanceTimersByTime(10_000);
    expect(socket.joins.length).toBeLessThanOrEqual(20);

    vi.advanceTimersByTime(25 * JOIN_INTERVAL_MS);
    expect(socket.joins).toHaveLength(25);
    expect(new Set(socket.joins).size).toBe(25);
  });

  it('канал, покинутый до своей очереди, не входит и не выходит', async () => {
    const source = new TwitchChatSource(config);
    await source.start(() => undefined);
    const socket = FakeSocket.instances[0]!;
    socket.emit('open');

    await source.join('first');
    await source.join('second');
    await source.leave('second');
    vi.advanceTimersByTime(5 * JOIN_INTERVAL_MS);

    expect(socket.sent).toContain('JOIN #first');
    expect(socket.sent.some((line) => line.includes('second'))).toBe(false);
  });

  it('запоздавшее закрытие старого сокета не поднимает второе соединение', async () => {
    // Сценарий обрыва сети: владение потеряно, источник остановлен и запущен
    // заново, а close старого сокета приходит только теперь — по таймауту TCP.
    const source = new TwitchChatSource(config);
    await source.start(() => undefined);
    const stale = FakeSocket.instances[0]!;
    stale.emit('open');

    await source.stop();
    await source.start(() => undefined);
    FakeSocket.instances[1]!.emit('open');

    stale.emit('close');
    vi.advanceTimersByTime(120_000);

    expect(FakeSocket.instances).toHaveLength(2);
  });

  it('обычный обрыв текущего соединения переподключает и входит заново', async () => {
    const source = new TwitchChatSource(config);
    await source.join('shroud');
    await source.start(() => undefined);
    const first = FakeSocket.instances[0]!;
    first.emit('open');

    first.emit('close');
    vi.advanceTimersByTime(1_000);
    const second = FakeSocket.instances[1]!;
    second.emit('open');

    expect(second.joins).toEqual(['JOIN #shroud']);
  });
});
