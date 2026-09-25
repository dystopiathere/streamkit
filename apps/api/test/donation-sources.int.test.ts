import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type WebSocket as ServerSocket, WebSocketServer } from 'ws';
import { ConnectorManager } from '../src/modules/integrations/connector-manager.service';
import { DonationConnectorsModule } from '../src/modules/integrations/integrations.module';
import { createHarness, registrationPayload, type TestHarness } from './harness';

/**
 * Поддельный DonationAlerts по их документации: OAuth, профиль, подпись
 * приватного канала и Centrifugo на том же порту. Весь путь — кнопка
 * «Подключить», возврат, сокет в воркере, донат в ленте — идёт по настоящему
 * HTTP и WebSocket, как у чата Twitch.
 */
class FakeDonationAlerts {
  readonly server: Server;
  private readonly sockets = new WebSocketServer({ noServer: true });
  readonly connections: ServerSocket[] = [];
  revoked = false;
  profileEmail = 'streamer-private@example.com';

  constructor() {
    this.server = createServer((req, res) => void this.route(req, res));
    this.server.on('upgrade', (req, socket, head) => {
      this.sockets.handleUpgrade(req, socket, head, (ws) => this.accept(ws));
    });
  }

  get baseUrl(): string {
    return `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
  }

  get socketUrl(): string {
    return `ws://127.0.0.1:${(this.server.address() as AddressInfo).port}/connection/websocket`;
  }

  publish(donation: Record<string, unknown>): void {
    const frame = JSON.stringify({
      result: { channel: '$alerts:donation_777', data: { seq: 1, data: donation } },
    });
    for (const socket of this.connections) socket.send(frame);
  }

  dropConnections(): void {
    for (const socket of this.connections.splice(0)) socket.terminate();
  }

  private accept(socket: ServerSocket): void {
    this.connections.push(socket);
    socket.on('close', () => {
      const index = this.connections.indexOf(socket);
      if (index >= 0) this.connections.splice(index, 1);
    });
    socket.on('message', (data) => {
      const frame = JSON.parse(String(data)) as {
        id: number;
        method?: number;
        params?: Record<string, string>;
      };
      if (frame.id === 1 && frame.params?.token === 'socket-token') {
        socket.send(JSON.stringify({ id: 1, result: { client: 'client-1' } }));
      } else if (frame.method === 1 && frame.params?.token === 'channel-token') {
        socket.send(JSON.stringify({ id: frame.id, result: {} }));
      }
    });
  }

  private async route(
    req: IncomingMessage,
    res: import('node:http').ServerResponse,
  ): Promise<void> {
    const body = await readBody(req);
    const json = (status: number, payload: unknown) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(payload));
    };
    const bearer = req.headers.authorization === 'Bearer da-access' && !this.revoked;

    if (req.method === 'POST' && req.url === '/oauth/token') {
      const form = new URLSearchParams(body);
      if (form.get('grant_type') === 'authorization_code' && form.get('code') === 'good-code') {
        return json(200, {
          token_type: 'Bearer',
          access_token: 'da-access',
          refresh_token: 'da-refresh',
          expires_in: 3600,
        });
      }
      return json(400, { error: 'invalid_grant' });
    }
    if (req.method === 'GET' && req.url === '/api/v1/user/oauth') {
      if (!bearer) return json(401, { message: 'Unauthenticated.' });
      return json(200, {
        data: {
          id: 777,
          code: 'streamer',
          name: 'Стример DA',
          email: this.profileEmail,
          socket_connection_token: 'socket-token',
        },
      });
    }
    if (req.method === 'POST' && req.url === '/api/v1/centrifuge/subscribe') {
      if (!bearer) return json(401, { message: 'Unauthenticated.' });
      const { channels, client } = JSON.parse(body) as { channels: string[]; client: string };
      if (client !== 'client-1') return json(422, { message: 'bad client' });
      return json(200, {
        channels: channels.map((channel) => ({ channel, token: 'channel-token' })),
      });
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

describe('Донат-сервисы: DonationAlerts (feature)', () => {
  const fake = new FakeDonationAlerts();
  let harness: TestHarness;
  let manager: ConnectorManager;
  let accessToken: string;
  let userId: string;

  beforeAll(async () => {
    await new Promise<void>((resolve) => fake.server.listen(0, '127.0.0.1', resolve));
    // Окружение — до старта приложения: конфигурация читается при инициализации.
    process.env.DONATIONALERTS_CLIENT_ID = 'da-client';
    process.env.DONATIONALERTS_CLIENT_SECRET = 'da-secret';
    process.env.DONATIONALERTS_BASE_URL = fake.baseUrl;
    process.env.DONATIONALERTS_SOCKET_URL = fake.socketUrl;
    harness = await createHarness([DonationConnectorsModule]);
    manager = harness.app.get(ConnectorManager);
  });

  afterAll(async () => {
    // Сначала соединения, потом приложение: иначе таймер переподключения
    // переживёт тест и подвесит прогон.
    await manager.onApplicationShutdown();
    await harness.close();
    fake.dropConnections();
    await new Promise<void>((resolve) => fake.server.close(() => resolve()));
    for (const key of [
      'DONATIONALERTS_CLIENT_ID',
      'DONATIONALERTS_CLIENT_SECRET',
      'DONATIONALERTS_BASE_URL',
      'DONATIONALERTS_SOCKET_URL',
    ]) {
      delete process.env[key];
    }
  });

  beforeEach(async () => {
    await manager.onApplicationShutdown();
    fake.dropConnections();
    fake.revoked = false;
    await harness.reset();
    const registration = await request(server())
      .post('/api/auth/register')
      .send(registrationPayload())
      .expect(201);
    accessToken = registration.body.accessToken as string;
    userId = registration.body.user.id as string;
  });

  const server = () => harness.app.getHttpServer();
  const auth = () => ({ Authorization: `Bearer ${accessToken}` });

  /** «Подключить» и возврат из DonationAlerts тем же браузером. */
  async function connect(): Promise<string> {
    const authorize = await request(server())
      .post('/api/integrations/donations/donationalerts/authorize')
      .set(auth())
      .expect(201);
    const url = new URL(authorize.body.url as string);
    expect(url.origin + url.pathname).toBe(`${fake.baseUrl}/oauth/authorize`);
    expect(url.searchParams.get('scope')).toBe('oauth-user-show oauth-donation-subscribe');
    const state = url.searchParams.get('state')!;

    const callback = await request(server())
      .get(`/api/integrations/donations/donationalerts/callback?code=good-code&state=${state}`)
      .set('Cookie', `sk_oauth_state=${state}`)
      .expect(302);
    return callback.headers.location as string;
  }

  it('подключение показывает аккаунт и не хранит его почту', async () => {
    const before = await request(server())
      .get('/api/integrations/donations')
      .set(auth())
      .expect(200);
    expect(before.body.services[0]).toMatchObject({
      service: 'donationalerts',
      isConfigured: true,
      isConnected: false,
    });

    expect(await connect()).toContain('/account/sources?service=donationalerts&status=connected');

    const after = await request(server())
      .get('/api/integrations/donations')
      .set(auth())
      .expect(200);
    expect(after.body.services[0]).toMatchObject({
      isConnected: true,
      isEnabled: true,
      accountName: 'Стример DA',
      disabledReason: null,
    });

    const source = await harness.prisma.donationSource.findFirstOrThrow({ where: { userId } });
    const credential = await harness.prisma.integrationCredential.findFirstOrThrow({
      where: { userId, provider: 'donationalerts' },
    });
    expect(JSON.stringify(source)).not.toContain(fake.profileEmail);
    // Токен — только шифротекстом.
    expect(credential.accessTokenEncrypted).not.toContain('da-access');
  });

  it('возврат без cookie браузера, начавшего подключение, ничего не подключает', async () => {
    const authorize = await request(server())
      .post('/api/integrations/donations/donationalerts/authorize')
      .set(auth())
      .expect(201);
    const state = new URL(authorize.body.url as string).searchParams.get('state')!;

    const callback = await request(server())
      .get(`/api/integrations/donations/donationalerts/callback?code=good-code&state=${state}`)
      .expect(302);
    expect(callback.headers.location).toContain('status=failed');
    expect(await harness.prisma.donationSource.count({ where: { userId } })).toBe(0);
  });

  it('воркер подключается к сокету, и донат попадает в ленту один раз', async () => {
    await connect();
    await manager.reconcile();
    await until(() => fake.connections.length === 1);
    // Подписка — после ответа на подключение; публикуем, когда она прошла.
    await new Promise((resolve) => setTimeout(resolve, 150));

    const donation = {
      id: 5001,
      username: 'Зритель',
      message: 'Привет',
      amount: 150.5,
      currency: 'RUB',
    };
    fake.publish(donation);
    fake.publish(donation);

    await until(async () => (await harness.prisma.alertEvent.count({ where: { userId } })) === 1);
    await new Promise((resolve) => setTimeout(resolve, 200));
    const events = await harness.prisma.alertEvent.findMany({ where: { userId } });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      provider: 'DONATIONALERTS',
      externalId: '5001',
      username: 'Зритель',
      amountMinor: 15_050,
      currency: 'RUB',
    });
  });

  it('отозванный доступ выключает источник с причиной, видной стримеру', async () => {
    await connect();
    await manager.reconcile();
    await until(() => fake.connections.length === 1);

    fake.revoked = true;
    fake.dropConnections();

    await until(async () => {
      const source = await harness.prisma.donationSource.findFirst({ where: { userId } });
      return source?.isEnabled === false;
    });
    const list = await request(server()).get('/api/integrations/donations').set(auth()).expect(200);
    expect(list.body.services[0]).toMatchObject({ isConnected: true, isEnabled: false });
    expect(list.body.services[0].disabledReason).toMatch(/подключите аккаунт заново/);
    expect(manager.activeCount).toBe(0);

    // Повторное подключение чинит источник.
    fake.revoked = false;
    await connect();
    const fixed = await request(server())
      .get('/api/integrations/donations')
      .set(auth())
      .expect(200);
    expect(fixed.body.services[0]).toMatchObject({ isEnabled: true, disabledReason: null });
  });

  it('отключение убирает источник и токены, воркер закрывает сокет', async () => {
    await connect();
    await manager.reconcile();
    await until(() => fake.connections.length === 1);

    await request(server())
      .delete('/api/integrations/donations/donationalerts')
      .set(auth())
      .expect(204);
    await manager.reconcile();

    expect(manager.activeCount).toBe(0);
    await until(() => fake.connections.length === 0);
    expect(
      await harness.prisma.integrationCredential.count({
        where: { userId, provider: 'donationalerts' },
      }),
    ).toBe(0);
    const list = await request(server()).get('/api/integrations/donations').set(auth()).expect(200);
    expect(list.body.services[0]).toMatchObject({ isConnected: false });
  });

  it('неизвестный сервис — 400, чужой не подключить без входа', async () => {
    await request(server())
      .post('/api/integrations/donations/donatepay/authorize')
      .set(auth())
      .expect(400);
    await request(server()).get('/api/integrations/donations').expect(401);
  });
});

/**
 * Поддельный DonatePay по поведению боевого API и их документации: ключ —
 * параметром `access_token`, отвергнутый ключ — 200 со `status: "error"`,
 * транзакции с `after` и `order`, время — `DateTime` PHP в московской зоне;
 * токены сокета и Centrifugo на том же порту, канал `$public:<id>`.
 */
class FakeDonatePay {
  readonly server: Server;
  private readonly sockets = new WebSocketServer({ noServer: true });
  readonly connections: ServerSocket[] = [];
  readonly subscribedChannels: string[] = [];
  readonly donations: Array<Record<string, unknown>> = [];
  readonly requests: URL[] = [];
  /** Ключ API каждого запроса — из адреса или тела. */
  readonly keys: string[] = [];
  validKey = 'dp-key';

  constructor() {
    this.server = createServer((req, res) => void this.route(req, res));
    this.server.on('upgrade', (req, socket, head) => {
      this.sockets.handleUpgrade(req, socket, head, (ws) => this.accept(ws));
    });
  }

  get baseUrl(): string {
    return `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
  }

  get socketUrl(): string {
    return `ws://127.0.0.1:${(this.server.address() as AddressInfo).port}/connection/websocket`;
  }

  /** Донат, пришедший `agoMs` назад. */
  add(id: number, overrides: Record<string, unknown> = {}, agoMs = 1_000): void {
    const moscow = new Date(Date.now() - agoMs + 3 * 3_600_000).toISOString();
    this.donations.unshift({
      id,
      what: 'Зритель DP',
      sum: '250.50',
      to_cash: '238.00',
      to_pay: '250.50',
      commission: '12.50',
      status: 'success',
      type: 'donation',
      vars: { name: 'Зритель DP', comment: 'Привет из DonatePay', user_ip: '203.0.113.7' },
      comment: 'Привет из DonatePay',
      created_at: {
        date: `${moscow.slice(0, 10)} ${moscow.slice(11, 19)}.000000`,
        timezone_type: 3,
        timezone: 'Europe/Moscow',
      },
      ...overrides,
    });
  }

  /** Сообщение в канал — содержимое коннектор не читает, только сигнал. */
  publish(): void {
    const frame = JSON.stringify({
      result: { channel: '$public:4242', data: { data: { notification: { type: 'donation' } } } },
    });
    for (const socket of this.connections) socket.send(frame);
  }

  dropConnections(): void {
    for (const socket of this.connections.splice(0)) socket.terminate();
  }

  private accept(socket: ServerSocket): void {
    this.connections.push(socket);
    socket.on('close', () => {
      const index = this.connections.indexOf(socket);
      if (index >= 0) this.connections.splice(index, 1);
    });
    socket.on('message', (data) => {
      const frame = JSON.parse(String(data)) as {
        id: number;
        method?: number;
        params?: Record<string, string>;
      };
      if (frame.id === 1 && frame.params?.token === 'dp-socket-token') {
        socket.send(JSON.stringify({ id: 1, result: { client: 'dp-client' } }));
      } else if (frame.method === 1 && frame.params?.token === 'dp-channel-token') {
        this.subscribedChannels.push(frame.params.channel ?? '');
        socket.send(JSON.stringify({ id: frame.id, result: {} }));
      }
    });
  }

  private async route(
    req: IncomingMessage,
    res: import('node:http').ServerResponse,
  ): Promise<void> {
    const url = new URL(req.url ?? '/', this.baseUrl);
    const raw = await readBody(req);
    const body = (raw ? JSON.parse(raw) : {}) as Record<string, unknown>;
    this.requests.push(url);
    const json = (payload: unknown) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(payload));
    };
    const key =
      url.searchParams.get('access_token') ??
      (typeof body.access_token === 'string' ? body.access_token : null);
    if (!key) return json({ status: 'error', message: 'Empty token' });
    this.keys.push(key);
    if (key !== this.validKey) return json({ status: 'error', message: 'Incorrect token' });

    if (req.method === 'GET' && url.pathname === '/api/v1/user') {
      return json({
        status: 'success',
        data: { id: 4242, name: 'Стример DP', avatar: null, balance: 1500, cashout_sum: 0 },
      });
    }
    if (req.method === 'GET' && url.pathname === '/api/v1/transactions') {
      const limit = Math.min(Number(url.searchParams.get('limit') ?? 25), 100);
      const after = Number(url.searchParams.get('after') ?? 0);
      const ascending = url.searchParams.get('order') === 'ASC';
      const data = this.donations
        .filter((item) => Number(item.id) > after)
        .sort((left, right) => (Number(left.id) - Number(right.id)) * (ascending ? 1 : -1))
        .slice(0, limit);
      return json({ status: 'success', count: data.length, data });
    }
    if (req.method === 'POST' && url.pathname === '/api/v2/socket/token') {
      // Подписка на канал — как её шлёт centrifuge-js: ключ в адресе, клиент и каналы в теле.
      if (Array.isArray(body.channels)) {
        if (body.client !== 'dp-client') return json({ status: 'error', message: 'bad client' });
        return json({
          channels: (body.channels as string[]).map((channel) => ({
            channel,
            token: channel === '$public:4242' ? 'dp-channel-token' : 'foreign',
          })),
        });
      }
      return json({ token: 'dp-socket-token' });
    }
    res.writeHead(404);
    res.end();
  }
}

describe('Донат-сервисы: DonatePay (feature)', () => {
  const fake = new FakeDonatePay();
  let harness: TestHarness;
  let manager: ConnectorManager;
  let accessToken: string;
  let userId: string;

  beforeAll(async () => {
    await new Promise<void>((resolve) => fake.server.listen(0, '127.0.0.1', resolve));
    process.env.DONATEPAY_BASE_URL = fake.baseUrl;
    process.env.DONATEPAY_SOCKET_URL = fake.socketUrl;
    harness = await createHarness([DonationConnectorsModule]);
    manager = harness.app.get(ConnectorManager);
  });

  afterAll(async () => {
    await manager.onApplicationShutdown();
    await harness.close();
    await new Promise<void>((resolve) => fake.server.close(() => resolve()));
    delete process.env.DONATEPAY_BASE_URL;
    delete process.env.DONATEPAY_SOCKET_URL;
  });

  beforeEach(async () => {
    await manager.onApplicationShutdown();
    fake.dropConnections();
    fake.donations.length = 0;
    fake.requests.length = 0;
    fake.keys.length = 0;
    fake.subscribedChannels.length = 0;
    fake.validKey = 'dp-key';
    await harness.reset();
    const registration = await request(server())
      .post('/api/auth/register')
      .send(registrationPayload())
      .expect(201);
    accessToken = registration.body.accessToken as string;
    userId = registration.body.user.id as string;
  });

  const server = () => harness.app.getHttpServer();
  const auth = () => ({ Authorization: `Bearer ${accessToken}` });
  const donatePay = async () =>
    (await request(server()).get('/api/integrations/donations').set(auth()).expect(200)).body
      .services[1];
  const transactionPolls = () =>
    fake.requests.filter((url) => url.pathname === '/api/v1/transactions').length;

  function connect(apiKey = 'dp-key'): request.Test {
    return request(server())
      .post('/api/integrations/donations/donatepay/key')
      .set(auth())
      .send({ apiKey: `  ${apiKey}  ` });
  }

  /**
   * Опрос — раз в двадцать секунд, и ждать его тест не станет: перезапуск
   * воркера опрашивает сразу, а слот опроса снимается, как если бы шаг прошёл.
   * Заодно это проверяет, что курсор переживает перезапуск.
   */
  async function pollNow(): Promise<void> {
    await manager.onApplicationShutdown();
    await harness.redis.del(`streamkit:donatepay:poll:${userId}`);
    const before = transactionPolls();
    await manager.reconcile();
    await until(() => transactionPolls() > before);
    // Разбор страницы и запись события — после ответа.
    await new Promise((resolve) => setTimeout(resolve, 150));
  }

  it('подключается ключом API, показывает аккаунт и хранит ключ только шифротекстом', async () => {
    expect(await donatePay()).toMatchObject({
      service: 'donatepay',
      connection: 'api_key',
      isConfigured: true,
      isConnected: false,
    });

    await connect().expect(204);

    expect(await donatePay()).toMatchObject({
      isConnected: true,
      isEnabled: true,
      accountName: 'Стример DP',
      disabledReason: null,
    });
    const credential = await harness.prisma.integrationCredential.findFirstOrThrow({
      where: { userId, provider: 'donatepay' },
    });
    expect(credential.accessTokenEncrypted).not.toContain('dp-key');
    const source = await harness.prisma.donationSource.findFirstOrThrow({ where: { userId } });
    expect(source).toMatchObject({ provider: 'DONATEPAY', externalAccountId: '4242' });
    // Баланс из профиля не сохраняется.
    expect(JSON.stringify(source)).not.toContain('1500');
  });

  it('неверный ключ — 400 с подсказкой, источник не заводится', async () => {
    const response = await connect('wrong-key').expect(400);
    expect(response.body.message).toMatch(/не принял ключ API/);
    await connect('   ').expect(400);
    expect(await harness.prisma.donationSource.count({ where: { userId } })).toBe(0);
    expect(await harness.prisma.integrationCredential.count({ where: { userId } })).toBe(0);
  });

  it('OAuth у DonatePay нет, а ключ не принимается у DonationAlerts', async () => {
    await request(server())
      .post('/api/integrations/donations/donatepay/authorize')
      .set(auth())
      .expect(400);
    await request(server())
      .post('/api/integrations/donations/donationalerts/key')
      .set(auth())
      .send({ apiKey: 'dp-key' })
      .expect(400);
  });

  it('воркер не показывает историю, а новый донат попадает в ленту один раз', async () => {
    fake.add(100, {}, 3_600_000);
    await connect().expect(204);

    await pollNow();
    expect(await harness.prisma.alertEvent.count({ where: { userId } })).toBe(0);

    fake.add(101);
    await pollNow();
    await pollNow();

    const events = await harness.prisma.alertEvent.findMany({ where: { userId } });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      provider: 'DONATEPAY',
      externalId: '101',
      username: 'Зритель DP',
      message: 'Привет из DonatePay',
      amountMinor: 25_050,
      currency: 'RUB',
    });
    expect(Math.abs(events[0]!.occurredAt.getTime() - (Date.now() - 1_000))).toBeLessThan(10_000);
    // Ключ уходит только DonatePay, и транзакции спрашиваются после курсора.
    expect(fake.keys.every((key) => key === 'dp-key')).toBe(true);
    const lastPoll = fake.requests.filter((url) => url.pathname === '/api/v1/transactions').at(-1)!;
    expect(Object.fromEntries(lastPoll.searchParams)).toMatchObject({
      after: '101',
      order: 'ASC',
      limit: '100',
    });
  });

  it('сообщение сокета забирает донат сразу, без ожидания шага опроса', async () => {
    await connect().expect(204);
    await pollNow();
    await until(() => fake.subscribedChannels.includes('$public:4242'));

    fake.add(301);
    fake.add(302, { status: 'user', what: 'Тест из кабинета' });
    // Слот опроса свободен, как через двадцать секунд после прошлого опроса.
    await harness.redis.del(`streamkit:donatepay:poll:${userId}`);
    fake.publish();

    await until(async () => (await harness.prisma.alertEvent.count({ where: { userId } })) === 2);
    const events = await harness.prisma.alertEvent.findMany({
      where: { userId },
      orderBy: { externalId: 'asc' },
    });
    expect(events.map((event) => [event.externalId, event.isTest, event.username])).toEqual([
      ['301', false, 'Зритель DP'],
      ['302', true, 'Тест из кабинета'],
    ]);
  });

  it('после обрыва сокет подписывается заново', async () => {
    await connect().expect(204);
    await manager.reconcile();
    await until(() => fake.subscribedChannels.length === 1);

    fake.dropConnections();
    await until(() => fake.subscribedChannels.length === 2);
    expect(fake.subscribedChannels).toEqual(['$public:4242', '$public:4242']);
  });

  it('донат, ждавший оплаты, показывается, когда станет успешным', async () => {
    await connect().expect(204);
    await pollNow();

    fake.add(201, { status: 'wait' });
    fake.add(202);
    await pollNow();
    expect(
      (await harness.prisma.alertEvent.findMany({ where: { userId } })).map((e) => e.externalId),
    ).toEqual(['202']);

    fake.donations.find((item) => item.id === 201)!.status = 'success';
    await pollNow();
    const ids = (await harness.prisma.alertEvent.findMany({ where: { userId } }))
      .map((e) => e.externalId)
      .sort();
    expect(ids).toEqual(['201', '202']);
  });

  it('отозванный ключ выключает источник с причиной, новый ключ его чинит', async () => {
    await connect().expect(204);
    fake.validKey = 'rotated-key';
    // Отказ приходит первым — от опроса или от токена сокета.
    await manager.reconcile();

    await until(async () => {
      const source = await harness.prisma.donationSource.findFirst({ where: { userId } });
      return source?.isEnabled === false;
    });
    const broken = await donatePay();
    expect(broken).toMatchObject({ isConnected: true, isEnabled: false });
    expect(broken.disabledReason).toMatch(/вставьте новый ключ/);
    expect(manager.activeCount).toBe(0);

    await connect('rotated-key').expect(204);
    expect(await donatePay()).toMatchObject({ isEnabled: true, disabledReason: null });
  });

  it('отключение убирает источник и ключ, воркер перестаёт опрашивать', async () => {
    await connect().expect(204);
    await manager.reconcile();
    expect(manager.activeCount).toBe(1);

    await request(server()).delete('/api/integrations/donations/donatepay').set(auth()).expect(204);
    await manager.reconcile();

    expect(manager.activeCount).toBe(0);
    expect(
      await harness.prisma.integrationCredential.count({
        where: { userId, provider: 'donatepay' },
      }),
    ).toBe(0);
    expect(await donatePay()).toMatchObject({ isConnected: false });
  });
});
