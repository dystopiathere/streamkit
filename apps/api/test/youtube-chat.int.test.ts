import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import * as grpc from '@grpc/grpc-js';
import type { ChatMessage } from '@streamkit/contracts';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type BusMessage, RealtimeBus } from '../src/common/bus/realtime-bus.service';
import { CryptoService } from '../src/common/crypto/crypto.service';
import { PresenceService } from '../src/common/redis/presence.service';
import { quotaKey, YOUTUBE_CHAT_QUOTA } from '../src/modules/analytics/quota.service';
import { ChatManager } from '../src/modules/chat/chat-manager.service';
import { ChatModule } from '../src/modules/chat/chat.module';
import { youtubeChatServiceDefinition } from '../src/modules/chat/youtube-chat';
import type {
  YouTubeChatItem,
  YouTubeChatRequest,
  YouTubeChatResponse,
} from '../src/modules/chat/youtube-chat.proto';
import { createHarness, registrationPayload, type TestHarness } from './harness';

const CHANNEL = 'UC' + 'c'.repeat(22);
const AUTHOR = 'UC' + 'd'.repeat(22);
const LIVE_CHAT_ID = 'live-chat-1';

type StreamCall = grpc.ServerWritableStream<YouTubeChatRequest, YouTubeChatResponse>;

/**
 * Поддельный YouTube: `liveBroadcasts.list` по HTTP и сервис чата
 * `StreamList` по gRPC — с тем же прото, что у клиента.
 */
class FakeYouTube {
  readonly http: Server;
  readonly grpc = new grpc.Server();
  grpcPort = 0;
  /** Идёт ли эфир — есть ли что вернуть в `liveBroadcasts`. */
  live = true;
  discoveries = 0;
  /** Открытые потоки чата и с чем их открыли. */
  calls: Array<{ call: StreamCall; request: YouTubeChatRequest; cancelled: boolean }> = [];
  /** Отвечать на поток отказом по токену. */
  rejectAuth = false;

  constructor() {
    this.http = createServer((req, res) => this.route(req, res));
    this.grpc.addService(youtubeChatServiceDefinition(), {
      StreamList: (call: StreamCall) => {
        if (this.rejectAuth || call.metadata.get('authorization')[0] !== 'Bearer yt-access') {
          call.emit('error', { code: grpc.status.UNAUTHENTICATED, details: 'invalid token' });
          return;
        }
        const entry = { call, request: call.request, cancelled: false };
        call.on('cancelled', () => {
          entry.cancelled = true;
        });
        this.calls.push(entry);
      },
    });
  }

  async start(): Promise<void> {
    await new Promise<void>((resolve) => this.http.listen(0, '127.0.0.1', resolve));
    this.grpcPort = await new Promise<number>((resolve, reject) =>
      this.grpc.bindAsync('127.0.0.1:0', grpc.ServerCredentials.createInsecure(), (error, port) =>
        error ? reject(error) : resolve(port),
      ),
    );
  }

  get apiUrl(): string {
    return `http://127.0.0.1:${(this.http.address() as AddressInfo).port}/youtube/v3`;
  }

  get openCalls() {
    return this.calls.filter((entry) => !entry.cancelled);
  }

  reset(): void {
    this.live = true;
    this.discoveries = 0;
    this.rejectAuth = false;
    for (const entry of this.calls) entry.call.end();
    this.calls = [];
  }

  async stop(): Promise<void> {
    this.grpc.forceShutdown();
    await new Promise<void>((resolve) => this.http.close(() => resolve()));
  }

  private route(req: IncomingMessage, res: ServerResponse): void {
    if (req.url?.startsWith('/youtube/v3/liveBroadcasts')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      this.discoveries += 1;
      res.end(
        JSON.stringify({ items: this.live ? [{ snippet: { liveChatId: LIVE_CHAT_ID } }] : [] }),
      );
      return;
    }
    res.writeHead(404);
    res.end('{}');
  }
}

function textItem(id: string, text: string, publishedAt = new Date()): YouTubeChatItem {
  return {
    id,
    snippet: {
      type: 'TEXT_MESSAGE_EVENT',
      publishedAt: publishedAt.toISOString(),
      textMessageDetails: { messageText: text },
    },
    authorDetails: { channelId: AUTHOR, displayName: 'Зритель YouTube' },
  };
}

async function until(check: () => Promise<boolean> | boolean, attempts = 150): Promise<void> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  throw new Error('Условие не выполнилось');
}

/**
 * Чат YouTube целиком: окно эфира открыто → воркер нашёл эфир → поток gRPC →
 * сообщение в шине. Квота, конец эфира, обрыв и отзыв доступа — здесь же:
 * именно в них живут неочевидные места (docs/adr/0014).
 */
describe('Чат YouTube (feature)', () => {
  const fake = new FakeYouTube();
  let harness: TestHarness;
  let chat: ChatManager;
  let presence: PresenceService;
  let userId: string;
  let published: ChatMessage[] = [];
  let unsubscribe: () => Promise<void>;

  beforeAll(async () => {
    await fake.start();
    // Окружение — до старта приложения: конфигурация читается при инициализации.
    process.env.YOUTUBE_API_URL = fake.apiUrl;
    process.env.YOUTUBE_CHAT_GRPC_URL = `127.0.0.1:${fake.grpcPort}`;
    process.env.YOUTUBE_CHAT_GRPC_INSECURE = 'true';
    // IRC Twitch в этом прогоне не нужен, но источник поднимается вместе со
    // всеми: адрес заведомо закрытый, чтобы не ходить в настоящий Twitch.
    process.env.TWITCH_IRC_URL = 'ws://127.0.0.1:9';
    harness = await createHarness([ChatModule]);
    chat = harness.app.get(ChatManager);
    presence = harness.app.get(PresenceService);
    unsubscribe = await harness.app.get(RealtimeBus).subscribe((message: BusMessage) => {
      if (message.kind === 'chat') published.push(message.message);
    });
  });

  afterAll(async () => {
    await chat.onApplicationShutdown();
    await unsubscribe();
    await harness.close();
    await fake.stop();
    for (const key of [
      'YOUTUBE_API_URL',
      'YOUTUBE_CHAT_GRPC_URL',
      'YOUTUBE_CHAT_GRPC_INSECURE',
      'TWITCH_IRC_URL',
    ]) {
      delete process.env[key];
    }
  });

  beforeEach(async () => {
    await chat.onApplicationShutdown();
    fake.reset();
    await harness.reset();
    published = [];
    const registration = await request(harness.app.getHttpServer())
      .post('/api/auth/register')
      .send(registrationPayload())
      .expect(201);
    userId = registration.body.user.id as string;

    await harness.prisma.channel.create({
      data: {
        userId,
        platform: 'YOUTUBE',
        externalId: CHANNEL,
        login: '@streamer',
        displayName: 'Стример',
      },
    });
    await harness.prisma.integrationCredential.create({
      data: {
        userId,
        provider: 'youtube',
        accessTokenEncrypted: harness.app.get(CryptoService).encrypt('yt-access'),
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        scopes: ['https://www.googleapis.com/auth/youtube.readonly'],
      },
    });
  });

  async function openWindow(): Promise<void> {
    await presence.watchChats([{ platform: 'youtube', channel: CHANNEL }]);
    await chat.tick();
  }

  async function state(): Promise<string | undefined> {
    return (await presence.chatStates([{ platform: 'youtube', channel: CHANNEL }])).get(
      `youtube:${CHANNEL}`,
    );
  }

  it('окно открыто и эфир идёт — поток чата открыт, в шину уходят только новые сообщения', async () => {
    await openWindow();
    await until(() => fake.openCalls.length === 1);

    const [entry] = fake.openCalls;
    expect(entry!.request.liveChatId).toBe(LIVE_CHAT_ID);
    expect(entry!.request.part).toEqual(['id', 'snippet', 'authorDetails']);

    // Первым ответом YouTube присылает историю — в кадр она не идёт.
    entry!.call.write({
      nextPageToken: 'page-1',
      items: [
        textItem('old', 'вчерашнее', new Date(Date.now() - 60_000)),
        textItem('new', 'привет из YouTube'),
      ],
    });
    await until(() => published.length === 1);
    expect(published[0]).toMatchObject({
      platform: 'youtube',
      channel: CHANNEL,
      login: AUTHOR,
      username: 'Зритель YouTube',
      parts: [{ kind: 'text', value: 'привет из YouTube' }],
    });

    await chat.tick();
    expect(await state()).toBe('ok');
  });

  it('эфира нет — ждём, и следующий поиск не раньше чем через две минуты', async () => {
    fake.live = false;
    await openWindow();
    await until(() => fake.discoveries === 1);

    await chat.tick();
    await chat.tick();
    expect(fake.discoveries).toBe(1);
    expect(fake.calls).toHaveLength(0);
    expect(await state()).toBe('waiting');
  });

  it('эфир закончился — поток закрыт, снова ищем эфир', async () => {
    await openWindow();
    await until(() => fake.openCalls.length === 1);

    fake.openCalls[0]!.call.write({ offlineAt: new Date().toISOString(), items: [] });
    await until(() => fake.openCalls.length === 0);
    await chat.tick();
    expect(await state()).toBe('waiting');
  });

  it('сервер закрыл поток — переподключение продолжает с того же места', async () => {
    await openWindow();
    await until(() => fake.openCalls.length === 1);
    const first = fake.openCalls[0]!;
    first.call.write({ nextPageToken: 'page-7', items: [] });
    await new Promise((resolve) => setTimeout(resolve, 100));
    first.call.end();

    // Поток прожил меньше «здоровых» тридцати секунд — переподключение через
    // паузу лесенки, на такте воркера.
    await new Promise((resolve) => setTimeout(resolve, 1_100));
    await chat.tick();
    await until(() => fake.calls.length === 2);
    expect(fake.calls[1]!.request.pageToken).toBe('page-7');
  });

  it('бюджет чата исчерпан — ни поиска эфира, ни потока, окно видит «квота»', async () => {
    await harness.redis.set(quotaKey(YOUTUBE_CHAT_QUOTA), 1_000_000, 'EX', 3600);
    await openWindow();
    // Состояние доезжает до окна на такте воркера после попытки.
    await until(async () => {
      await chat.tick();
      return (await state()) === 'quota';
    });
    expect(fake.discoveries).toBe(0);
    expect(fake.calls).toHaveLength(0);
  });

  it('YouTube дважды отверг токен — канал просит переподключения', async () => {
    fake.rejectAuth = true;
    await openWindow();
    await until(async () => {
      const channel = await harness.prisma.channel.findFirstOrThrow({ where: { userId } });
      return channel.syncState === 'AUTH_EXPIRED';
    });
    await chat.tick();
    expect(await state()).toBe('auth');
  });

  it('окно закрыли — поток закрыт: квота не тратится на чат, который никто не видит', async () => {
    await openWindow();
    await until(() => fake.openCalls.length === 1);

    await harness.redis.zadd('streamkit:presence:chat-watch', Date.now() - 1, `youtube:${CHANNEL}`);
    await chat.tick();
    await until(() => fake.openCalls.length === 0);
  });

  it('виджет чата с выключенным YouTube чат YouTube не читает', async () => {
    const auth = {
      Authorization: `Bearer ${
        (
          await request(harness.app.getHttpServer())
            .post('/api/auth/login')
            .send({
              email: (await harness.prisma.user.findFirstOrThrow()).email,
              password: registrationPayload().password,
            })
            .expect(200)
        ).body.accessToken as string
      }`,
    };
    const widget = await request(harness.app.getHttpServer())
      .post('/api/widgets')
      .set(auth)
      .send({ name: 'Чат', type: 'chat', config: { platforms: { youtube: false } } })
      .expect(201);
    const token = await request(harness.app.getHttpServer())
      .post(`/api/widgets/${widget.body.id as string}/tokens`)
      .set(auth)
      .send({})
      .expect(201);
    await presence.markOverlays([token.body.id as string]);

    await chat.tick();
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(fake.discoveries).toBe(0);
  });
});
