import { createHash, generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { ChatMessage } from '@streamkit/contracts';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type BusMessage, RealtimeBus } from '../src/common/bus/realtime-bus.service';
import { PresenceService } from '../src/common/redis/presence.service';
import { ChatManager } from '../src/modules/chat/chat-manager.service';
import { ChatModule } from '../src/modules/chat/chat.module';
import { ConnectorManager } from '../src/modules/integrations/connector-manager.service';
import { DonationConnectorsModule } from '../src/modules/integrations/integrations.module';
import { KICK_ALERT_EVENTS, KICK_SCOPES } from '../src/modules/integrations/kick.provider';
import { createHarness, registrationPayload, type TestHarness } from './harness';

const BROADCASTER = 123456789;

/**
 * Поддельный Kick: вход (OAuth 2.1 с PKCE) и публичный API по документации
 * `docs.kick.com` — профиль, канал, подписки на события, отзыв токена.
 *
 * Код обменивается на токен, только если `code_verifier` сходится с
 * `code_challenge` из ссылки входа: так проверяется, что PKCE доезжает от
 * ссылки до обмена через state, а не просто присутствует в запросах.
 */
class FakeKick {
  readonly server: Server;
  challenge: string | null = null;
  subscriptions: Array<{ id: string; event: string; broadcaster_user_id: number }> = [];
  revoked: string[] = [];
  private seq = 0;

  constructor() {
    this.server = createServer((req, res) => void this.route(req, res));
  }

  get origin(): string {
    return `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
  }

  reset(): void {
    this.challenge = null;
    this.subscriptions = [];
    this.revoked = [];
  }

  private async route(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = await readBody(req);
    const url = new URL(req.url ?? '/', this.origin);
    const json = (status: number, payload: unknown) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(payload));
    };

    if (req.method === 'POST' && url.pathname === '/oauth/token') {
      const form = new URLSearchParams(body);
      if (form.get('grant_type') !== 'authorization_code') return json(400, { error: 'grant' });
      const verifier = form.get('code_verifier') ?? '';
      const expected = createHash('sha256').update(verifier).digest('base64url');
      if (
        !this.challenge ||
        expected !== this.challenge ||
        form.get('client_secret') !== 'k-secret'
      ) {
        return json(400, { error: 'Invalid request' });
      }
      return json(200, {
        access_token: 'kick-access',
        token_type: 'Bearer',
        refresh_token: 'kick-refresh',
        // Строкой — как в примере документации.
        expires_in: '7200',
        scope: KICK_SCOPES.join(' '),
      });
    }
    if (req.method === 'POST' && url.pathname === '/oauth/revoke') {
      this.revoked.push(url.searchParams.get('token') ?? '');
      res.writeHead(200);
      return res.end('OK');
    }

    if (req.headers.authorization !== 'Bearer kick-access')
      return json(401, { message: 'Unauthorized' });

    if (req.method === 'GET' && url.pathname === '/public/v1/users') {
      return json(200, {
        data: [{ user_id: BROADCASTER, name: 'Стример', profile_picture: '' }],
        message: 'OK',
      });
    }
    if (req.method === 'GET' && url.pathname === '/public/v1/channels') {
      return json(200, {
        data: [
          {
            broadcaster_user_id: BROADCASTER,
            slug: 'streamer-kick',
            stream_title: 'Эфир',
            category: { id: 1, name: 'Just Chatting', thumbnail: '' },
            stream: { is_live: true, viewer_count: 42, start_time: '2026-09-25T10:00:00Z' },
            active_subscribers_count: 7,
          },
        ],
        message: 'OK',
      });
    }
    if (url.pathname === '/public/v1/events/subscriptions') {
      if (req.method === 'GET') {
        const broadcaster = Number(url.searchParams.get('broadcaster_user_id'));
        return json(200, {
          data: this.subscriptions
            .filter((subscription) => subscription.broadcaster_user_id === broadcaster)
            .map((subscription) => ({ ...subscription, version: 1, app_id: 'app' })),
          message: 'OK',
        });
      }
      if (req.method === 'POST') {
        const request = JSON.parse(body) as {
          broadcaster_user_id: number;
          events: Array<{ name: string; version: number }>;
          method: string;
        };
        const data = request.events.map((event) => {
          this.seq += 1;
          const id = `sub-${this.seq}`;
          this.subscriptions.push({
            id,
            event: event.name,
            broadcaster_user_id: request.broadcaster_user_id,
          });
          return { name: event.name, version: event.version, subscription_id: id };
        });
        return json(200, { data, message: 'OK' });
      }
      if (req.method === 'DELETE') {
        const ids = new Set(url.searchParams.getAll('id'));
        this.subscriptions = this.subscriptions.filter((subscription) => !ids.has(subscription.id));
        res.writeHead(204);
        return res.end();
      }
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

/** Подпись вебхука — тем же способом, что у Kick, но своим ключом. */
const keys = generateKeyPairSync('rsa', { modulusLength: 2048 });

function signedWebhook(
  type: string,
  payload: Record<string, unknown>,
  options: { messageId?: string; timestamp?: string; key?: typeof keys.privateKey } = {},
): { headers: Record<string, string>; body: string } {
  const messageId = options.messageId ?? randomUUID();
  const timestamp = options.timestamp ?? new Date().toISOString();
  const body = JSON.stringify(payload);
  const signature = sign(
    'sha256',
    Buffer.from(`${messageId}.${timestamp}.${body}`),
    options.key ?? keys.privateKey,
  ).toString('base64');
  return {
    body,
    headers: {
      'Content-Type': 'application/json',
      'Kick-Event-Message-Id': messageId,
      'Kick-Event-Subscription-Id': 'sub',
      'Kick-Event-Signature': signature,
      'Kick-Event-Message-Timestamp': timestamp,
      'Kick-Event-Type': type,
      'Kick-Event-Version': '1',
    },
  };
}

const broadcaster = { is_anonymous: false, user_id: BROADCASTER, username: 'streamer-kick' };

/**
 * Kick целиком: вход с PKCE, вебхуки с подписью, подписки на события из
 * воркера и чат по подписке.
 */
describe('Kick (feature)', () => {
  const fake = new FakeKick();
  let harness: TestHarness;
  let manager: ConnectorManager;
  let chat: ChatManager;
  let accessToken: string;
  let userId: string;

  const server = () => harness.app.getHttpServer();
  const auth = () => ({ Authorization: `Bearer ${accessToken}` });

  beforeAll(async () => {
    await new Promise<void>((resolve) => fake.server.listen(0, '127.0.0.1', resolve));
    process.env.KICK_CLIENT_ID = 'k-client';
    process.env.KICK_CLIENT_SECRET = 'k-secret';
    process.env.KICK_AUTH_URL = fake.origin;
    process.env.KICK_API_URL = fake.origin;
    process.env.KICK_WEBHOOK_PUBLIC_KEY = keys.publicKey
      .export({ type: 'spki', format: 'pem' })
      .toString()
      // Одной строкой, как ключ лежит в переменной окружения на сервере.
      .replace(/\n/g, '\\n');
    // Чат Twitch в этом прогоне не нужен: закрытый порт вместо боевого IRC.
    process.env.TWITCH_IRC_URL = 'ws://127.0.0.1:9';
    harness = await createHarness([DonationConnectorsModule, ChatModule]);
    manager = harness.app.get(ConnectorManager);
    chat = harness.app.get(ChatManager);
  });

  afterAll(async () => {
    await manager.onApplicationShutdown();
    await chat.onApplicationShutdown();
    await harness.close();
    await new Promise<void>((resolve) => fake.server.close(() => resolve()));
    for (const key of [
      'KICK_CLIENT_ID',
      'KICK_CLIENT_SECRET',
      'KICK_AUTH_URL',
      'KICK_API_URL',
      'KICK_WEBHOOK_PUBLIC_KEY',
      'TWITCH_IRC_URL',
    ]) {
      delete process.env[key];
    }
  });

  beforeEach(async () => {
    await manager.onApplicationShutdown();
    await chat.onApplicationShutdown();
    fake.reset();
    await harness.reset();
    const registration = await request(server())
      .post('/api/auth/register')
      .send(registrationPayload())
      .expect(201);
    accessToken = registration.body.accessToken as string;
    userId = registration.body.user.id as string;
  });

  /** Подключение через интерфейс: ссылка входа → возврат с кодом. */
  async function connectKick(): Promise<void> {
    const authorize = await request(server())
      .post('/api/integrations/kick/authorize')
      .set(auth())
      .expect(201);
    const url = new URL(authorize.body.url as string);
    expect(url.origin + url.pathname).toBe(`${fake.origin}/oauth/authorize`);
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    fake.challenge = url.searchParams.get('code_challenge');
    const state = url.searchParams.get('state')!;

    const callback = await request(server())
      .get(`/api/integrations/kick/callback?code=code&state=${state}`)
      .set('Cookie', `sk_oauth_state=${state}`)
      .expect(302);
    expect(callback.headers.location).toContain('status=connected');
  }

  function postWebhook(signed: { headers: Record<string, string>; body: string }) {
    return request(server())
      .post('/api/integrations/kick/webhook')
      .set(signed.headers)
      .send(signed.body);
  }

  it('подключается по OAuth с PKCE: канал по адресу kick.com, токен со сроком', async () => {
    await connectKick();

    const channel = await harness.prisma.channel.findFirstOrThrow({ where: { userId } });
    expect(channel).toMatchObject({
      platform: 'KICK',
      externalId: String(BROADCASTER),
      login: 'streamer-kick',
      displayName: 'Стример',
    });
    const credential = await harness.prisma.integrationCredential.findFirstOrThrow({
      where: { userId, provider: 'kick' },
    });
    // Срок пришёл строкой, и он всё равно срок: иначе токен ни разу не продлился бы.
    expect(credential.expiresAt).not.toBeNull();

    const list = await request(server()).get('/api/integrations').set(auth()).expect(200);
    expect(list.body).toContainEqual({
      platform: 'kick',
      title: 'Kick',
      isConfigured: true,
      isConnected: true,
    });
  });

  it('подключённый со всеми правами Kick не просит переподключения', async () => {
    // Права Kick не попадали в выборку прав, и карточка просила переподключить
    // площадку сразу после подключения — с текстом про Twitch.
    await connectKick();

    const channels = await request(server()).get('/api/channels').set(auth()).expect(200);
    expect(channels.body).toHaveLength(1);
    expect(channels.body[0]).toMatchObject({ platform: 'kick', needsReconnect: false });
  });

  it('без того же code_verifier код не меняется: подключение не проходит', async () => {
    const authorize = await request(server())
      .post('/api/integrations/kick/authorize')
      .set(auth())
      .expect(201);
    const state = new URL(authorize.body.url as string).searchParams.get('state')!;
    fake.challenge = 'чужой-challenge';
    const callback = await request(server())
      .get(`/api/integrations/kick/callback?code=code&state=${state}`)
      .set('Cookie', `sk_oauth_state=${state}`)
      .expect(302);
    expect(callback.headers.location).toContain('status=failed');
    expect(await harness.prisma.channel.count()).toBe(0);
  });

  it('воркер подписывает канал на события один раз, повторная сверка дублей не создаёт', async () => {
    await connectKick();
    await manager.reconcile();
    await until(() => fake.subscriptions.length === KICK_ALERT_EVENTS.length);
    expect(fake.subscriptions.map((subscription) => subscription.event).sort()).toEqual(
      [...KICK_ALERT_EVENTS].sort(),
    );

    await manager.onApplicationShutdown();
    // Остановка подписки не снимает: её зовут и при каждом деплое воркера.
    expect(fake.subscriptions).toHaveLength(KICK_ALERT_EVENTS.length);
    await manager.reconcile();
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(fake.subscriptions).toHaveLength(KICK_ALERT_EVENTS.length);
  });

  it('вебхук с подписью Kick становится оповещением, повтор доставки — нет', async () => {
    await connectKick();
    const follow = signedWebhook(
      'channel.followed',
      { broadcaster, follower: { is_anonymous: false, user_id: 5, username: 'Новый зритель' } },
      { messageId: 'same-delivery' },
    );
    await postWebhook(follow).expect(200);
    await postWebhook(follow).expect(200);

    const events = await harness.prisma.alertEvent.findMany();
    expect(events.map((event) => [event.type, event.provider, event.username])).toEqual([
      ['FOLLOW', 'KICK', 'Новый зритель'],
    ]);
  });

  it('KICKs записываются своим типом с количеством', async () => {
    await connectKick();
    await postWebhook(
      signedWebhook('kicks.gifted', {
        broadcaster,
        sender: { user_id: 7, username: 'Щедрый' },
        gift: { amount: 500, name: 'Rage Quit', type: 'LEVEL_UP', tier: 'MID', message: 'gg' },
        created_at: '2026-09-25T10:00:00Z',
      }),
    ).expect(200);

    const events = await harness.prisma.alertEvent.findMany();
    expect(events.map((event) => [event.type, event.username, event.count, event.message])).toEqual(
      [['KICKS', 'Щедрый', 500, 'gg']],
    );
  });

  it('чужая подпись — 401 и запись в аудит, события нет', async () => {
    await connectKick();
    const forged = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const signed = signedWebhook(
      'channel.followed',
      { broadcaster, follower: { user_id: 5, username: 'Подделка' } },
      { key: forged.privateKey },
    );
    await postWebhook(signed).expect(401);
    expect(await harness.prisma.alertEvent.count()).toBe(0);
    expect(
      await harness.prisma.auditLog.count({ where: { action: 'webhook.signature.invalid' } }),
    ).toBe(1);
  });

  it('событие выключенного канала отбрасывается: гейт тарифа держит и вебхук', async () => {
    await connectKick();
    await harness.prisma.channel.updateMany({ where: { userId }, data: { isEnabled: false } });
    const response = await postWebhook(
      signedWebhook('channel.followed', {
        broadcaster,
        follower: { user_id: 5, username: 'Зритель' },
      }),
    ).expect(200);
    expect(response.body).toEqual({ status: 'ignored' });
    expect(await harness.prisma.alertEvent.count()).toBe(0);
  });

  it('начало эфира уходит сигналом сбору метрик, а не в историю', async () => {
    await connectKick();
    const seen: BusMessage[] = [];
    const unsubscribe = await harness.app.get(RealtimeBus).subscribe((message) => {
      seen.push(message);
    });
    try {
      await postWebhook(
        signedWebhook('livestream.status.updated', {
          broadcaster,
          is_live: true,
          title: 'Эфир',
          started_at: '2026-09-25T10:00:00Z',
          ended_at: null,
        }),
      ).expect(200);
      await until(() => seen.some((message) => message.kind === 'channel-live'));
      expect(seen.find((message) => message.kind === 'channel-live')).toMatchObject({
        userId,
        platform: 'kick',
        isLive: true,
      });
      expect(await harness.prisma.alertEvent.count()).toBe(0);
    } finally {
      await unsubscribe();
    }
  });

  it('чат читается, только пока канал в составе: подписка создаётся и снимается', async () => {
    await connectKick();
    const presence = harness.app.get(PresenceService);
    const bus = harness.app.get(RealtimeBus);
    const published: ChatMessage[] = [];
    const unsubscribe = await bus.subscribe((message) => {
      if (message.kind === 'chat') published.push(message.message);
    });

    const chatLine = (text: string, id: string) =>
      signedWebhook('chat.message.sent', {
        message_id: id,
        broadcaster,
        sender: { is_anonymous: false, user_id: 77, username: 'зритель', identity: null },
        content: text,
        emotes: [],
        created_at: new Date().toISOString(),
      });

    try {
      await presence.watchChats([{ platform: 'kick', channel: String(BROADCASTER) }]);
      await chat.tick();
      await until(() => fake.subscriptions.some((s) => s.event === 'chat.message.sent'));

      await postWebhook(chatLine('привет [emote:37226:KEKW]', 'line-1')).expect(200);
      await until(() => published.length === 1);
      expect(published[0]).toMatchObject({
        platform: 'kick',
        channel: String(BROADCASTER),
        login: '77',
        username: 'зритель',
        parts: [{ kind: 'text', value: 'привет KEKW' }],
      });

      // Окно закрыли — канал отпускается, подписка на чат удаляется у Kick.
      await harness.redis.del('streamkit:presence:chat-watch');
      await chat.tick();
      await until(() => !fake.subscriptions.some((s) => s.event === 'chat.message.sent'));

      await postWebhook(chatLine('уже никто не смотрит', 'line-2')).expect(200);
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(published).toHaveLength(1);
    } finally {
      await unsubscribe();
    }
  });

  it('отвязка снимает подписки и отзывает доступ у Kick', async () => {
    await connectKick();
    await manager.reconcile();
    await until(() => fake.subscriptions.length === KICK_ALERT_EVENTS.length);

    const channel = await harness.prisma.channel.findFirstOrThrow({ where: { userId } });
    await request(server()).delete(`/api/channels/${channel.id}`).set(auth()).expect(204);

    expect(fake.subscriptions).toEqual([]);
    expect(fake.revoked).toEqual(['kick-refresh']);
  });
});
