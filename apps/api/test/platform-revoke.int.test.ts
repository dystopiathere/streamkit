import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { CryptoService } from '../src/common/crypto/crypto.service';
import { PrivacyService } from '../src/modules/privacy/privacy.service';
import { createHarness, registrationPayload, type TestHarness } from './harness';

/** Поддельный Google: эндпоинт отзыва запоминает, какие токены ему прислали. */
class FakeGoogleRevoke {
  readonly server: Server;
  readonly revoked: string[] = [];
  /** Чем отвечать: 200 — отозвано, 400 — «токен уже недействителен». */
  status = 200;

  constructor() {
    this.server = createServer((req, res) => {
      void readBody(req).then((body) => {
        if (req.method === 'POST' && req.url === '/revoke') {
          this.revoked.push(new URLSearchParams(body).get('token') ?? '');
          res.writeHead(this.status);
          res.end();
          return;
        }
        res.writeHead(404);
        res.end();
      });
    });
  }

  get url(): string {
    return `http://127.0.0.1:${(this.server.address() as AddressInfo).port}/revoke`;
  }
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (chunk: Buffer) => (body += chunk.toString()));
    req.on('end', () => resolve(body));
  });
}

/**
 * Отвязка площадки и удаление аккаунта отзывают доступ у самой площадки.
 *
 * Раньше удалялись только наши копии токенов: разрешение приложения оставалось
 * в аккаунте Google человека, пока он сам не найдёт и не снимет его.
 */
describe('Отзыв доступа к площадке (feature)', () => {
  const google = new FakeGoogleRevoke();
  let harness: TestHarness;
  let accessToken: string;
  let userId: string;

  beforeAll(async () => {
    await new Promise<void>((resolve) => google.server.listen(0, '127.0.0.1', resolve));
    // Окружение — до старта приложения: конфигурация читается при инициализации.
    process.env.YOUTUBE_REVOKE_URL = google.url;
    // Площадка без ключей приложения в реестре не числится, и отзывать было бы
    // некому: на проде ключи есть всегда, раз канал вообще подключился.
    process.env.YOUTUBE_CLIENT_ID = 'test-client';
    process.env.YOUTUBE_CLIENT_SECRET = 'test-secret';
    harness = await createHarness();
  });

  afterAll(async () => {
    await harness.close();
    for (const key of ['YOUTUBE_REVOKE_URL', 'YOUTUBE_CLIENT_ID', 'YOUTUBE_CLIENT_SECRET']) {
      delete process.env[key];
    }
    await new Promise<void>((resolve) => google.server.close(() => resolve()));
  });

  beforeEach(async () => {
    await harness.reset();
    google.revoked.length = 0;
    google.status = 200;
    const registration = await request(harness.app.getHttpServer())
      .post('/api/auth/register')
      .send(registrationPayload())
      .expect(201);
    accessToken = registration.body.accessToken as string;
    userId = registration.body.user.id as string;
  });

  async function connectYouTube(): Promise<string> {
    const crypto = harness.app.get(CryptoService);
    await harness.prisma.integrationCredential.create({
      data: {
        userId,
        provider: 'youtube',
        accessTokenEncrypted: crypto.encrypt('yt-access'),
        refreshTokenEncrypted: crypto.encrypt('yt-refresh'),
        scopes: ['https://www.googleapis.com/auth/youtube.readonly'],
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      },
    });
    const channel = await harness.prisma.channel.create({
      data: {
        userId,
        platform: 'YOUTUBE',
        externalId: 'UC' + 'r'.repeat(22),
        login: '@streamer',
        displayName: 'Стример',
      },
    });
    return channel.id;
  }

  it('отвязка YouTube отзывает разрешение у Google — refresh-токеном', async () => {
    // Refresh, а не access: access к моменту отвязки мог истечь, а отзыв по
    // refresh снимает разрешение целиком.
    const channelId = await connectYouTube();

    await request(harness.app.getHttpServer())
      .delete(`/api/channels/${channelId}`)
      .set({ Authorization: `Bearer ${accessToken}` })
      .expect(204);

    expect(google.revoked).toEqual(['yt-refresh']);
    expect(await harness.prisma.integrationCredential.count()).toBe(0);
  });

  it('отказ Google в отзыве не мешает отвязке', async () => {
    // Человек мог сам снять разрешение в аккаунте Google: тогда отзыв ответит
    // 400, а отвязка обязана пройти — иначе он заперт в интеграции.
    google.status = 400;
    const channelId = await connectYouTube();

    await request(harness.app.getHttpServer())
      .delete(`/api/channels/${channelId}`)
      .set({ Authorization: `Bearer ${accessToken}` })
      .expect(204);

    expect(google.revoked).toHaveLength(1);
    expect(await harness.prisma.channel.count()).toBe(0);
    expect(await harness.prisma.integrationCredential.count()).toBe(0);
  });

  it('канал, подключённый и к другому аккаунту, при отвязке не отзывается', async () => {
    // Отзыв снимает разрешение у аккаунта Google целиком: второй аккаунт у нас,
    // подключивший тот же канал, остался бы без чата и метрик.
    const channelId = await connectYouTube();
    const other = await request(harness.app.getHttpServer())
      .post('/api/auth/register')
      .send(registrationPayload())
      .expect(201);
    await harness.prisma.channel.create({
      data: {
        userId: other.body.user.id as string,
        platform: 'YOUTUBE',
        externalId: 'UC' + 'r'.repeat(22),
        login: '@streamer',
        displayName: 'Стример',
      },
    });

    await request(harness.app.getHttpServer())
      .delete(`/api/channels/${channelId}`)
      .set({ Authorization: `Bearer ${accessToken}` })
      .expect(204);

    expect(google.revoked).toEqual([]);
    // Свои копии токенов всё равно удалены.
    expect(await harness.prisma.integrationCredential.count({ where: { userId } })).toBe(0);
  });

  it('удаление аккаунта тоже отзывает доступ к YouTube', async () => {
    await connectYouTube();

    await harness.app.get(PrivacyService).anonymize(userId);

    expect(google.revoked).toEqual(['yt-refresh']);
    expect(await harness.prisma.integrationCredential.count()).toBe(0);
  });
});
