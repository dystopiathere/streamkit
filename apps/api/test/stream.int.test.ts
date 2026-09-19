import type { ChannelStats } from '@streamkit/contracts';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Socket } from 'socket.io';
import { CryptoService } from '../src/common/crypto/crypto.service';
import { PresenceService } from '../src/common/redis/presence.service';
import { AnalyticsPoller } from '../src/modules/analytics/analytics-poller.service';
import type { PlatformProvider } from '../src/modules/integrations/platform-provider';
import { PlatformRegistry } from '../src/modules/integrations/platform-registry.service';
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

  const provider = {
    platform: 'twitch',
    title: 'Twitch',
    statsQuotaCost: 0,
    fetchStats: async () => nextStats,
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
    expect(response.body).toEqual({ channels: [], chat: null, widgets: [] });
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

  it('чат — подключённого Twitch, а без него — канала из виджета чата', async () => {
    await request(server())
      .post('/api/widgets')
      .set(auth())
      .send({ name: 'Чат', type: 'chat', config: { channel: 'from_widget' } })
      .expect(201);

    const fromWidget = await request(server()).get('/api/stream').set(auth()).expect(200);
    expect(fromWidget.body.chat).toEqual({
      platform: 'twitch',
      channel: 'from_widget',
      source: 'widget',
    });

    await connectTwitch('Streamer_Login');
    const connected = await request(server()).get('/api/stream').set(auth()).expect(200);
    // IRC различает регистр в имени канала, логин Twitch — всегда строчными.
    expect(connected.body.chat).toEqual({
      platform: 'twitch',
      channel: 'streamer_login',
      source: 'connected',
    });
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

  it('окно подписывается на чат своего канала и отмечает его для воркера', async () => {
    await connectTwitch('streamer_login');
    const { socket, rooms } = fakeSocket(userId);
    rooms.add('chat:twitch:old_channel');

    const ack = await harness.app.get(DashboardGateway).watchStream(socket);

    expect(ack.chat?.channel).toBe('streamer_login');
    expect(rooms.has('chat:twitch:streamer_login')).toBe(true);
    // Прежний канал отпущен: чат чужого канала в окно не течёт.
    expect(rooms.has('chat:twitch:old_channel')).toBe(false);
    expect(await harness.app.get(PresenceService).watchedChats()).toEqual(
      new Set(['streamer_login']),
    );
  });

  it('без канала чата окно ни на что не подписывается', async () => {
    const { socket, rooms } = fakeSocket(userId);
    const ack = await harness.app.get(DashboardGateway).watchStream(socket);

    expect(ack).toEqual({ chat: null });
    expect([...rooms].some((room) => room.startsWith('chat:'))).toBe(false);
    expect((await harness.app.get(PresenceService).watchedChats()).size).toBe(0);
  });
});
