import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type WebSocket as ServerSocket, WebSocketServer } from 'ws';
import { type BusMessage, RealtimeBus } from '../src/common/bus/realtime-bus.service';
import { CryptoService } from '../src/common/crypto/crypto.service';
import { ConnectorManager } from '../src/modules/integrations/connector-manager.service';
import { DonationConnectorsModule } from '../src/modules/integrations/integrations.module';
import { TWITCH_SCOPES } from '../src/modules/integrations/twitch.provider';
import { createHarness, registrationPayload, type TestHarness } from './harness';

const BROADCASTER = '1001';

/**
 * Поддельный Twitch: Helix (создание подписок EventSub) и сокет EventSub.
 *
 * Отвечает по документации EventSub: приветствие с идентификатором сессии,
 * подписки создаются токеном стримера на эту сессию, уведомления приходят
 * кадром `notification`, переезд — `session_reconnect`.
 */
class FakeTwitch {
  readonly server: Server;
  private readonly sockets = new WebSocketServer({ noServer: true });
  private readonly connections: ServerSocket[] = [];
  private sessionSeq = 0;
  /** Созданные подписки: тип и сессия. */
  subscriptions: Array<{ type: string; sessionId: string }> = [];
  /** Типы, на которые у токена нет права — Helix отвечает 403. */
  forbidden = new Set<string>();

  constructor() {
    this.server = createServer((req, res) => void this.route(req, res));
    this.server.on('upgrade', (req, socket, head) => {
      this.sockets.handleUpgrade(req, socket, head, (ws) => this.accept(ws));
    });
  }

  get origin(): string {
    return `127.0.0.1:${(this.server.address() as AddressInfo).port}`;
  }

  get openConnections(): number {
    return this.connections.length;
  }

  notify(type: string, event: Record<string, unknown>, messageId = `msg-${Math.random()}`): void {
    this.sendAll({
      metadata: {
        message_id: messageId,
        message_type: 'notification',
        message_timestamp: new Date().toISOString(),
        subscription_type: type,
      },
      payload: { subscription: { type, status: 'enabled' }, event },
    });
  }

  revoke(status: string): void {
    this.sendAll({
      metadata: {
        message_id: 'revoke',
        message_type: 'revocation',
        subscription_type: 'channel.follow',
      },
      payload: { subscription: { type: 'channel.follow', status } },
    });
  }

  askToReconnect(): void {
    this.sendAll({
      metadata: { message_id: 'reconnect', message_type: 'session_reconnect' },
      payload: {
        session: { id: 'moving', reconnect_url: `ws://${this.origin}/ws?migrated=1` },
      },
    });
  }

  reset(): void {
    this.subscriptions = [];
    this.forbidden = new Set();
    for (const socket of this.connections.splice(0)) socket.terminate();
  }

  private sendAll(frame: unknown): void {
    for (const socket of this.connections) socket.send(JSON.stringify(frame));
  }

  private accept(socket: ServerSocket): void {
    this.connections.push(socket);
    socket.on('close', () => {
      const index = this.connections.indexOf(socket);
      if (index >= 0) this.connections.splice(index, 1);
    });
    this.sessionSeq += 1;
    socket.send(
      JSON.stringify({
        metadata: { message_id: `welcome-${this.sessionSeq}`, message_type: 'session_welcome' },
        payload: { session: { id: `session-${this.sessionSeq}`, keepalive_timeout_seconds: 10 } },
      }),
    );
  }

  private async route(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = await readBody(req);
    const json = (status: number, payload: unknown) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(payload));
    };
    if (req.method === 'POST' && req.url === '/helix/eventsub/subscriptions') {
      if (
        req.headers.authorization !== 'Bearer tw-access' ||
        req.headers['client-id'] !== 'tw-client'
      ) {
        return json(401, { message: 'invalid token' });
      }
      const subscription = JSON.parse(body) as {
        type: string;
        transport: { method: string; session_id: string };
      };
      if (this.forbidden.has(subscription.type)) {
        return json(403, { message: 'subscription missing proper authorization' });
      }
      this.subscriptions.push({
        type: subscription.type,
        sessionId: subscription.transport.session_id,
      });
      return json(202, { data: [{ status: 'enabled' }] });
    }
    json(404, {});
  }
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (chunk: Buffer) => (data += chunk.toString('utf8')));
    req.on('end', () => resolve(data));
  });
}

async function until(check: () => Promise<boolean> | boolean): Promise<void> {
  for (let attempt = 0; attempt < 150; attempt += 1) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  throw new Error('Условие не выполнилось');
}

/**
 * События Twitch через EventSub — от сокета до истории событий.
 *
 * Коннектор живёт в воркере и сверяется с подключёнными каналами тем же
 * тактом, что DonationAlerts: подключили Twitch в «Аналитике» — события
 * канала пошли, без отдельного включения.
 */
describe('События Twitch (feature)', () => {
  const fake = new FakeTwitch();
  let harness: TestHarness;
  let manager: ConnectorManager;
  let userId: string;

  beforeAll(async () => {
    await new Promise<void>((resolve) => fake.server.listen(0, '127.0.0.1', resolve));
    // Окружение — до старта приложения: конфигурация читается при инициализации.
    process.env.TWITCH_CLIENT_ID = 'tw-client';
    process.env.TWITCH_CLIENT_SECRET = 'tw-secret';
    process.env.TWITCH_API_URL = `http://${fake.origin}/helix`;
    process.env.TWITCH_EVENTSUB_URL = `ws://${fake.origin}/ws`;
    harness = await createHarness([DonationConnectorsModule]);
    manager = harness.app.get(ConnectorManager);
  });

  afterAll(async () => {
    // Сначала соединения, потом приложение: иначе таймер переподключения
    // переживёт тест и подвесит прогон.
    await manager.onApplicationShutdown();
    await harness.close();
    fake.reset();
    await new Promise<void>((resolve) => fake.server.close(() => resolve()));
    for (const key of [
      'TWITCH_CLIENT_ID',
      'TWITCH_CLIENT_SECRET',
      'TWITCH_API_URL',
      'TWITCH_EVENTSUB_URL',
    ]) {
      delete process.env[key];
    }
  });

  beforeEach(async () => {
    await manager.onApplicationShutdown();
    fake.reset();
    await harness.reset();
    const registration = await request(harness.app.getHttpServer())
      .post('/api/auth/register')
      .send(registrationPayload())
      .expect(201);
    userId = registration.body.user.id as string;
  });

  /** Twitch, подключённый в «Аналитике»: канал и токен стримера. */
  async function connectTwitch(scopes: readonly string[] = TWITCH_SCOPES): Promise<void> {
    await harness.prisma.channel.create({
      data: {
        userId,
        platform: 'TWITCH',
        externalId: BROADCASTER,
        login: 'streamer',
        displayName: 'Стример',
      },
    });
    await harness.prisma.integrationCredential.create({
      data: {
        userId,
        provider: 'twitch',
        accessTokenEncrypted: harness.app.get(CryptoService).encrypt('tw-access'),
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        scopes: [...scopes],
      },
    });
  }

  it('подписывается на события канала на свою сессию, и фолловер попадает в историю', async () => {
    await connectTwitch();
    await manager.reconcile();
    await until(() => fake.subscriptions.length === 9);

    expect(fake.subscriptions.map((subscription) => subscription.type).sort()).toEqual(
      [
        'channel.channel_points_custom_reward_redemption.add',
        'channel.cheer',
        'channel.follow',
        'channel.raid',
        'channel.subscribe',
        'channel.subscription.gift',
        'channel.subscription.message',
        // Начало и конец эфира: не алерты, а сигнал сбору метрик. Прав не
        // требуют, поэтому есть всегда.
        'stream.offline',
        'stream.online',
      ].sort(),
    );
    expect(new Set(fake.subscriptions.map((subscription) => subscription.sessionId))).toEqual(
      new Set(['session-1']),
    );

    fake.notify('channel.follow', { user_name: 'Новый зритель' });
    fake.notify('channel.raid', { from_broadcaster_user_name: 'Сосед', viewers: 42 });
    await until(async () => (await harness.prisma.alertEvent.count()) === 2);

    const events = await harness.prisma.alertEvent.findMany({ orderBy: { createdAt: 'asc' } });
    expect(
      events.map((event) => [event.type, event.provider, event.username, event.count]),
    ).toEqual([
      ['FOLLOW', 'TWITCH', 'Новый зритель', null],
      ['RAID', 'TWITCH', 'Сосед', 42],
    ]);
  });

  it('повтор доставки с тем же message_id не даёт второго алерта', async () => {
    await connectTwitch();
    await manager.reconcile();
    await until(() => fake.subscriptions.length === 9);

    fake.notify('channel.cheer', { user_name: 'Щедрый', bits: 500, message: 'держи' }, 'same-id');
    fake.notify('channel.cheer', { user_name: 'Щедрый', bits: 500, message: 'держи' }, 'same-id');
    await until(async () => (await harness.prisma.alertEvent.count()) === 1);
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(await harness.prisma.alertEvent.count()).toBe(1);
  });

  it('без прав на биты и баллы остальные события всё равно приходят, а канал просит переподключения', async () => {
    const withoutNew = TWITCH_SCOPES.filter(
      (scope) => scope !== 'bits:read' && scope !== 'channel:read:redemptions',
    );
    await connectTwitch(withoutNew);
    fake.forbidden = new Set([
      'channel.cheer',
      'channel.channel_points_custom_reward_redemption.add',
    ]);
    await manager.reconcile();
    await until(() => fake.subscriptions.length === 7);

    fake.notify('channel.follow', { user_name: 'Зритель' });
    await until(async () => (await harness.prisma.alertEvent.count()) === 1);

    // Стример видит, что нужно переподключить Twitch, в карточке канала.
    const token = await request(harness.app.getHttpServer())
      .post('/api/auth/login')
      .send({
        email: (await harness.prisma.user.findFirstOrThrow()).email,
        password: registrationPayload().password,
      })
      .expect(200);
    const channels = await request(harness.app.getHttpServer())
      .get('/api/channels')
      .set({ Authorization: `Bearer ${token.body.accessToken as string}` })
      .expect(200);
    expect(channels.body[0].needsReconnect).toBe(true);
  });

  it('начало эфира уходит сигналом сбору метрик, а не алертом в историю', async () => {
    // Из-за этого сигнала окно эфира узнаёт о начале трансляции сразу. Без него
    // оставалось расписание: вне эфира канал опрашивается раз в пятнадцать
    // минут, и ровно столько стример ждал отметки «в эфире».
    await connectTwitch();
    await manager.reconcile();
    await until(() => fake.subscriptions.length === 9);

    const seen: BusMessage[] = [];
    const unsubscribe = await harness.app.get(RealtimeBus).subscribe((message) => {
      seen.push(message);
    });
    try {
      fake.notify('stream.online', { type: 'live' });
      await until(() => seen.some((message) => message.kind === 'channel-live'));

      expect(seen.find((message) => message.kind === 'channel-live')).toMatchObject({
        userId,
        platform: 'twitch',
        isLive: true,
      });
      // В истории событий ему делать нечего: ни автора, ни суммы.
      expect(await harness.prisma.alertEvent.count()).toBe(0);
    } finally {
      await unsubscribe();
    }
  });

  it('переезд по session_reconnect не пересоздаёт подписки и не теряет события', async () => {
    await connectTwitch();
    await manager.reconcile();
    await until(() => fake.subscriptions.length === 9);

    fake.askToReconnect();
    // Новый сокет поздоровался — старый закрыт, живой остаётся один.
    await until(() => fake.openConnections === 1);
    fake.notify('channel.subscribe', { user_name: 'Подписчик', is_gift: false });
    await until(async () => (await harness.prisma.alertEvent.count()) === 1);
    expect(fake.subscriptions).toHaveLength(9);
  });

  it('отзыв доступа стримером переводит канал в «нужен повторный вход» и закрывает соединение', async () => {
    await connectTwitch();
    await manager.reconcile();
    await until(() => fake.subscriptions.length === 9);

    fake.revoke('authorization_revoked');
    await until(async () => {
      const channel = await harness.prisma.channel.findFirst({ where: { userId } });
      return channel?.syncState === 'AUTH_EXPIRED';
    });
    await until(() => manager.activeCount === 0 && fake.openConnections === 0);

    // Сверка не поднимает соединение заново, пока стример не переподключит Twitch.
    await manager.reconcile();
    expect(manager.activeCount).toBe(0);
  });
});
