import { createHmac } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createHarness, registrationPayload, type TestHarness } from './harness';

/**
 * Права субъекта персональных данных.
 *
 * Проверяется не «ручка ответила 204», а то, что после удаления учётной записи
 * система действительно перестаёт собирать данные: включённый источник донатов
 * переживал обезличивание и продолжал писать имена и сообщения донатеров.
 */
describe('Приватность и удаление аккаунта (feature)', () => {
  let harness: TestHarness;
  let accessToken: string;

  beforeAll(async () => {
    harness = await createHarness();
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await harness.reset();
    const registration = await request(harness.app.getHttpServer())
      .post('/api/auth/register')
      .send(registrationPayload())
      .expect(201);
    accessToken = registration.body.accessToken as string;
  });

  const server = () => harness.app.getHttpServer();
  const auth = () => ({ Authorization: `Bearer ${accessToken}` });

  function sign(secret: string, timestamp: string, body: string): string {
    return createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
  }

  async function deleteAccount(): Promise<void> {
    await request(server())
      .delete('/api/privacy/account')
      .set(auth())
      .send({ confirmation: 'УДАЛИТЬ' })
      .expect(204);
  }

  it('после удаления аккаунта вебхук перестаёт принимать события', async () => {
    const source = await request(server())
      .post('/api/events/webhook/secret')
      .set(auth())
      .expect(201);
    const { sourceId, secret } = source.body as { sourceId: string; secret: string };

    const send = () => {
      const body = JSON.stringify({ externalId: 'evt-after-delete', username: 'Зритель' });
      const timestamp = Math.floor(Date.now() / 1000).toString();
      return request(server())
        .post(`/api/webhooks/${sourceId}`)
        .set('Content-Type', 'application/json')
        .set('x-streamkit-timestamp', timestamp)
        .set('x-streamkit-signature', sign(secret, timestamp, body))
        .send(body);
    };

    await send().expect(202);
    await deleteAccount();

    // Подпись прежняя и по-прежнему верная — но источник обязан молчать.
    await send().expect(401);
    expect(await harness.prisma.alertEvent.count()).toBe(1);
  });

  it('удаление аккаунта стирает секрет источника, а не только выключает его', async () => {
    await request(server()).post('/api/events/webhook/secret').set(auth()).expect(201);
    await deleteAccount();

    const sources = await harness.prisma.donationSource.findMany();
    expect(sources).toHaveLength(1);
    expect(sources[0]?.isEnabled).toBe(false);
    expect(sources[0]?.webhookSecretEncrypted).toBeNull();
  });

  it('удаление аккаунта освобождает подключённый канал площадки', async () => {
    const user = await harness.prisma.user.findFirstOrThrow({ where: { status: 'ACTIVE' } });
    await harness.prisma.channel.create({
      data: {
        userId: user.id,
        platform: 'TWITCH',
        externalId: '1234567',
        login: 'streamer',
        displayName: 'Стример',
      },
    });

    await deleteAccount();

    // Строка канала не должна пережить аккаунт: иначе тот же канал нельзя
    // подключить заново — ни этому пользователю, ни кому-либо ещё.
    expect(await harness.prisma.channel.count()).toBe(0);
  });

  it('обезличивает профиль, но сохраняет историю событий', async () => {
    await request(server()).post('/api/events/test').set(auth()).expect(201);
    await deleteAccount();

    const user = await harness.prisma.user.findFirstOrThrow();
    expect(user.status).toBe('ANONYMIZED');
    expect(user.email).toMatch(/@streamkit\.invalid$/);
    expect(user.anonymizedAt).not.toBeNull();

    const events = await harness.prisma.alertEvent.findMany();
    expect(events).toHaveLength(1);
    expect(events[0]?.username).toBe('Аноним');
    expect(events[0]?.message).toBe('');
  });

  it('выгрузка данных не содержит ни хэшей, ни шифротекстов', async () => {
    const response = await request(server()).get('/api/privacy/export').set(auth()).expect(200);

    const serialized = JSON.stringify(response.body);
    expect(serialized).not.toContain('passwordHash');
    expect(serialized).not.toContain('totpSecretEncrypted');
    expect(serialized).not.toContain('webhookSecretEncrypted');
  });
});
