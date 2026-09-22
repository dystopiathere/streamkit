import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type BusMessage, RealtimeBus } from '../src/common/bus/realtime-bus.service';
import { EventsService } from '../src/modules/events/events.service';
import { createHarness, registrationPayload, type TestHarness } from './harness';

/**
 * Последнее событие, рулетка и триггеры доната.
 *
 * События идут через `EventsService.ingest` — тот же путь, что у вебхука и
 * коннекторов: рулетку крутит реакция на записанное событие, и засеивание прямо
 * в БД её бы не проверило.
 */
describe('Последнее событие, рулетка, триггеры (feature)', () => {
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

  async function ingest(
    options: {
      type?: 'donation' | 'follow';
      amountMinor?: number;
      currency?: 'RUB' | 'USD';
      username?: string;
      isTest?: boolean;
      audioUrl?: string;
    } = {},
  ): Promise<void> {
    seq += 1;
    const type = options.type ?? 'donation';
    await harness.app.get(EventsService).ingest({
      userId,
      type,
      provider: 'webhook',
      externalId: `int-${seq}`,
      username: options.username ?? `Зритель ${seq}`,
      message: 'сообщение',
      amount:
        type === 'donation'
          ? { amountMinor: options.amountMinor ?? 50_000, currency: options.currency ?? 'RUB' }
          : null,
      count: null,
      audioUrl: options.audioUrl ?? null,
      isTest: options.isTest ?? false,
    });
  }

  async function state(widgetId: string) {
    return (await request(server()).get(`/api/widgets/${widgetId}/state`).set(auth()).expect(200))
      .body;
  }

  /* ---------------------------------------------------------------- */

  it('последнее событие — последнее своего типа, без тестовых', async () => {
    const widgetId = await createWidget('latest');
    expect(await state(widgetId)).toEqual({ kind: 'latest', event: null });

    await ingest({ username: 'Первый', amountMinor: 10_000 });
    await ingest({ type: 'follow', username: 'Фолловер' });
    await ingest({ username: 'Тест', isTest: true });

    const latest = await state(widgetId);
    expect(latest.event).toMatchObject({
      type: 'donation',
      username: 'Первый',
      amount: { amountMinor: 10_000, currency: 'RUB' },
    });

    // Смена события в настройках меняет и то, что в кадре.
    await request(server())
      .patch(`/api/widgets/${widgetId}`)
      .set(auth())
      .send({ config: { eventType: 'follow', template: '{username}' } })
      .expect(200);
    expect((await state(widgetId)).event).toMatchObject({ type: 'follow', username: 'Фолловер' });
  });

  it('донат от цены прокрута крутит рулетку, дешевле, без цены и тестовый — нет', async () => {
    const widgetId = await createWidget('roulette', { spinPrice: { RUB: 30_000 } });
    const spins: BusMessage[] = [];
    const unsubscribe = await harness.app.get(RealtimeBus).subscribe((message) => {
      if (message.kind === 'roulette-spin' && message.widgetId === widgetId) spins.push(message);
    });

    await ingest({ amountMinor: 29_999 });
    await ingest({ amountMinor: 1_000_000, currency: 'USD' });
    await ingest({ amountMinor: 1_000_000, isTest: true });
    await ingest({ type: 'follow' });
    await ingest({ amountMinor: 30_000, username: 'Аня' });

    const history = await state(widgetId);
    expect(history.kind).toBe('roulette');
    expect(history.spins).toHaveLength(1);
    const [spin] = history.spins;
    expect(spin).toMatchObject({
      source: 'donation',
      username: 'Аня',
      amount: { amountMinor: 30_000, currency: 'RUB' },
    });

    // Выпавший сектор — из колеса, и подпись с цветом у прокрута его.
    const widget = await request(server()).get(`/api/widgets/${widgetId}`).set(auth()).expect(200);
    const sector = widget.body.config.sectors[spin.sectorIndex];
    expect(sector).toMatchObject({ id: spin.sectorId, label: spin.label, color: spin.color });
    // Остановка не у края сектора: стрелка на границе выглядит спорной.
    expect(spin.offset).toBeGreaterThanOrEqual(0.15);
    expect(spin.offset).toBeLessThanOrEqual(0.85);

    const deadline = Date.now() + 5_000;
    while (spins.length < 1 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    await unsubscribe();
    expect(spins).toHaveLength(1);
  });

  it('выключенные донаты не крутят колесо, кнопка — крутит', async () => {
    const widgetId = await createWidget('roulette', { donationSpins: false });
    await ingest({ amountMinor: 1_000_000 });
    expect((await state(widgetId)).spins).toHaveLength(0);

    const response = await request(server())
      .patch(`/api/widgets/${widgetId}/state`)
      .set(auth())
      .send({ kind: 'roulette', action: 'spin' })
      .expect(200);
    expect(response.body.spins).toHaveLength(1);
    expect(response.body.spins[0]).toMatchObject({
      source: 'manual',
      username: null,
      amount: null,
    });
  });

  it('история прокрутов — двадцать последних, новые первыми, и стирается кнопкой', async () => {
    const widgetId = await createWidget('roulette');
    for (let index = 0; index < 22; index += 1) {
      await request(server())
        .patch(`/api/widgets/${widgetId}/state`)
        .set(auth())
        .send({ kind: 'roulette', action: 'spin' })
        .expect(200);
    }
    const history = await state(widgetId);
    expect(history.spins).toHaveLength(20);
    const times = history.spins.map((spin: { createdAt: string }) => spin.createdAt);
    expect(times).toEqual([...times].sort().reverse());

    const cleared = await request(server())
      .patch(`/api/widgets/${widgetId}/state`)
      .set(auth())
      .send({ kind: 'roulette', action: 'clear' })
      .expect(200);
    expect(cleared.body.spins).toEqual([]);
  });

  it('два доната в одну секунду — два прокрута в истории', async () => {
    const widgetId = await createWidget('roulette', { spinPrice: { RUB: 100 } });
    await Promise.all([ingest({ amountMinor: 100 }), ingest({ amountMinor: 100 })]);
    expect((await state(widgetId)).spins).toHaveLength(2);
  });

  it('обнуление истории донатов стирает и историю рулетки — даже выключенной', async () => {
    const widgetId = await createWidget('roulette', { spinPrice: { RUB: 100 } });
    await ingest({ amountMinor: 100, username: 'Донатер' });
    await request(server())
      .patch(`/api/widgets/${widgetId}`)
      .set(auth())
      .send({ isEnabled: false })
      .expect(200);

    await request(server()).post('/api/events/reset').set(auth()).expect(200);

    expect((await state(widgetId)).spins).toEqual([]);
    const rows = await harness.prisma.widgetState.findMany({ where: { widgetId } });
    expect(JSON.stringify(rows)).not.toContain('Донатер');
  });

  it('команда рулетки чужому типу — 400', async () => {
    const widgetId = await createWidget('latest');
    await request(server())
      .patch(`/api/widgets/${widgetId}/state`)
      .set(auth())
      .send({ kind: 'roulette', action: 'spin' })
      .expect(400);
  });

  /* ---------------------------------------------------------------- */

  it('триггеры доната сохраняются в сценарии по порядку', async () => {
    const widgetId = await createWidget('alerts');
    const triggers = [
      {
        id: 't-exact',
        condition: { operator: 'eq', amountMinor: 100_000 },
        titleTemplate: 'ровно',
      },
      {
        id: 't-under',
        condition: { operator: 'lt', amountMinor: 1_000_000 },
        titleTemplate: 'меньше',
      },
    ];
    const saved = await request(server())
      .patch(`/api/widgets/${widgetId}`)
      .set(auth())
      .send({ config: { scenarios: { donation: { triggers } } } })
      .expect(200);
    expect(
      saved.body.config.scenarios.donation.triggers.map((trigger: { id: string }) => trigger.id),
    ).toEqual(['t-exact', 't-under']);
    // Остальной сценарий правка триггеров не стёрла.
    expect(saved.body.config.scenarios.donation.titleTemplate).toBe('{username} — {amount}');
  });

  it('«между» без верхней границы не сохраняется', async () => {
    const widgetId = await createWidget('alerts');
    await request(server())
      .patch(`/api/widgets/${widgetId}`)
      .set(auth())
      .send({
        config: {
          scenarios: {
            donation: {
              triggers: [{ id: 't', condition: { operator: 'between', amountMinor: 100 } }],
            },
          },
        },
      })
      .expect(400);
  });

  it('тестовый донат — с заданной суммой: так проверяют триггер', async () => {
    const response = await request(server())
      .post('/api/events/test')
      .set(auth())
      .send({ type: 'donation', amount: { amountMinor: 100_000, currency: 'USD' } })
      .expect(201);
    expect(response.body.amount).toEqual({ amountMinor: 100_000, currency: 'USD' });
  });

  /* ---------------------------------------------------------------- */

  it('история событий — страницами от отсечки: новый донат не сдвигает строки', async () => {
    for (let index = 0; index < 30; index += 1) await ingest({ amountMinor: 100 + index });

    const first = await request(server())
      .get('/api/events/history?page=1&pageSize=25')
      .set(auth())
      .expect(200);
    expect(first.body.items).toHaveLength(25);
    expect(first.body.total).toBe(30);
    const until = first.body.until as string;

    // Донат во время листания — после отсечки.
    await new Promise((resolve) => setTimeout(resolve, 5));
    await ingest({ amountMinor: 999_999 });

    const second = await request(server())
      .get(`/api/events/history?page=2&pageSize=25&until=${encodeURIComponent(until)}`)
      .set(auth())
      .expect(200);
    expect(second.body.total).toBe(30);
    expect(second.body.items).toHaveLength(5);
    const firstIds = new Set(first.body.items.map((item: { id: string }) => item.id));
    expect(second.body.items.some((item: { id: string }) => firstIds.has(item.id))).toBe(false);

    const fresh = await request(server())
      .get('/api/events/history?page=1&pageSize=25')
      .set(auth())
      .expect(200);
    expect(fresh.body.total).toBe(31);
    expect(fresh.body.items[0].amount.amountMinor).toBe(999_999);
  });

  it('голосовой донат доезжает до ленты и до оверлея записью, а не текстом', async () => {
    const voice = 'https://cdn.donationalerts.ru/voice/1.mp3';
    const delivered: string[] = [];
    const unsubscribe = await harness.app.get(RealtimeBus).subscribe((message) => {
      if (message.kind === 'alert' && message.event.audioUrl)
        delivered.push(message.event.audioUrl);
    });

    await ingest({ username: 'Голосовой', audioUrl: voice });

    const page = await request(server())
      .get('/api/events/history?page=1&pageSize=25')
      .set(auth())
      .expect(200);
    expect(page.body.items[0]).toMatchObject({ username: 'Голосовой', audioUrl: voice });

    const deadline = Date.now() + 5_000;
    while (delivered.length < 1 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    await unsubscribe();
    expect(delivered).toEqual([voice]);
  });

  it('размер страницы — только из списка', async () => {
    await request(server()).get('/api/events/history?pageSize=1000').set(auth()).expect(400);
  });
});
