import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { OAuthStateService } from '../src/modules/integrations/oauth-state.service';
import { createHarness, registrationPayload, type TestHarness } from './harness';

/**
 * Аналитика площадок.
 *
 * Снимки засеиваются прямо в БД: сходить за ними на живой Twitch тест не может,
 * а проверять нужно то, что считается на нашей стороне — дельты, прореживание
 * ряда, время в эфире и разграничение доступа.
 */
describe('Аналитика каналов (feature)', () => {
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

  const HOUR = 60 * 60 * 1000;

  async function createChannel(owner = userId): Promise<string> {
    const channel = await harness.prisma.channel.create({
      data: {
        userId: owner,
        platform: 'TWITCH',
        externalId: `ext-${Math.random().toString(36).slice(2, 10)}`,
        login: 'streamer',
        displayName: 'Стример',
      },
    });
    return channel.id;
  }

  async function seedSnapshots(
    channelId: string,
    points: Array<{ hoursAgo: number; followers?: number; viewers?: number; isLive?: boolean }>,
  ): Promise<void> {
    await harness.prisma.analyticsSnapshot.createMany({
      data: points.map((point) => ({
        channelId,
        capturedAt: new Date(Date.now() - point.hoursAgo * HOUR),
        isLive: point.isLive ?? false,
        viewers: point.viewers ?? null,
        followers: point.followers ?? null,
        subscribers: null,
        totalViews: null,
      })),
    });
  }

  it('отдаёт список подключённых каналов', async () => {
    await createChannel();
    const response = await request(server()).get('/api/channels').set(auth()).expect(200);

    expect(response.body).toHaveLength(1);
    expect(response.body[0].platform).toBe('twitch');
    expect(response.body[0].syncState).toBe('ok');
  });

  it('не показывает каналы чужого пользователя', async () => {
    const other = await request(server())
      .post('/api/auth/register')
      .send(registrationPayload())
      .expect(201);
    await createChannel(other.body.user.id as string);

    const response = await request(server()).get('/api/channels').set(auth()).expect(200);
    expect(response.body).toHaveLength(0);
  });

  it('считает прирост подписчиков между краями диапазона', async () => {
    const channelId = await createChannel();
    await seedSnapshots(channelId, [
      { hoursAgo: 100, followers: 100 },
      { hoursAgo: 50, followers: 130 },
      { hoursAgo: 1, followers: 150 },
    ]);

    const response = await request(server())
      .get(`/api/channels/${channelId}/summary?range=7d`)
      .set(auth())
      .expect(200);

    expect(response.body.deltas.followers).toBe(50);
    expect(response.body.current.followers).toBe(150);
  });

  it('обрезает диапазон: снимок старше суток не влияет на суточную дельту', async () => {
    const channelId = await createChannel();
    await seedSnapshots(channelId, [
      { hoursAgo: 100, followers: 100 },
      { hoursAgo: 20, followers: 140 },
      { hoursAgo: 1, followers: 150 },
    ]);

    const response = await request(server())
      .get(`/api/channels/${channelId}/summary?range=24h`)
      .set(auth())
      .expect(200);

    expect(response.body.deltas.followers).toBe(10);
  });

  it('не выдумывает дельту, когда начало диапазона неизвестно', async () => {
    const channelId = await createChannel();
    // У первого снимка счётчик скрыт: площадка его не отдала.
    await seedSnapshots(channelId, [{ hoursAgo: 5 }, { hoursAgo: 1, followers: 150 }]);

    const response = await request(server())
      .get(`/api/channels/${channelId}/summary?range=7d`)
      .set(auth())
      .expect(200);

    // Ноль вместо null нарисовал бы рост со 150 из ничего.
    expect(response.body.deltas.followers).toBeNull();
  });

  it('находит пик зрителей и считает время в эфире', async () => {
    const channelId = await createChannel();
    // Час эфира — это 61 минутный снимок и 60 промежутков между ними.
    // Длительность в снимках не записана, она восстанавливается по промежуткам.
    await seedSnapshots(
      channelId,
      Array.from({ length: 61 }, (_, index) => ({
        hoursAgo: 3 - index / 60,
        viewers: index === 30 ? 800 : 100,
        isLive: true,
      })),
    );

    const response = await request(server())
      .get(`/api/channels/${channelId}/summary?range=24h`)
      .set(auth())
      .expect(200);

    expect(response.body.peakViewers).toBe(800);
    expect(response.body.liveHours).toBe(1);
  });

  it('не засчитывает перерыв в опросе как часы эфира', async () => {
    const channelId = await createChannel();
    // Между снимками шесть часов: воркер стоял. Оба конца «в эфире», но
    // шесть часов стрима из этого не следует.
    await seedSnapshots(channelId, [
      { hoursAgo: 10, viewers: 50, isLive: true },
      { hoursAgo: 4, viewers: 50, isLive: true },
    ]);

    const response = await request(server())
      .get(`/api/channels/${channelId}/summary?range=30d`)
      .set(auth())
      .expect(200);

    // Промежуток обрезается пятью минутами.
    expect(response.body.liveHours).toBeLessThanOrEqual(0.1);
  });

  it('прореживает ряд по часам для недели и по суткам для месяца', async () => {
    const channelId = await createChannel();
    // Снимки привязаны к началу часа: «25 часов и 25 без минуты назад», взятые
    // от текущего момента, в последнюю минуту часа попадали в соседние корзины.
    const hourStartAgo = 25 + (Date.now() % HOUR) / HOUR;
    await seedSnapshots(channelId, [
      { hoursAgo: hourStartAgo - 10 / 60, viewers: 10, isLive: true },
      { hoursAgo: hourStartAgo - 20 / 60, viewers: 30, isLive: true },
      { hoursAgo: 2, viewers: 50, isLive: true },
    ]);

    const week = await request(server())
      .get(`/api/channels/${channelId}/series?range=7d`)
      .set(auth())
      .expect(200);
    expect(week.body.bucket).toBe('hour');
    // Два снимка в одном часе схлопываются в одну точку.
    expect(week.body.points).toHaveLength(2);
    expect(week.body.points[0].viewers).toBe(20);

    const month = await request(server())
      .get(`/api/channels/${channelId}/series?range=30d`)
      .set(auth())
      .expect(200);
    expect(month.body.bucket).toBe('day');
  });

  it('режет сутки по часовому поясу клиента, а не по UTC', async () => {
    const channelId = await createChannel();

    // Два снимка одного московского вечера, разнесённые полуночью по UTC:
    // 22:00 и 02:00 UTC — это 01:00 и 05:00 по Москве того же дня. Пока корзины
    // считались по UTC, один ночной эфир разваливался на графике за месяц на
    // две соседние даты, и подпись оси называла день, которого у данных нет.
    const evening = new Date();
    evening.setUTCDate(evening.getUTCDate() - 2);
    evening.setUTCHours(22, 0, 0, 0);
    await harness.prisma.analyticsSnapshot.createMany({
      data: [evening, new Date(evening.getTime() + 4 * HOUR)].map((capturedAt) => ({
        channelId,
        capturedAt,
        isLive: true,
        viewers: 10,
      })),
    });

    const moscow = await request(server())
      .get(`/api/channels/${channelId}/series?range=30d&timeZone=Europe%2FMoscow`)
      .set(auth())
      .expect(200);
    expect(moscow.body.points).toHaveLength(1);

    const utc = await request(server())
      .get(`/api/channels/${channelId}/series?range=30d`)
      .set(auth())
      .expect(200);
    expect(utc.body.points).toHaveLength(2);
  });

  it('отклоняет выдуманный часовой пояс', async () => {
    const channelId = await createChannel();
    // Неизвестная зона в SQL стала бы ошибкой запроса, то есть пятисоткой.
    await request(server())
      .get(`/api/channels/${channelId}/series?timeZone=Europe%2FАтлантида`)
      .set(auth())
      .expect(400);
  });

  it('отклоняет неизвестный диапазон', async () => {
    const channelId = await createChannel();
    await request(server())
      .get(`/api/channels/${channelId}/series?range=1y`)
      .set(auth())
      .expect(400);
  });

  it('чужой канал отдаёт 404, а не 403', async () => {
    const other = await request(server())
      .post('/api/auth/register')
      .send(registrationPayload())
      .expect(201);
    const foreignId = await createChannel(other.body.user.id as string);

    // 403 подтвердил бы существование канала и позволил перебирать id.
    await request(server()).get(`/api/channels/${foreignId}/summary`).set(auth()).expect(404);
    await request(server()).get(`/api/channels/${foreignId}/series`).set(auth()).expect(404);
    await request(server()).delete(`/api/channels/${foreignId}`).set(auth()).expect(404);
  });

  it('отключение площадки уносит канал, снимки и учётные данные', async () => {
    const channelId = await createChannel();
    await seedSnapshots(channelId, [{ hoursAgo: 1, followers: 10 }]);
    await harness.prisma.integrationCredential.create({
      data: {
        userId,
        provider: 'twitch',
        accessTokenEncrypted: 'v1.заглушка',
        scopes: [],
      },
    });

    await request(server()).delete(`/api/channels/${channelId}`).set(auth()).expect(204);

    expect(await harness.prisma.channel.count()).toBe(0);
    expect(await harness.prisma.analyticsSnapshot.count()).toBe(0);
    expect(await harness.prisma.integrationCredential.count()).toBe(0);
  });

  it('суммирует донаты по валютам и не смешивает их', async () => {
    await harness.prisma.alertEvent.createMany({
      data: [
        makeEvent(userId, 'evt-1', 50_000, 'RUB'),
        makeEvent(userId, 'evt-2', 30_000, 'RUB'),
        makeEvent(userId, 'evt-3', 1_000, 'USD'),
      ],
    });

    const response = await request(server())
      .get('/api/analytics/donations?range=7d')
      .set(auth())
      .expect(200);

    expect(response.body).toEqual([
      { currency: 'RUB', amountMinor: 80_000, count: 2 },
      { currency: 'USD', amountMinor: 1_000, count: 1 },
    ]);
  });

  it('не учитывает тестовые алерты в сумме донатов', async () => {
    await harness.prisma.alertEvent.createMany({
      data: [
        makeEvent(userId, 'evt-real', 50_000, 'RUB'),
        { ...makeEvent(userId, 'evt-test', 999_999, 'RUB'), isTest: true },
      ],
    });

    const response = await request(server())
      .get('/api/analytics/donations?range=7d')
      .set(auth())
      .expect(200);

    expect(response.body).toEqual([{ currency: 'RUB', amountMinor: 50_000, count: 1 }]);
  });

  it('показывает площадки, но помечает ненастроенные', async () => {
    const response = await request(server()).get('/api/integrations').set(auth()).expect(200);

    // В тестовом окружении client id площадок не заданы — кнопки подключения
    // быть не должно, но и падать приложение не имеет права.
    expect(response.body).toHaveLength(2);
    expect(response.body.every((item: { isConfigured: boolean }) => !item.isConfigured)).toBe(true);
  });

  it('не выпускает ссылку авторизации для ненастроенной площадки', async () => {
    await request(server()).post('/api/integrations/twitch/authorize').set(auth()).expect(400);
  });

  it('отклоняет неизвестную площадку', async () => {
    await request(server()).post('/api/integrations/vkplay/authorize').set(auth()).expect(400);
  });

  it('состояние OAuth одноразовое', async () => {
    const states = harness.app.get(OAuthStateService);
    const state = await states.issue(userId, 'twitch');

    expect(await states.consume(state, 'twitch')).toEqual({ userId, platform: 'twitch' });
    // Перехваченная ссылка возврата не должна срабатывать повторно.
    expect(await states.consume(state, 'twitch')).toBeNull();
  });

  it('состояние не принимается другой площадкой', async () => {
    const states = harness.app.get(OAuthStateService);
    const state = await states.issue(userId, 'twitch');

    // Иначе код, выданный одной площадкой, можно попробовать обменять у другой.
    expect(await states.consume(state, 'youtube')).toBeNull();
  });

  it('callback не принимает state без cookie браузера, выпустившего его, и не сжигает его', async () => {
    // Сценарий подмены: state выпущен для аккаунта злоумышленника, а по ссылке
    // с ним на экран подтверждения площадки уходит жертва. У её браузера cookie
    // с этим state нет.
    const states = harness.app.get(OAuthStateService);
    const state = await states.issue(userId, 'twitch');

    const withoutCookie = await request(server())
      .get(`/api/integrations/twitch/callback?code=victim-code&state=${state}`)
      .expect(302);
    expect(withoutCookie.headers.location).toContain('status=failed');

    await request(server())
      .get(`/api/integrations/twitch/callback?code=victim-code&state=${state}`)
      .set('Cookie', 'sk_oauth_state=someone-elses-state')
      .expect(302);

    expect(await states.consume(state, 'twitch')).toEqual({ userId, platform: 'twitch' });
  });

  it('callback пропускает state дальше, когда его вернул тот же браузер', async () => {
    const states = harness.app.get(OAuthStateService);
    const state = await states.issue(userId, 'twitch');

    const response = await request(server())
      .get(`/api/integrations/twitch/callback?code=code&state=${state}`)
      .set('Cookie', `sk_oauth_state=${state}`)
      .expect(302);

    // Площадка в тестах не настроена, поэтому обмен кода не удаётся. Важно, что
    // проверку привязки state прошёл: он израсходован, и cookie стёрта.
    expect(response.headers.location).toContain('status=failed');
    expect(await states.consume(state, 'twitch')).toBeNull();
    expect(String(response.headers['set-cookie'])).toContain('sk_oauth_state=;');
  });

  it('возврат с площадки без кода уводит в дашборд, а не в ошибку', async () => {
    const response = await request(server())
      .get('/api/integrations/twitch/callback?error=access_denied')
      .expect(302);

    expect(response.headers.location).toContain('status=cancelled');
  });
  describe('сводка по эфирам и донатам', () => {
    const MINUTE = 60 * 1000;

    /** Эфир из минутных снимков: `minutes` снимков подряд, заканчивая `endHoursAgo`. */
    async function seedStream(
      channelId: string,
      endHoursAgo: number,
      minutes: number,
      followersFrom: number,
      followersTo: number,
    ): Promise<void> {
      const end = Date.now() - endHoursAgo * HOUR;
      await harness.prisma.analyticsSnapshot.createMany({
        data: Array.from({ length: minutes }, (_, index) => ({
          channelId,
          capturedAt: new Date(end - (minutes - 1 - index) * MINUTE),
          isLive: true,
          viewers: 50 + index,
          followers:
            followersFrom + Math.round(((followersTo - followersFrom) * index) / (minutes - 1)),
          subscribers: null,
          totalViews: null,
        })),
      });
    }

    it('собирает эфиры, раскладывает донаты по ним и по дням', async () => {
      const channelId = await createChannel();
      await seedStream(channelId, 30, 90, 1000, 1012);
      await seedStream(channelId, 5, 60, 1012, 1015);
      const streamDonation = new Date(Date.now() - 5 * HOUR - 10 * MINUTE);
      await harness.prisma.alertEvent.createMany({
        data: [
          { ...makeEvent(userId, 'in-stream', 70_000, 'RUB'), createdAt: streamDonation },
          {
            ...makeEvent(userId, 'off-stream', 5_000, 'RUB'),
            createdAt: new Date(Date.now() - 50 * HOUR),
          },
          { ...makeEvent(userId, 'usd', 1_000, 'USD'), createdAt: streamDonation },
          {
            ...makeEvent(userId, 'follow', 0, 'RUB'),
            type: 'FOLLOW' as const,
            amountMinor: null,
            currency: null,
            createdAt: streamDonation,
          },
        ],
      });

      const response = await request(server())
        .get('/api/analytics/overview?range=7d&timeZone=Europe%2FMoscow')
        .set(auth())
        .expect(200);
      const body = response.body;

      expect(body.bucket).toBe('day');
      expect(body.currency).toBe('RUB');
      expect(body.buckets.length).toBeGreaterThanOrEqual(7);
      expect(body.streams).toHaveLength(2);
      expect(body.streams[0]).toMatchObject({
        minutes: 90,
        platforms: ['twitch'],
        audienceGain: 12,
      });
      expect(body.streams[1]).toMatchObject({
        minutes: 60,
        peakViewers: 109,
        donationsMinor: 70_000,
        donationsCount: 1,
        events: 1,
        audienceGain: 3,
      });
      // Доллары в рублёвые корзины не идут, но в итог по валютам — да.
      expect(body.donationsDuringStreamsMinor).toBe(70_000);
      const bucketSum = body.buckets.reduce(
        (sum: number, bucket: { donationsMinor: number }) => sum + bucket.donationsMinor,
        0,
      );
      expect(bucketSum).toBe(75_000);
      const liveMinutes = body.buckets.reduce(
        (sum: number, bucket: { liveMinutes: number }) => sum + bucket.liveMinutes,
        0,
      );
      expect(liveMinutes).toBe(150);
      expect(body.donationTotals).toEqual([
        { currency: 'RUB', amountMinor: 75_000, count: 2 },
        { currency: 'USD', amountMinor: 1_000, count: 1 },
      ]);
      expect(body.eventCounts).toEqual([
        { type: 'donation', count: 3 },
        { type: 'follow', count: 1 },
      ]);
      const heat = body.heatmap.reduce(
        (sum: number, cell: { amountMinor: number }) => sum + cell.amountMinor,
        0,
      );
      expect(heat).toBe(75_000);
    });

    it('без эфиров и донатов отдаёт пустые корзины, а не ошибку', async () => {
      const response = await request(server())
        .get('/api/analytics/overview?range=24h')
        .set(auth())
        .expect(200);

      expect(response.body.bucket).toBe('hour');
      expect(response.body.streams).toEqual([]);
      expect(response.body.buckets.length).toBeGreaterThanOrEqual(24);
      expect(
        response.body.buckets.every(
          (bucket: { audienceGain: number | null }) => bucket.audienceGain === null,
        ),
      ).toBe(true);
    });

    it('не видит чужих эфиров и донатов', async () => {
      const other = await request(server())
        .post('/api/auth/register')
        .send(registrationPayload())
        .expect(201);
      const otherId = other.body.user.id as string;
      const channelId = await createChannel(otherId);
      await seedStream(channelId, 2, 30, 10, 20);
      await harness.prisma.alertEvent.create({ data: makeEvent(otherId, 'alien', 9_000, 'RUB') });

      const response = await request(server())
        .get('/api/analytics/overview?range=7d')
        .set(auth())
        .expect(200);

      expect(response.body.streams).toEqual([]);
      expect(response.body.donationTotals).toEqual([]);
      expect(response.body.heatmap).toEqual([]);
    });
  });
});

function makeEvent(userId: string, externalId: string, amountMinor: number, currency: string) {
  return {
    userId,
    type: 'DONATION' as const,
    provider: 'WEBHOOK' as const,
    externalId,
    username: 'Зритель',
    message: '',
    amountMinor,
    currency,
    isTest: false,
    occurredAt: new Date(),
  };
}
