import { JwtService } from '@nestjs/jwt';
import type { ChannelStats } from '@streamkit/contracts';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Socket } from 'socket.io';
import { CryptoService } from '../src/common/crypto/crypto.service';
import { PlatformAuthError } from '../src/common/http/platform-errors';
import { PresenceService } from '../src/common/redis/presence.service';
import { AnalyticsPoller } from '../src/modules/analytics/analytics-poller.service';
import type { PlatformProvider } from '../src/modules/integrations/platform-provider';
import { PlatformRegistry } from '../src/modules/integrations/platform-registry.service';
import { type BusMessage, RealtimeBus } from '../src/common/bus/realtime-bus.service';
import { PlatformConnectionService } from '../src/modules/integrations/platform-connection.service';
import { DashboardGateway } from '../src/modules/realtime/dashboard.gateway';
import { createHarness, registrationPayload, type TestHarness } from './harness';

/**
 * Окно эфира: сводка каналов, чата и виджетов одним запросом и подписка окна на
 * чат своего канала.
 *
 * Площадка подменена — опрос получает от неё готовый снимок с началом эфира.
 * Сокет шлюза тоже: метод подписки вызывается напрямую с его подобием, а
 * доставка чата от шины до экрана закрыта сквозным тестом.
 */
describe('Окно эфира (feature)', () => {
  let harness: TestHarness;
  let userId: string;
  let accessToken: string;
  let nextStats: ChannelStats;
  /** Отказ площадки на следующий опрос. Ставится тестом, снимается в beforeEach. */
  let nextError: Error | null;

  const provider = {
    platform: 'twitch',
    title: 'Twitch',
    statsQuotaCost: 0,
    fetchStats: async () => {
      if (nextError) throw nextError;
      return nextStats;
    },
  } as unknown as PlatformProvider;

  beforeAll(async () => {
    harness = await createHarness([], (builder) =>
      builder
        .overrideProvider(PlatformRegistry)
        .useValue({ find: () => provider, require: () => provider, list: () => [] }),
    );
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await harness.reset();
    nextError = null;
    const registration = await request(server())
      .post('/api/auth/register')
      .send(registrationPayload());
    accessToken = registration.body.accessToken as string;
    userId = registration.body.user.id as string;
  });

  const server = () => harness.app.getHttpServer();
  const auth = () => ({ Authorization: `Bearer ${accessToken}` });

  async function connectTwitch(login = 'streamer_login'): Promise<string> {
    const crypto = harness.app.get(CryptoService);
    await harness.prisma.integrationCredential.create({
      data: {
        userId,
        provider: 'twitch',
        accessTokenEncrypted: crypto.encrypt('access-token'),
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        scopes: [],
      },
    });
    const channel = await harness.prisma.channel.create({
      data: { userId, platform: 'TWITCH', externalId: 'ext-1', login, displayName: 'Стример' },
    });
    return channel.id;
  }

  const YOUTUBE_ID = 'UC' + 'y'.repeat(22);

  async function connectYouTube(syncState: 'OK' | 'AUTH_EXPIRED' = 'OK'): Promise<void> {
    await harness.prisma.channel.create({
      data: {
        userId,
        platform: 'YOUTUBE',
        externalId: YOUTUBE_ID,
        login: '@streamer',
        displayName: 'Стример на YouTube',
        syncState,
      },
    });
  }

  function liveStats(overrides: Partial<ChannelStats> = {}): ChannelStats {
    return {
      capturedAt: new Date().toISOString(),
      isLive: true,
      viewers: 1543,
      followers: 10,
      subscribers: null,
      totalViews: null,
      title: 'Ранговые',
      category: 'Dota 2',
      liveSince: '2026-09-18T18:00:30.000Z',
      ...overrides,
    };
  }

  function fakeSocket(owner: string) {
    const rooms = new Set<string>(['socket-id']);
    return {
      socket: {
        data: { authenticated: Promise.resolve(owner) },
        rooms,
        join: async (room: string) => void rooms.add(room),
        leave: async (room: string) => void rooms.delete(room),
      } as unknown as Socket,
      rooms,
    };
  }

  it('без площадок и виджетов окно пустое, но отвечает', async () => {
    const response = await request(server()).get('/api/stream').set(auth()).expect(200);
    expect(response.body).toEqual({ channels: [], chats: [], widgets: [] });
  });

  it('показывает зрителей и начало эфира, снятые опросом площадки', async () => {
    const channelId = await connectTwitch();
    nextStats = liveStats();
    await harness.app.get(AnalyticsPoller).pollDue();

    const response = await request(server()).get('/api/stream').set(auth()).expect(200);
    expect(response.body.channels).toEqual([
      expect.objectContaining({
        id: channelId,
        platform: 'twitch',
        isLive: true,
        viewers: 1543,
        liveSince: '2026-09-18T18:00:30.000Z',
        title: 'Ранговые',
      }),
    ]);
  });

  it('после эфира начало эфира и зрители сбрасываются', async () => {
    await connectTwitch();
    nextStats = liveStats();
    await harness.app.get(AnalyticsPoller).pollDue();

    await harness.prisma.channel.updateMany({ data: { nextAttemptAt: null, lastSyncedAt: null } });
    nextStats = liveStats({ isLive: false, viewers: null, liveSince: null, title: null });
    await harness.app.get(AnalyticsPoller).pollDue();

    const channel = await harness.prisma.channel.findFirstOrThrow({ where: { userId } });
    expect(channel.liveSince).toBeNull();
    const response = await request(server()).get('/api/stream').set(auth()).expect(200);
    expect(response.body.channels[0]).toMatchObject({
      isLive: false,
      viewers: null,
      liveSince: null,
    });
  });

  it('чат — только подключённых площадок: без подключения его нет', async () => {
    const none = await request(server()).get('/api/stream').set(auth()).expect(200);
    expect(none.body.chats).toEqual([]);

    await connectTwitch('Streamer_Login');
    await connectYouTube();
    const connected = await request(server()).get('/api/stream').set(auth()).expect(200);
    // IRC различает регистр в имени канала, логин Twitch — всегда строчными.
    // YouTube без отметки воркера — «ждём эфира»: чат у него есть только у эфира.
    expect(connected.body.chats).toEqual([
      { platform: 'twitch', channel: 'streamer_login', title: 'Стример', state: 'ok' },
      { platform: 'youtube', channel: YOUTUBE_ID, title: 'Стример на YouTube', state: 'waiting' },
    ]);
  });

  it('состояние чата YouTube — по отметке воркера, отозванный доступ — сразу «переподключите»', async () => {
    await connectYouTube();
    await harness.app
      .get(PresenceService)
      .setChatStates([[{ platform: 'youtube', channel: YOUTUBE_ID }, 'quota']]);
    const quota = await request(server()).get('/api/stream').set(auth()).expect(200);
    expect(quota.body.chats[0].state).toBe('quota');

    await harness.prisma.channel.updateMany({ data: { syncState: 'AUTH_EXPIRED' } });
    const expired = await request(server()).get('/api/stream').set(auth()).expect(200);
    expect(expired.body.chats[0].state).toBe('auth');
  });

  it('отключение Twitch сообщает оверлеям чата, что канала больше нет', async () => {
    await connectTwitch();
    const messages: BusMessage[] = [];
    const unsubscribe = await harness.app
      .get(RealtimeBus)
      .subscribe((message) => void messages.push(message));
    try {
      await connectYouTube();
      await harness.app.get(PlatformConnectionService).disconnect(userId, 'twitch');
      await waitUntil(() => messages.some((message) => message.kind === 'chat-channel'));
      // Остаётся YouTube: оверлей переходит на оставшиеся каналы, а не замолкает.
      expect(messages.find((message) => message.kind === 'chat-channel')).toEqual({
        kind: 'chat-channel',
        userId,
        channels: [{ platform: 'youtube', channel: YOUTUBE_ID }],
      });
    } finally {
      await unsubscribe();
    }
  });

  it('виджеты: сколько ссылок и сколько из них подключено к OBS сейчас', async () => {
    const widget = await request(server())
      .post('/api/widgets')
      .set(auth())
      .send({ name: 'Алерты', type: 'alerts', config: {} })
      .expect(201);
    const widgetId = widget.body.id as string;
    await request(server())
      .post(`/api/widgets/${widgetId}/tokens`)
      .set(auth())
      .send({})
      .expect(201);
    await request(server())
      .post(`/api/widgets/${widgetId}/tokens`)
      .set(auth())
      .send({})
      .expect(201);

    const tokens = await harness.prisma.overlayToken.findMany({ where: { widgetId } });
    await harness.app.get(PresenceService).markOverlays([tokens[0]!.id]);

    const response = await request(server()).get('/api/stream').set(auth()).expect(200);
    expect(response.body.widgets).toEqual([
      expect.objectContaining({ id: widgetId, name: 'Алерты', links: 2, connected: 1 }),
    ]);

    // Отключился — отметка снята сразу, а не через срок жизни.
    await harness.app.get(PresenceService).dropOverlay(tokens[0]!.id);
    const after = await request(server()).get('/api/stream').set(auth()).expect(200);
    expect(after.body.widgets[0].connected).toBe(0);
  });

  it('окно подписывается на чаты своих каналов и отмечает их для воркера', async () => {
    await connectTwitch('streamer_login');
    await connectYouTube();
    const { socket, rooms } = fakeSocket(userId);
    rooms.add('chat:twitch:old_channel');

    const ack = await harness.app.get(DashboardGateway).watchStream(socket);

    expect(ack.chats.map((chat) => chat.channel)).toEqual(['streamer_login', YOUTUBE_ID]);
    expect(rooms.has('chat:twitch:streamer_login')).toBe(true);
    expect(rooms.has(`chat:youtube:${YOUTUBE_ID}`)).toBe(true);
    // Прежний канал отпущен: чат чужого канала в окно не течёт.
    expect(rooms.has('chat:twitch:old_channel')).toBe(false);
    expect(await harness.app.get(PresenceService).watchedChats()).toEqual([
      { platform: 'twitch', channel: 'streamer_login' },
      { platform: 'youtube', channel: YOUTUBE_ID },
    ]);
  });

  it('YouTube с отозванным доступом окно показывает, но воркеру не отмечает: квота не тратится впустую', async () => {
    await connectYouTube('AUTH_EXPIRED');
    const { socket } = fakeSocket(userId);
    const ack = await harness.app.get(DashboardGateway).watchStream(socket);

    expect(ack.chats).toEqual([expect.objectContaining({ platform: 'youtube', state: 'auth' })]);
    expect(await harness.app.get(PresenceService).watchedChats()).toEqual([]);
  });

  it('сокет дашборда закрывается, когда истекает токен, по которому он открыт', async () => {
    // Иначе окно эфира переживало бы выход и смену пароля: токен проверяется
    // только при подключении, а сокет живёт весь стрим.
    const token = await harness.app
      .get(JwtService)
      .signAsync({ sub: userId, email: 'streamer@example.com' }, { expiresIn: 1 });
    let disconnected = false;
    const client = {
      handshake: { auth: { token } },
      data: {},
      join: async () => undefined,
      disconnect: () => {
        disconnected = true;
      },
    } as unknown as Socket;
    const gateway = harness.app.get(DashboardGateway);

    await gateway.handleConnection(client);
    expect(disconnected).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    expect(disconnected).toBe(true);
    gateway.handleDisconnect(client);
  });

  it('кнопка «Обновить» опрашивает площадку сразу, а второе нажатие подряд — нет', async () => {
    // Расписание вне эфира — раз в пятнадцать минут (квота YouTube), и это та
    // самая жалоба: о начале эфира окно узнавало с опозданием. Кнопка
    // опрашивает площадку немедленно; пауза между нажатиями общая на все
    // инстансы API, потому что живёт в Redis.
    await connectTwitch();
    nextStats = liveStats();

    const first = await request(server()).post('/api/stream/refresh').set(auth()).expect(200);
    expect(first.body.throttled).toBe(false);
    expect(first.body.overview.channels[0]).toMatchObject({ isLive: true, viewers: 1543 });
    expect(Date.parse(first.body.nextRefreshAt as string)).toBeGreaterThan(Date.now());

    // Второе нажатие отдаёт ту же сводку и признак «слишком часто» — но не
    // ошибку: данные свежие, просто без нового запроса к площадке.
    nextStats = liveStats({ viewers: 9999 });
    const second = await request(server()).post('/api/stream/refresh').set(auth()).expect(200);
    expect(second.body.throttled).toBe(true);
    expect(second.body.overview.channels[0].viewers).toBe(1543);
  });

  it('403 от площадки — временный отказ, а не «переподключите площадку»', async () => {
    // У YouTube так отвечает канал без включённых трансляций, у Twitch — канал
    // без партнёрства. AUTH_EXPIRED здесь означал бы тупик: право выдано, а
    // данных всё равно нет, и переподключение ничего не меняет.
    await connectTwitch();
    nextError = new PlatformAuthError('twitch', 403, 'Площадка отвергла токен');
    await harness.app.get(AnalyticsPoller).pollDue();

    const channel = await harness.prisma.channel.findFirstOrThrow({ where: { userId } });
    expect(channel.syncState).toBe('ERROR');
    expect(channel.nextAttemptAt).not.toBeNull();
  });

  it('401 от площадки останавливает опрос до переподключения', async () => {
    await connectTwitch();
    nextError = new PlatformAuthError('twitch', 401, 'Площадка отвергла токен');
    await harness.app.get(AnalyticsPoller).pollDue();

    const channel = await harness.prisma.channel.findFirstOrThrow({ where: { userId } });
    expect(channel.syncState).toBe('AUTH_EXPIRED');
  });

  it('без канала чата окно ни на что не подписывается', async () => {
    const { socket, rooms } = fakeSocket(userId);
    const ack = await harness.app.get(DashboardGateway).watchStream(socket);

    expect(ack).toEqual({ chats: [] });
    expect([...rooms].some((room) => room.startsWith('chat:'))).toBe(false);
    expect(await harness.app.get(PresenceService).watchedChats()).toEqual([]);
  });
});

async function waitUntil(check: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('Условие не выполнилось');
}
