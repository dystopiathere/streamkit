import { createHmac } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MaintenanceModule } from '../src/modules/maintenance/maintenance.module';
import { MaintenanceService } from '../src/modules/maintenance/maintenance.service';
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
    harness = await createHarness([MaintenanceModule]);
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
      .send({ confirmation: 'УДАЛИТЬ', password: registrationPayload().password })
      .expect(204);
  }

  it('документ без опубликованного текста не показывается и не принимается', async () => {
    const consents = await request(server()).get('/api/privacy/consents').set(auth()).expect(200);
    expect(consents.body.map((consent: { document: string }) => consent.document)).not.toContain(
      'MARKETING',
    );
    await request(server())
      .post('/api/privacy/consents')
      .set(auth())
      .send({ document: 'MARKETING' })
      .expect(400);
  });

  it('новая редакция не закрывает доступ, а «ознакомлен» отмечает её в журнале', async () => {
    // Правила приняты регистрацией: об изменениях уведомляют, а не требуют
    // подписать заново. Отметка в журнале всё равно нужна — уведомление должно
    // быть доказуемым.
    await harness.prisma.consent.updateMany({
      where: { document: 'TERMS' },
      data: { documentVersion: 'old-edition' },
    });

    const before = await request(server()).get('/api/privacy/consents').set(auth()).expect(200);
    const terms = (before.body as Array<Record<string, unknown>>).find(
      (consent) => consent.document === 'TERMS',
    );
    expect(terms).toMatchObject({ needsRenewal: true, updatePolicy: 'notify' });

    // Доступ не зависит от отметки: обычная ручка дашборда отвечает как обычно.
    await request(server()).get('/api/widgets').set(auth()).expect(200);

    const result = await request(server())
      .post('/api/privacy/consents/acknowledge')
      .set(auth())
      .expect(200);
    expect(result.body.acknowledged).toBe(1);

    const after = await request(server()).get('/api/privacy/consents').set(auth()).expect(200);
    expect(
      (after.body as Array<Record<string, unknown>>).every((consent) => !consent.needsRenewal),
    ).toBe(true);
  });

  it('согласие на обработку ПДн просят подтвердить заново: молчание согласием не является', async () => {
    const consents = await request(server()).get('/api/privacy/consents').set(auth()).expect(200);
    const byDocument = new Map(
      (consents.body as Array<{ document: string; updatePolicy: string }>).map((consent) => [
        consent.document,
        consent.updatePolicy,
      ]),
    );
    expect(byDocument.get('PERSONAL_DATA')).toBe('reconsent');
    expect(byDocument.get('COOKIE_ANALYTICS')).toBe('reconsent');
    expect(byDocument.get('PRIVACY')).toBe('notify');
  });

  it('журнал согласий удаляется через три года после удаления аккаунта, но не раньше', async () => {
    await deleteAccount();
    const maintenance = harness.app.get(MaintenanceService);

    expect(await maintenance.purgeExpiredConsents(3 * 365)).toBe(0);
    await harness.prisma.user.updateMany({
      data: { anonymizedAt: new Date(Date.now() - 4 * 365 * 24 * 60 * 60 * 1000) },
    });
    expect(await maintenance.purgeExpiredConsents(3 * 365)).toBeGreaterThan(0);
    expect(await harness.prisma.consent.count()).toBe(0);
  });

  it('не удаляет аккаунт без верного пароля', async () => {
    for (const body of [
      { confirmation: 'УДАЛИТЬ' },
      { confirmation: 'УДАЛИТЬ', password: 'не тот' },
    ]) {
      await request(server()).delete('/api/privacy/account').set(auth()).send(body).expect(400);
    }
    await request(server()).get('/api/auth/me').set(auth()).expect(200);
  });

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

  it('удаление аккаунта стирает источники донатов вместе с секретом, а не только выключает их', async () => {
    await request(server()).post('/api/events/webhook/secret').set(auth()).expect(201);
    await deleteAccount();

    expect(await harness.prisma.donationSource.count()).toBe(0);
  });

  it('удаление аккаунта стирает виджеты: в настройках ники зрителей', async () => {
    const user = await harness.prisma.user.findFirstOrThrow({ where: { status: 'ACTIVE' } });
    await harness.prisma.channel.create({
      data: {
        userId: user.id,
        platform: 'TWITCH',
        externalId: '1',
        login: 'streamer',
        displayName: 'Стример',
      },
    });
    const widget = await request(server())
      .post('/api/widgets')
      .set(auth())
      .send({ name: 'Чат', type: 'chat', config: { hiddenUsers: ['viewer'] } })
      .expect(201);
    await request(server())
      .post(`/api/widgets/${(widget.body as { id: string }).id}/tokens`)
      .set(auth())
      .send({})
      .expect(201);

    await deleteAccount();

    expect(await harness.prisma.widget.count()).toBe(0);
    expect(await harness.prisma.overlayToken.count()).toBe(0);
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
    // Голосовой донат: ссылка на запись — такие же данные донатера, как имя.
    await harness.prisma.alertEvent.updateMany({
      data: { audioUrl: 'https://cdn.donationalerts.ru/voice/1.mp3' },
    });
    await deleteAccount();

    const user = await harness.prisma.user.findFirstOrThrow();
    expect(user.status).toBe('ANONYMIZED');
    expect(user.email).toMatch(/@streamkit\.invalid$/);
    expect(user.anonymizedAt).not.toBeNull();

    const events = await harness.prisma.alertEvent.findMany();
    expect(events).toHaveLength(1);
    expect(events[0]?.username).toBe('Аноним');
    expect(events[0]?.message).toBe('');
    expect(events[0]?.audioUrl).toBeNull();
  });

  it('выгрузка данных не содержит ни хэшей, ни шифротекстов', async () => {
    const response = await request(server()).get('/api/privacy/export').set(auth()).expect(200);

    const serialized = JSON.stringify(response.body);
    expect(serialized).not.toContain('passwordHash');
    expect(serialized).not.toContain('totpSecretEncrypted');
    expect(serialized).not.toContain('webhookSecretEncrypted');
  });
});
