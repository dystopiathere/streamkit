import type { AddressInfo } from 'node:net';
import type { ChatMessage } from '@streamkit/contracts';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { WebSocketServer, type WebSocket as ServerSocket } from 'ws';
import { RealtimeBus, type BusMessage } from '../src/common/bus/realtime-bus.service';
import { PresenceService } from '../src/common/redis/presence.service';
import { ChatManager } from '../src/modules/chat/chat-manager.service';
import { ChatModule } from '../src/modules/chat/chat.module';
import { createHarness, registrationPayload, type TestHarness } from './harness';

/**
 * Чат Twitch целиком, от сокета до шины.
 *
 * Вместо сети — поддельный IRC-сервер в том же процессе: `TWITCH_IRC_URL`
 * указывает на него. Без этого проверить путь «соединение → JOIN по составу
 * виджетов → сообщение → публикация» было бы нечем, а именно на этом пути живут
 * все неочевидные места: состав каналов берётся опросом БД, соединение одно на
 * кластер, а владение им арендуется в Redis.
 */
describe('Чат Twitch (feature)', () => {
  let harness: TestHarness;
  let chat: ChatManager;
  let bus: RealtimeBus;
  let server: WebSocketServer;

  /** Что поддельный сервер получил от клиента. */
  let received: string[] = [];
  /** Открытые соединения: через них тест шлёт сообщения «из чата». */
  let connections: ServerSocket[] = [];

  let accessToken: string;

  beforeAll(async () => {
    server = new WebSocketServer({ port: 0, host: '127.0.0.1' });
    server.on('connection', (socket) => {
      connections.push(socket);
      socket.on('message', (data) => {
        for (const line of String(data).split('\r\n')) {
          if (line.length > 0) received.push(line);
        }
      });
    });
    await new Promise<void>((resolve) => server.once('listening', resolve));

    // Адрес обязан попасть в окружение ДО старта приложения: конфигурация
    // читается и проверяется один раз, при инициализации модуля.
    process.env.TWITCH_IRC_URL = `ws://127.0.0.1:${(server.address() as AddressInfo).port}`;

    harness = await createHarness([ChatModule]);
    chat = harness.app.get(ChatManager);
    bus = harness.app.get(RealtimeBus);
  });

  afterAll(async () => {
    // Сначала отпускаем соединение, потом гасим приложение: иначе таймер
    // переподключения переживёт тест и подвесит прогон.
    await chat.onApplicationShutdown();
    await harness.close();
    for (const socket of connections) socket.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    delete process.env.TWITCH_IRC_URL;
  });

  beforeEach(async () => {
    await chat.onApplicationShutdown();
    await harness.reset();
    received = [];
    connections = [];

    const registration = await request(harness.app.getHttpServer())
      .post('/api/auth/register')
      .send(registrationPayload())
      .expect(201);
    accessToken = registration.body.accessToken as string;
  });

  async function createChatWidget(channel: string): Promise<string> {
    const response = await request(harness.app.getHttpServer())
      .post('/api/widgets')
      .set({ Authorization: `Bearer ${accessToken}` })
      .send({ name: 'Чат', type: 'chat', config: { channel } })
      .expect(201);
    return response.body.id as string;
  }

  it('заходит в канал из настроек виджета и доносит сообщение до шины', async () => {
    await createChatWidget('shroud');

    await chat.tick();
    await waitFor(() => received.some((line) => line === 'JOIN #shroud'));

    // Анонимный вход: ник justinfan, пароль не передаётся вовсе.
    expect(received.some((line) => line.startsWith('NICK justinfan'))).toBe(true);
    expect(received.some((line) => line.includes('PASS'))).toBe(false);
    // Без тегов не будет ни цвета, ни значков, ни эмоутов, ни идентификатора.
    expect(received).toContain('CAP REQ :twitch.tv/tags');

    const delivered = collectChat();
    connections[0]?.send(
      '@color=#1E90FF;display-name=Зритель;emotes=25:0-4;id=m-1;tmi-sent-ts=1789000000000 ' +
        ':viewer!viewer@viewer.tmi.twitch.tv PRIVMSG #shroud :Kappa привет\r\n',
    );

    const message = await delivered;
    expect(message.channel).toBe('shroud');
    expect(message.username).toBe('Зритель');
    expect(message.parts[0]).toEqual({ kind: 'emote', id: '25', alt: 'Kappa' });
  });

  it('отвечает на PING — иначе сервер тихо отключит через несколько минут', async () => {
    await createChatWidget('shroud');
    await chat.tick();
    await waitFor(() => connections.length > 0);

    connections[0]?.send('PING :tmi.twitch.tv\r\n');
    await waitFor(() => received.includes('PONG :tmi.twitch.tv'));
  });

  it('выходит из канала, когда виджет выключили', async () => {
    const widgetId = await createChatWidget('shroud');
    await chat.tick();
    await waitFor(() => received.includes('JOIN #shroud'));

    await request(harness.app.getHttpServer())
      .patch(`/api/widgets/${widgetId}`)
      .set({ Authorization: `Bearer ${accessToken}` })
      .send({ isEnabled: false })
      .expect(200);

    // Состав сверяется опросом БД: команд воркеру в проекте нет, и реакция на
    // изменение настроек приходит следующим тактом, а не перезапуском.
    await chat.tick();
    await waitFor(() => received.includes('PART #shroud'));
  });

  it('заходит в канал открытого окна эфира и выходит, когда отметка истекла', async () => {
    // Окно эфира отмечает канал в Redis; воркер берёт его в состав вместе с
    // каналами виджетов. Виджета чата здесь нет вовсе.
    const presence = harness.app.get(PresenceService);
    await presence.watchChat('streamer_login');

    await chat.tick();
    await waitFor(() => received.includes('JOIN #streamer_login'));

    // Окно закрыли: отметку никто не продлил, срок вышел.
    await harness.redis.zadd('streamkit:presence:chat-watch', Date.now() - 1, 'streamer_login');
    await chat.tick();
    await waitFor(() => received.includes('PART #streamer_login'));
  });

  it('не подключается, пока канал не вписан', async () => {
    await createChatWidget('');

    await chat.tick();
    await waitFor(() => connections.length > 0);
    // Соединение есть — оно одно на все каналы, — но заходить некуда.
    expect(received.some((line) => line.startsWith('JOIN'))).toBe(false);
  });

  it('соединение держит только владелец аренды', async () => {
    await createChatWidget('shroud');
    await chat.tick();
    await waitFor(() => received.includes('JOIN #shroud'));

    // Имитируем вторую реплику воркера: она забрала ключ владения себе.
    // Первая обязана заметить это следующим тактом и закрыть соединение, иначе
    // зрители увидят каждое сообщение дважды.
    await harness.redis.set('streamkit:owner:chat:twitch', 'чужая-реплика');

    await chat.tick();
    await waitFor(() => connections.every((socket) => socket.readyState !== socket.OPEN));
  });

  /** Ждёт первое сообщение чата в шине. */
  function collectChat(): Promise<ChatMessage> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('Сообщение чата не доехало до шины')),
        10_000,
      );
      void bus.subscribe((message: BusMessage) => {
        if (message.kind !== 'chat') return;
        clearTimeout(timer);
        resolve(message.message);
      });
    });
  }
});

/** Ждёт условия, опрашивая его. Таймаут — чтобы падение было внятным. */
async function waitFor(condition: () => boolean, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('Условие не выполнилось за отведённое время');
}
