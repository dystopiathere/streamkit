import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type BusMessage, RealtimeBus } from '../src/common/bus/realtime-bus.service';
import { createHarness, registrationPayload, type TestHarness } from './harness';

/**
 * Состояние виджетов: цель, таймер, топ донатеров.
 *
 * События засеиваются прямо в БД: проверяется то, что считается на нашей
 * стороне — фильтр по валюте, дате старта и типу события, — а не приём вебхука.
 */
describe('Состояние виджетов (feature)', () => {
  let harness: TestHarness;
  let accessToken: string;
  let userId: string;
  let seq = 0;

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

  async function createWidget(type: string, config: Record<string, unknown> = {}): Promise<string> {
    const response = await request(server())
      .post('/api/widgets')
      .set(auth())
      .send({ name: `Виджет ${type}`, type, config })
      .expect(201);
    return response.body.id as string;
  }

  async function seedDonation(
    amountMinor: number,
    options: {
      currency?: string;
      username?: string;
      daysAgo?: number;
      isTest?: boolean;
      type?: 'DONATION' | 'SUBSCRIPTION';
    } = {},
  ): Promise<void> {
    seq += 1;
    const at = new Date(Date.now() - (options.daysAgo ?? 0) * 24 * 60 * 60 * 1000);
    await harness.prisma.alertEvent.create({
      data: {
        userId,
        type: options.type ?? 'DONATION',
        provider: 'WEBHOOK',
        externalId: `seed-${seq}`,
        username: options.username ?? 'Зритель',
        message: '',
        amountMinor,
        currency: options.currency ?? 'RUB',
        isTest: options.isTest ?? false,
        occurredAt: at,
        createdAt: at,
      },
    });
  }

  it('считает собранное по цели из истории донатов', async () => {
    const widgetId = await createWidget('goal', { targetMinor: 100_000 });
    await seedDonation(30_000);
    await seedDonation(20_000);

    const response = await request(server())
      .get(`/api/widgets/${widgetId}/state`)
      .set(auth())
      .expect(200);

    expect(response.body.kind).toBe('goal');
    expect(response.body.raisedMinor).toBe(50_000);
    expect(response.body.targetMinor).toBe(100_000);
  });

  it('засчитывает в цель несколько типов событий сразу', async () => {
    // Марафон обычно наполняют и донаты, и платные подписки. Схема массив
    // поддерживала с самого начала — ограничение было только в форме.
    const widgetId = await createWidget('goal', {
      countTypes: ['donation', 'subscription'],
    });
    await seedDonation(30_000, { type: 'DONATION' });
    await seedDonation(20_000, { type: 'SUBSCRIPTION' });

    const response = await request(server())
      .get(`/api/widgets/${widgetId}/state`)
      .set(auth())
      .expect(200);
    expect(response.body.raisedMinor).toBe(50_000);
  });

  it('не засчитывает событие типа, который не отмечен', async () => {
    const widgetId = await createWidget('goal', { countTypes: ['donation'] });
    await seedDonation(30_000, { type: 'DONATION' });
    await seedDonation(20_000, { type: 'SUBSCRIPTION' });

    const response = await request(server())
      .get(`/api/widgets/${widgetId}/state`)
      .set(auth())
      .expect(200);
    expect(response.body.raisedMinor).toBe(30_000);
  });

  it('не смешивает валюты в цели', async () => {
    // Сложить рубли с долларами нельзя, а пересчёт по курсу менял бы собранное
    // задним числом вслед за курсом.
    const widgetId = await createWidget('goal', { currency: 'RUB' });
    await seedDonation(30_000, { currency: 'RUB' });
    await seedDonation(99_000, { currency: 'USD' });

    const response = await request(server())
      .get(`/api/widgets/${widgetId}/state`)
      .set(auth())
      .expect(200);
    expect(response.body.raisedMinor).toBe(30_000);
  });

  it('не засчитывает донаты, пришедшие до начала цели', async () => {
    await seedDonation(50_000, { daysAgo: 30 });
    // Виджет создаётся сейчас — значит и отсчёт начинается сейчас, иначе цель
    // оказалась бы выполненной ещё до первого доната.
    const widgetId = await createWidget('goal');
    await seedDonation(10_000);

    const response = await request(server())
      .get(`/api/widgets/${widgetId}/state`)
      .set(auth())
      .expect(200);
    expect(response.body.raisedMinor).toBe(10_000);
  });

  it('не засчитывает тестовые алерты', async () => {
    const widgetId = await createWidget('goal');
    await seedDonation(50_000, { isTest: true });

    const response = await request(server())
      .get(`/api/widgets/${widgetId}/state`)
      .set(auth())
      .expect(200);
    expect(response.body.raisedMinor).toBe(0);
  });

  it('у чата состояния нет, и запрос это честно говорит', async () => {
    // «Состояние» чата — поток сообщений: накапливать нечего, восстанавливать
    // неоткуда. Дашборд по этому же признаку не рисует блок управления.
    const widgetId = await createWidget('chat', { channel: 'shroud' });

    const response = await request(server())
      .get(`/api/widgets/${widgetId}/state`)
      .set(auth())
      .expect(200);
    expect(response.body).toEqual({});
  });

  it('приводит логин канала к нижнему регистру при создании', async () => {
    // Иначе ключ комнаты доставки разошёлся бы с тегом канала в сообщении IRC,
    // и чат просто не доходил бы до оверлея.
    const widgetId = await createWidget('chat', { channel: 'Shroud' });

    const response = await request(server())
      .get(`/api/widgets/${widgetId}`)
      .set(auth())
      .expect(200);
    expect(response.body.config.channel).toBe('shroud');
  });

  it('прибавляет стартовую сумму к собранному', async () => {
    const widgetId = await createWidget('goal');
    await seedDonation(10_000);

    const response = await request(server())
      .patch(`/api/widgets/${widgetId}/state`)
      .set(auth())
      .send({ kind: 'goal', offsetMinor: 25_000 })
      .expect(200);

    expect(response.body.raisedMinor).toBe(35_000);
    // Смещение отдаётся и отдельным полем: без него форме в дашборде нечем
    // заполнить «стартовую сумму», она открывается нулём, и сохранение стирает
    // заданное значение.
    expect(response.body.offsetMinor).toBe(25_000);

    const reread = await request(server())
      .get(`/api/widgets/${widgetId}/state`)
      .set(auth())
      .expect(200);
    expect(reread.body.offsetMinor).toBe(25_000);
  });

  it('управляет таймером, и состояние переживает перечитывание', async () => {
    const widgetId = await createWidget('timer', { initialSeconds: 600 });

    const started = await request(server())
      .patch(`/api/widgets/${widgetId}/state`)
      .set(auth())
      .send({ kind: 'timer', action: 'start' })
      .expect(200);
    expect(started.body.endsAt).not.toBeNull();

    const paused = await request(server())
      .patch(`/api/widgets/${widgetId}/state`)
      .set(auth())
      .send({ kind: 'timer', action: 'pause' })
      .expect(200);
    expect(paused.body.endsAt).toBeNull();
    expect(paused.body.pausedSeconds).toBe(600);

    // Состояние в БД, а не в памяти процесса: перечитываем и видим то же.
    const reread = await request(server())
      .get(`/api/widgets/${widgetId}/state`)
      .set(auth())
      .expect(200);
    expect(reread.body.pausedSeconds).toBe(600);
  });

  it('параллельные прибавки не теряются и публикуются в порядке записи', async () => {
    // Десять донатов в одну секунду под настоящей блокировкой Redis: ни одна
    // прибавка не потеряна, и оверлей в итоге видит записанное. Сама гонка
    // публикаций здесь почти не воспроизводится — окно в миллисекунды; её
    // детерминированно ловит юнит-тест «команды таймера под блокировкой».
    const widgetId = await createWidget('timer', { initialSeconds: 600, maxSeconds: 86_400 });
    const published: number[] = [];
    const unsubscribe = await harness.app.get(RealtimeBus).subscribe((message: BusMessage) => {
      if (message.kind === 'widget-state' && message.widgetId === widgetId) {
        if (message.state.kind === 'timer' && message.state.pausedSeconds !== null) {
          published.push(message.state.pausedSeconds);
        }
      }
    });

    await Promise.all(
      Array.from({ length: 10 }, () =>
        request(server())
          .patch(`/api/widgets/${widgetId}/state`)
          .set(auth())
          .send({ kind: 'timer', action: 'add', seconds: 60 })
          .expect(200),
      ),
    );

    const stored = await request(server())
      .get(`/api/widgets/${widgetId}/state`)
      .set(auth())
      .expect(200);
    expect(stored.body.pausedSeconds).toBe(600 + 10 * 60);

    // Шина доставляет асинхронно: ждём, пока дойдут все десять.
    const deadline = Date.now() + 5_000;
    while (published.length < 10 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    await unsubscribe();

    expect(published).toHaveLength(10);
    expect(published).toEqual([...published].sort((a, b) => a - b));
    expect(published.at(-1)).toBe(stored.body.pausedSeconds);
  });

  it('отвергает команду, не подходящую типу виджета', async () => {
    const widgetId = await createWidget('goal');
    await request(server())
      .patch(`/api/widgets/${widgetId}/state`)
      .set(auth())
      .send({ kind: 'timer', action: 'start' })
      .expect(400);
  });

  it('требует секунды для добавления времени', async () => {
    const widgetId = await createWidget('timer');
    await request(server())
      .patch(`/api/widgets/${widgetId}/state`)
      .set(auth())
      .send({ kind: 'timer', action: 'add' })
      .expect(400);
  });

  it('тестовый алерт не двигает марафон', async () => {
    const widgetId = await createWidget('timer', {
      initialSeconds: 600,
      secondsPerUnit: 2,
      currency: 'RUB',
    });

    await request(server()).post('/api/events/test').set(auth()).expect(201);

    const state = await request(server())
      .get(`/api/widgets/${widgetId}/state`)
      .set(auth())
      .expect(200);
    // Часы остались нетронутыми: ни запущены, ни продлены — на них ровно
    // начальная длительность.
    expect(state.body.pausedSeconds).toBe(600);
    expect(state.body.endsAt).toBeNull();
  });

  it('строит топ донатеров по сумме', async () => {
    const widgetId = await createWidget('top-donors', { limit: 2, period: 'all' });
    await seedDonation(10_000, { username: 'Аня' });
    await seedDonation(50_000, { username: 'Борис' });
    await seedDonation(5_000, { username: 'Аня' });
    await seedDonation(1_000, { username: 'Вика' });

    const response = await request(server())
      .get(`/api/widgets/${widgetId}/state`)
      .set(auth())
      .expect(200);

    expect(response.body.kind).toBe('top-donors');
    expect(response.body.entries).toHaveLength(2);
    expect(response.body.entries[0]).toMatchObject({ username: 'Борис', amountMinor: 50_000 });
    expect(response.body.entries[1]).toMatchObject({
      username: 'Аня',
      amountMinor: 15_000,
      count: 2,
    });
  });

  it('обрезает топ по периоду', async () => {
    const widgetId = await createWidget('top-donors', { period: '24h' });
    await seedDonation(90_000, { username: 'Старый', daysAgo: 5 });
    await seedDonation(1_000, { username: 'Свежий' });

    const response = await request(server())
      .get(`/api/widgets/${widgetId}/state`)
      .set(auth())
      .expect(200);
    expect(response.body.entries).toHaveLength(1);
    expect(response.body.entries[0].username).toBe('Свежий');
  });

  it('чужое состояние отдаёт 404, а не 403', async () => {
    const widgetId = await createWidget('goal');
    const other = await request(server())
      .post('/api/auth/register')
      .send(registrationPayload())
      .expect(201);

    await request(server())
      .get(`/api/widgets/${widgetId}/state`)
      .set({ Authorization: `Bearer ${other.body.accessToken as string}` })
      .expect(404);
  });
});
