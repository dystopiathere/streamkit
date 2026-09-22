import { createHmac } from 'node:crypto';
import { defaultAlertWidgetConfig } from '@streamkit/contracts';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { WidgetsService } from '../src/modules/widgets/widgets.service';
import { createHarness, registrationPayload, type TestHarness } from './harness';

/**
 * Сквозной путь события: виджет → публичная ссылка → вебхук → история.
 * Проверяется то, ради чего существует продукт, и то, что ломается тише всего:
 * дедупликация и проверка подписи.
 */
describe('Виджеты и приём событий (feature)', () => {
  let harness: TestHarness;
  let accessToken: string;
  let userId: string;

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
    userId = registration.body.user.id as string;
  });

  const server = () => harness.app.getHttpServer();
  const auth = () => ({ Authorization: `Bearer ${accessToken}` });

  async function createWidget(): Promise<string> {
    const response = await request(server())
      .post('/api/widgets')
      .set(auth())
      .send({ name: 'Алерты', type: 'alerts', config: defaultAlertWidgetConfig() })
      .expect(201);
    return response.body.id as string;
  }

  async function createWebhookSource(): Promise<{ sourceId: string; secret: string }> {
    const response = await request(server())
      .post('/api/events/webhook/secret')
      .set(auth())
      .expect(201);
    return response.body as { sourceId: string; secret: string };
  }

  function sign(secret: string, timestamp: string, body: string): string {
    return createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
  }

  it('создаёт виджет с полным набором дефолтов конфига', async () => {
    const widgetId = await createWidget();
    const response = await request(server())
      .get(`/api/widgets/${widgetId}`)
      .set(auth())
      .expect(200);

    // Сценарий на каждый тип события, у каждого — свои дефолты.
    expect(response.body.config.scenarios.donation.durationMs).toBe(6000);
    expect(response.body.config.scenarios.donation.text.fontSize).toBe(32);
    expect(response.body.config.scenarios.follow.titleTemplate).not.toContain('{amount}');
  });

  it('новый виджет получает окно 800 × 600, а «не задано» переживает правку', async () => {
    // Окно — размер браузер-сорса, в котором рисуется виджет. У виджетов,
    // настроенных раньше, миграция пишет null — «растягивать на весь сорс», —
    // и правка других полей не должна подменять его окном по умолчанию.
    const widgetId = await createWidget();
    const created = await request(server()).get(`/api/widgets/${widgetId}`).set(auth()).expect(200);
    expect(created.body.config.canvas).toEqual({ width: 800, height: 600 });

    await harness.prisma.$executeRaw`
      UPDATE "Widget" SET "config" = jsonb_set("config", '{canvas}', 'null'::jsonb)
      WHERE "id" = ${widgetId}::uuid`;
    await request(server())
      .patch(`/api/widgets/${widgetId}`)
      .set(auth())
      .send({ config: { gapMs: 700 } })
      .expect(200);
    const legacy = await request(server()).get(`/api/widgets/${widgetId}`).set(auth()).expect(200);
    expect(legacy.body.config.canvas).toBeNull();

    await request(server())
      .patch(`/api/widgets/${widgetId}`)
      .set(auth())
      .send({ config: { canvas: { width: 50, height: 600 } } })
      .expect(400);
  });

  it('мержит частичное обновление конфига, не теряя остальные поля', async () => {
    const widgetId = await createWidget();

    await request(server())
      .patch(`/api/widgets/${widgetId}`)
      .set(auth())
      .send({ config: { scenarios: { donation: { durationMs: 9000 } } } })
      .expect(200);
    await request(server())
      .patch(`/api/widgets/${widgetId}`)
      .set(auth())
      .send({ config: { scenarios: { donation: { text: { fontSize: 64 } } } } })
      .expect(200);

    const response = await request(server())
      .get(`/api/widgets/${widgetId}`)
      .set(auth())
      .expect(200);

    const donation = response.body.config.scenarios.donation;
    expect(donation.text.fontSize).toBe(64);
    // Остальное не обнулилось: ни соседние поля стиля, ни прежняя правка
    // сценария, ни соседние сценарии.
    expect(donation.text.color).toBe('#FFFFFF');
    expect(donation.durationMs).toBe(9000);
    expect(response.body.config.scenarios.follow.durationMs).toBe(6000);
  });

  it('создаёт виджет каждого типа с его собственными дефолтами', async () => {
    // До этого этапа тип в сервисе был зашит литералом 'ALERTS', а схема
    // конфига — единственной. Проверяем, что тип действительно доезжает до БД
    // и обратно, а не подменяется алертами по дороге.
    for (const [type, probe] of [
      ['goal', (config: Record<string, unknown>) => expect(config.targetMinor).toBe(1_000_000)],
      ['timer', (config: Record<string, unknown>) => expect(config.initialSeconds).toBe(3600)],
      ['top-donors', (config: Record<string, unknown>) => expect(config.limit).toBe(5)],
    ] as const) {
      const created = await request(server())
        .post('/api/widgets')
        .set(auth())
        .send({ name: `Виджет ${type}`, type, config: {} })
        .expect(201);

      const response = await request(server())
        .get(`/api/widgets/${created.body.id as string}`)
        .set(auth())
        .expect(200);

      expect(response.body.type).toBe(type);
      probe(response.body.config as Record<string, unknown>);
    }
  });

  it('накладывает патч на схему сохранённого типа, а не на схему алертов', async () => {
    const created = await request(server())
      .post('/api/widgets')
      .set(auth())
      .send({ name: 'Марафон', type: 'timer', config: {} })
      .expect(201);
    const widgetId = created.body.id as string;

    await request(server())
      .patch(`/api/widgets/${widgetId}`)
      .set(auth())
      .send({ config: { secondsPerUnit: 5 } })
      .expect(200);

    const response = await request(server())
      .get(`/api/widgets/${widgetId}`)
      .set(auth())
      .expect(200);
    expect(response.body.config.secondsPerUnit).toBe(5);
    expect(response.body.config.initialSeconds).toBe(3600);
  });

  it('отвергает патч, ломающий конфиг сохранённого типа', async () => {
    const created = await request(server())
      .post('/api/widgets')
      .set(auth())
      .send({ name: 'Цель', type: 'goal', config: {} })
      .expect(201);

    await request(server())
      .patch(`/api/widgets/${created.body.id as string}`)
      .set(auth())
      .send({ config: { targetMinor: -1 } })
      .expect(400);
  });

  it('раскладка события не видит виджеты других типов', async () => {
    // Иначе shouldShowAlert прочитал бы у конфига цели поле scenarios,
    // которого там нет, и первый же донат уронил бы обработчик шины —
    // а вместе с ним доставку алертов ВСЕМ виджетам этого стримера.
    const alerts = await createWidget();
    await request(server())
      .post('/api/widgets')
      .set(auth())
      .send({ name: 'Цель', type: 'goal', config: {} })
      .expect(201);

    const widgets = harness.app.get(WidgetsService);
    const targets = await widgets.findDispatchTargets(userId);

    expect(targets).toHaveLength(1);
    expect(targets[0]?.widgetId).toBe(alerts);
    expect(targets[0]?.config.scenarios.donation).toBeDefined();
  });

  it('тестовое событие — по сценарию: у рейда число зрителей, у доната сумма', async () => {
    const raid = await request(server())
      .post('/api/events/test')
      .set(auth())
      .send({ type: 'raid' })
      .expect(201);
    expect(raid.body).toMatchObject({ type: 'raid', isTest: true, amount: null, count: 42 });

    // Без тела — донат, как с кнопки на странице виджетов.
    const donation = await request(server()).post('/api/events/test').set(auth()).expect(201);
    expect(donation.body).toMatchObject({ type: 'donation', count: null });
    expect(donation.body.amount).not.toBeNull();
  });

  it('не отдаёт чужой виджет', async () => {
    const widgetId = await createWidget();

    const other = await request(server())
      .post('/api/auth/register')
      .send(registrationPayload())
      .expect(201);

    // 404, а не 403: иначе по коду ответа можно перебирать существующие id.
    await request(server())
      .get(`/api/widgets/${widgetId}`)
      .set({ Authorization: `Bearer ${other.body.accessToken as string}` })
      .expect(404);
  });

  it('выдаёт ссылку для OBS и хранит только её хэш', async () => {
    const widgetId = await createWidget();

    const response = await request(server())
      .post(`/api/widgets/${widgetId}/tokens`)
      .set(auth())
      .send({ label: 'OBS' })
      .expect(201);

    expect(response.body.url).toContain('token=');

    const rawToken = new URL(response.body.url as string).searchParams.get('token') as string;
    const stored = await harness.prisma.overlayToken.findMany({ where: { widgetId } });

    expect(stored).toHaveLength(1);
    expect(stored[0]?.tokenHash).not.toContain(rawToken);
  });

  it('принимает корректно подписанный вебхук', async () => {
    const { sourceId, secret } = await createWebhookSource();
    const body = JSON.stringify({
      externalId: 'evt-1',
      username: 'Зритель',
      message: 'Спасибо',
      amount: { amountMinor: 50_000, currency: 'RUB' },
    });
    const timestamp = Math.floor(Date.now() / 1000).toString();

    const response = await request(server())
      .post(`/api/webhooks/${sourceId}`)
      .set('Content-Type', 'application/json')
      .set('x-streamkit-timestamp', timestamp)
      .set('x-streamkit-signature', sign(secret, timestamp, body))
      .send(body)
      .expect(202);

    expect(response.body.status).toBe('created');

    const events = await harness.prisma.alertEvent.findMany();
    expect(events).toHaveLength(1);
    expect(events[0]?.amountMinor).toBe(50_000);
  });

  it('отвергает вебхук с неверной подписью и пишет это в аудит', async () => {
    const { sourceId } = await createWebhookSource();
    const body = JSON.stringify({ externalId: 'evt-2', username: 'Злоумышленник' });
    const timestamp = Math.floor(Date.now() / 1000).toString();

    await request(server())
      .post(`/api/webhooks/${sourceId}`)
      .set('Content-Type', 'application/json')
      .set('x-streamkit-timestamp', timestamp)
      .set('x-streamkit-signature', 'a'.repeat(64))
      .send(body)
      .expect(401);

    expect(await harness.prisma.alertEvent.count()).toBe(0);

    const audit = await harness.prisma.auditLog.findMany({
      where: { action: 'webhook.signature.invalid' },
    });
    expect(audit.length).toBeGreaterThan(0);
  });

  it('отвергает вебхук без заголовков подписи', async () => {
    const { sourceId } = await createWebhookSource();
    await request(server())
      .post(`/api/webhooks/${sourceId}`)
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ externalId: 'evt-3', username: 'Зритель' }))
      .expect(401);
  });

  it('отвергает запрос с просроченной меткой времени', async () => {
    const { sourceId, secret } = await createWebhookSource();
    const body = JSON.stringify({ externalId: 'evt-4', username: 'Зритель' });
    // Час назад: подпись верная, но окно давно закрылось.
    const timestamp = (Math.floor(Date.now() / 1000) - 3600).toString();

    await request(server())
      .post(`/api/webhooks/${sourceId}`)
      .set('Content-Type', 'application/json')
      .set('x-streamkit-timestamp', timestamp)
      .set('x-streamkit-signature', sign(secret, timestamp, body))
      .send(body)
      .expect(401);
  });

  it('повтор того же подписанного запроса — дубль, а не отказ в подписи', async () => {
    const { sourceId, secret } = await createWebhookSource();
    const body = JSON.stringify({ externalId: 'evt-5', username: 'Зритель' });
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const signature = sign(secret, timestamp, body);

    const send = () =>
      request(server())
        .post(`/api/webhooks/${sourceId}`)
        .set('Content-Type', 'application/json')
        .set('x-streamkit-timestamp', timestamp)
        .set('x-streamkit-signature', signature)
        .send(body);

    await send().expect(202);
    // Отправитель, не дождавшийся ответа, повторяет запрос как есть. Второго
    // алерта быть не должно, но и 401 тоже: иначе интегратор ищет ошибку в
    // секрете, а донат, упавший на нашем сбое, теряется.
    const second = await send().expect(202);
    expect(second.body.status).toBe('duplicate');

    expect(await harness.prisma.alertEvent.count()).toBe(1);
  });

  it('дедуплицирует событие с тем же externalId, пришедшее заново', async () => {
    const { sourceId, secret } = await createWebhookSource();
    const body = JSON.stringify({ externalId: 'evt-6', username: 'Зритель' });

    const send = () => {
      const timestamp = Math.floor(Date.now() / 1000).toString();
      return request(server())
        .post(`/api/webhooks/${sourceId}`)
        .set('Content-Type', 'application/json')
        .set('x-streamkit-timestamp', timestamp)
        .set('x-streamkit-signature', sign(secret, timestamp, body))
        .send(body);
    };

    await send().expect(202);

    // Сбрасываем Redis: имитируем перезапуск кэша. Дубль обязан пойматься
    // уникальным индексом в PostgreSQL — это вторая линия защиты.
    await harness.redis.flushdb();

    const second = await send().expect(202);
    expect(second.body.status).toBe('duplicate');
    expect(await harness.prisma.alertEvent.count()).toBe(1);
  });

  it('на верную подпись с невалидным телом отвечает 400, а не 500', async () => {
    const { sourceId, secret } = await createWebhookSource();
    // Тело — валидный JSON, но amount прислан числом вместо объекта.
    const body = JSON.stringify({ externalId: 'evt-bad', username: 'Зритель', amount: 500 });
    const timestamp = Math.floor(Date.now() / 1000).toString();

    const response = await request(server())
      .post(`/api/webhooks/${sourceId}`)
      .set('Content-Type', 'application/json')
      .set('x-streamkit-timestamp', timestamp)
      .set('x-streamkit-signature', sign(secret, timestamp, body))
      .send(body);

    // 500 отправил бы добросовестного интегратора в очередь ретраев с тем же
    // битым телом вместо того, чтобы он починил формат.
    expect(response.status).toBe(400);
    expect(response.body.errors).toBeDefined();
    expect(await harness.prisma.alertEvent.count()).toBe(0);
  });

  it('отзыв ссылки делает её нерабочей', async () => {
    const widgetId = await createWidget();
    const created = await request(server())
      .post(`/api/widgets/${widgetId}/tokens`)
      .set(auth())
      .send({ label: null })
      .expect(201);

    await request(server())
      .delete(`/api/widgets/${widgetId}/tokens/${created.body.id as string}`)
      .set(auth())
      .expect(204);

    const tokens = await request(server())
      .get(`/api/widgets/${widgetId}/tokens`)
      .set(auth())
      .expect(200);

    expect(tokens.body).toHaveLength(0);
  });

  it('тестовый алерт сохраняется с пометкой и виден в истории', async () => {
    await request(server()).post('/api/events/test').set(auth()).expect(201);

    const history = await request(server()).get('/api/events').set(auth()).expect(200);

    expect(history.body.items).toHaveLength(1);
    expect(history.body.items[0].isTest).toBe(true);
  });

  it('позволяет отправить несколько тестовых алертов подряд', async () => {
    await request(server()).post('/api/events/test').set(auth()).expect(201);
    await request(server()).post('/api/events/test').set(auth()).expect(201);

    // Если бы externalId был одинаковым, второй алерт отбросился бы дедупликацией,
    // и стример решил бы, что настройка сломалась.
    expect(await harness.prisma.alertEvent.count()).toBe(2);
  });

  it('тестовый алерт — на языке дашборда: он уходит в OBS', async () => {
    const english = await request(server())
      .post('/api/events/test')
      .set(auth())
      .send({ language: 'en' })
      .expect(201);
    expect(english.body.username).toBe('Test viewer');

    // Без тела — как раньше, по-русски: Express 5 оставляет body пустым.
    const russian = await request(server()).post('/api/events/test').set(auth()).expect(201);
    expect(russian.body.username).toBe('Тестовый зритель');

    await request(server())
      .post('/api/events/test')
      .set(auth())
      .send({ language: 'de' })
      .expect(400);
  });
});
