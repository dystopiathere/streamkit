// Оплата настроена — ключи до создания приложения: конфиг читает окружение при
// старте. setup.ts ключи ЮKassa вычищает, иначе прогон зависел бы от .env.
process.env.YOOKASSA_SHOP_ID = 'test-shop';
process.env.YOOKASSA_SECRET_KEY = 'test-secret-key';
process.env.SELLER_NAME = 'Иванов Иван Иванович';
process.env.SELLER_INN = '123456789012';
process.env.SELLER_EMAIL = 'support@example.ru';

import {
  guestIdentity,
  MAX_RENEWAL_ATTEMPTS,
  MAX_ROULETTE_SECTORS,
  PLAN_FEATURES,
  PLAN_PRICES,
  type RoomParticipant,
} from '@streamkit/contracts';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { MAILER } from '../src/common/mail/mailer';
import { BillingService } from '../src/modules/billing/billing.service';
import { MaintenanceModule } from '../src/modules/maintenance/maintenance.module';
import { MaintenanceService } from '../src/modules/maintenance/maintenance.service';
import { OAuthStateService } from '../src/modules/integrations/oauth-state.service';
import type { PlatformProvider } from '../src/modules/integrations/platform-provider';
import { PlatformRegistry } from '../src/modules/integrations/platform-registry.service';
import { PAYMENT_GATEWAY } from '../src/modules/billing/payment-gateway';
import { ROOM_MEDIA_SERVER, type RoomMediaServer } from '../src/modules/rooms/livekit.service';
import { TokenService } from '../src/modules/auth/token.service';
import { WidgetsService } from '../src/modules/widgets/widgets.service';
import { FakeGateway, FakeMailer } from './billing-fakes';
import {
  createHarness,
  markEmailVerified,
  registrationPayload,
  takeVerificationLetter,
  type TestHarness,
} from './harness';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Медиасервер с пустыми комнатами: здесь проверяется только тариф. */
class EmptyMediaServer implements RoomMediaServer {
  readonly removed: string[] = [];
  async listParticipants(): Promise<RoomParticipant[]> {
    return [];
  }
  async removeParticipant(_roomId: string, identity: string): Promise<void> {
    this.removed.push(identity);
  }
  async muteTrack(): Promise<void> {}
  async setPublishSources(): Promise<void> {}
}

describe('Подписка на платформу (feature)', () => {
  let harness: TestHarness;
  let billing: BillingService;
  const gateway = new FakeGateway();
  const media = new EmptyMediaServer();
  const mailer = new FakeMailer();

  beforeAll(async () => {
    harness = await createHarness([MaintenanceModule], (builder) =>
      builder
        .overrideProvider(PAYMENT_GATEWAY)
        .useValue(gateway)
        .overrideProvider(ROOM_MEDIA_SERVER)
        .useValue(media)
        .overrideProvider(MAILER)
        .useValue(mailer),
    );
    billing = harness.app.get(BillingService);
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await harness.reset();
    gateway.reset();
    mailer.reset();
    media.removed.length = 0;
  });

  const server = () => harness.app.getHttpServer();
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  async function streamer(): Promise<{ token: string; userId: string; email: string }> {
    const payload = registrationPayload();
    const response = await request(server()).post('/api/auth/register').send(payload).expect(201);
    const userId = response.body.user.id as string;
    if (mailer.configured) await takeVerificationLetter(mailer.sent, payload.email);
    await markEmailVerified(harness, userId);
    return { token: response.body.accessToken as string, userId, email: payload.email };
  }

  async function checkout(
    token: string,
    period: 'month' | 'year' = 'month',
    plan: 'multistream' | 'pro' = 'pro',
  ) {
    const response = await request(server())
      .post('/api/billing/checkout')
      .set(auth(token))
      .send({ plan, period, acceptOffer: true })
      .expect(201);
    const payment = await harness.prisma.payment.findUniqueOrThrow({
      where: { id: response.body.paymentId as string },
    });
    return { body: response.body, payment };
  }

  function notify(providerPaymentId: string) {
    return request(server())
      .post('/api/billing/yookassa/webhook')
      .send({
        type: 'notification',
        event: 'payment.succeeded',
        object: { id: providerPaymentId },
      });
  }

  /** Оформил и оплатил месяц: подписка активна, способ оплаты сохранён. */
  async function subscribed(token: string, plan: 'multistream' | 'pro' = 'pro'): Promise<string> {
    const { payment } = await checkout(token, 'month', plan);
    gateway.pay(payment.providerPaymentId!);
    await notify(payment.providerPaymentId!).expect(200);
    return payment.id;
  }

  it('реквизиты продавца открыты без входа — их проверяет модерация ЮKassa', async () => {
    const response = await request(server()).get('/api/public/seller').expect(200);
    expect(response.body).toEqual({
      name: 'Иванов Иван Иванович',
      inn: '123456789012',
      email: 'support@example.ru',
      phone: null,
    });
  });

  /* ---------------------------------------------------------------- */
  /* Оформление                                                         */
  /* ---------------------------------------------------------------- */

  it('оформление создаёт платёж со снимком цены, чеком на email и согласием в журнале', async () => {
    const owner = await streamer();
    const { body, payment } = await checkout(owner.token, 'year');

    expect(body.confirmationUrl).toMatch(/^https:\/\/yookassa\.test\/confirm\//);
    expect(payment).toMatchObject({
      status: 'PENDING',
      kind: 'INITIAL',
      period: 'YEAR',
      amountMinor: PLAN_PRICES.pro.year.amountMinor,
      currency: 'RUB',
    });
    expect(gateway.created[0]).toMatchObject({
      paymentId: payment.id,
      customerEmail: owner.email,
      amountMinor: PLAN_PRICES.pro.year.amountMinor,
    });
    expect(gateway.created[0]!.returnUrl).toContain(`/account/billing?payment=${payment.id}`);

    const consent = await harness.prisma.consent.findFirstOrThrow({
      where: { userId: owner.userId, document: 'SUBSCRIPTION_OFFER' },
    });
    expect(consent.revokedAt).toBeNull();
  });

  it('без подтверждённой почты тариф не оформить', async () => {
    const payload = registrationPayload();
    const response = await request(server()).post('/api/auth/register').send(payload).expect(201);
    await takeVerificationLetter(mailer.sent, payload.email);

    const refused = await request(server())
      .post('/api/billing/checkout')
      .set(auth(response.body.accessToken as string))
      .send({ plan: 'pro', period: 'month', acceptOffer: true })
      .expect(403);
    expect(refused.body.message).toBe('Подтвердите почту, чтобы оформить тариф');
    expect(gateway.created).toHaveLength(0);
    expect(await harness.prisma.payment.count()).toBe(0);
  });

  it('без согласия с офертой оплата не оформляется', async () => {
    const owner = await streamer();
    await request(server())
      .post('/api/billing/checkout')
      .set(auth(owner.token))
      .send({ period: 'month' })
      .expect(400);
    expect(gateway.created).toHaveLength(0);
  });

  it('сбой ЮKassa при оформлении — 503 и закрытый платёж, а не вечное ожидание', async () => {
    const owner = await streamer();
    gateway.failCreate = true;
    await request(server())
      .post('/api/billing/checkout')
      .set(auth(owner.token))
      .send({ plan: 'pro', period: 'month', acceptOffer: true })
      .expect(503);
    const payment = await harness.prisma.payment.findFirstOrThrow({
      where: { userId: owner.userId },
    });
    expect(payment).toMatchObject({ status: 'CANCELED', cancellationReason: 'gateway_error' });
  });

  it('отказ ЮKassa при оформлении не выдаётся за «не ответил»', async () => {
    const owner = await streamer();
    gateway.rejectCreate = true;
    const response = await request(server())
      .post('/api/billing/checkout')
      .set(auth(owner.token))
      .send({ plan: 'pro', period: 'month', acceptOffer: true })
      .expect(503);
    expect(response.body.message).toMatch(/отклонил/);
    const payment = await harness.prisma.payment.findFirstOrThrow({
      where: { userId: owner.userId },
    });
    expect(payment).toMatchObject({ status: 'CANCELED', cancellationReason: 'gateway_rejected' });
  });

  /* ---------------------------------------------------------------- */
  /* Уведомления                                                        */
  /* ---------------------------------------------------------------- */

  it('уведомление о неизвестном платеже не ходит в ЮKassa', async () => {
    // Уведомления не подписаны. Если бы каждое вызывало запрос к ЮKassa, открытый
    // эндпоинт стал бы усилителем запросов на наши ключи.
    const response = await notify('yk-чужой').expect(200);
    expect(response.body.status).toBe('ignored');
    await request(server())
      .post('/api/billing/yookassa/webhook')
      .send({ что: 'угодно' })
      .expect(200);
    expect(gateway.gets).toBe(0);
  });

  it('уведомление само по себе ничего не продлевает — правда берётся у ЮKassa', async () => {
    const owner = await streamer();
    const { payment } = await checkout(owner.token);

    // Уведомление пришло, а ЮKassa говорит, что платёж не оплачен.
    await notify(payment.providerPaymentId!).expect(200);
    const view = await request(server())
      .get('/api/billing/subscription')
      .set(auth(owner.token))
      .expect(200);
    expect(view.body).toMatchObject({ status: 'none', roomsAccess: false });
  });

  it('оплата продлевает на месяц, сохраняет способ оплаты шифротекстом и включает автопродление', async () => {
    const owner = await streamer();
    const { payment } = await checkout(owner.token);
    gateway.pay(payment.providerPaymentId!);

    const before = Date.now();
    await notify(payment.providerPaymentId!).expect(200);

    const view = await request(server())
      .get('/api/billing/subscription')
      .set(auth(owner.token))
      .expect(200);
    expect(view.body).toMatchObject({
      status: 'active',
      period: 'month',
      autoRenew: true,
      paymentMethodTitle: 'Карта *4444',
      roomsAccess: true,
      billingConfigured: true,
    });
    const end = new Date(view.body.currentPeriodEnd as string).getTime();
    expect(end - before).toBeGreaterThan(27 * DAY_MS);
    expect(end - before).toBeLessThan(32 * DAY_MS);

    const row = await harness.prisma.subscription.findUniqueOrThrow({
      where: { userId: owner.userId },
    });
    expect(row.paymentMethodEncrypted).toBeTruthy();
    expect(row.paymentMethodEncrypted).not.toContain('pm-secret-4444');
    expect(JSON.stringify(view.body)).not.toContain('pm-secret');
  });

  it('повторные и одновременные уведомления продлевают ровно один раз', async () => {
    const owner = await streamer();
    const { payment } = await checkout(owner.token);
    gateway.pay(payment.providerPaymentId!);

    await Promise.all([
      notify(payment.providerPaymentId!).expect(200),
      notify(payment.providerPaymentId!).expect(200),
      notify(payment.providerPaymentId!).expect(200),
    ]);
    await notify(payment.providerPaymentId!).expect(200);
    // Возврат пользователя со страницы оплаты — ещё один путь применить платёж.
    await request(server())
      .get(`/api/billing/payments/${payment.id}`)
      .set(auth(owner.token))
      .expect(200);

    const paid = await harness.prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
    const row = await harness.prisma.subscription.findUniqueOrThrow({
      where: { userId: owner.userId },
    });
    expect(paid.status).toBe('SUCCEEDED');
    expect(row.currentPeriodEnd!.getTime()).toBe(paid.periodEnd!.getTime());
    expect(paid.periodEnd!.getTime() - paid.periodStart!.getTime()).toBeLessThan(32 * DAY_MS);
  });

  it('сумма, не совпадающая с записью, не продлевает', async () => {
    const owner = await streamer();
    const { payment } = await checkout(owner.token);
    gateway.pay(payment.providerPaymentId!, { amountMinor: 100 });

    await notify(payment.providerPaymentId!).expect(200);
    expect(await billing.roomsAccess(owner.userId)).toBe(false);
    const audit = await harness.prisma.auditLog.findFirst({
      where: { action: 'billing.payment.amount_mismatch' },
    });
    expect(audit).not.toBeNull();
  });

  it('сбой переспроса — 503, чтобы ЮKassa повторила уведомление', async () => {
    const owner = await streamer();
    const { payment } = await checkout(owner.token);
    gateway.pay(payment.providerPaymentId!);
    gateway.failGet = true;

    await notify(payment.providerPaymentId!).expect(503);
    gateway.failGet = false;
    await notify(payment.providerPaymentId!).expect(200);
    expect(await billing.roomsAccess(owner.userId)).toBe(true);
  });

  it('отменённая оплата доступа не даёт', async () => {
    const owner = await streamer();
    const { payment } = await checkout(owner.token);
    gateway.cancel(payment.providerPaymentId!, 'expired_on_confirmation');

    await notify(payment.providerPaymentId!).expect(200);
    const row = await harness.prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(row).toMatchObject({
      status: 'CANCELED',
      cancellationReason: 'expired_on_confirmation',
    });
    expect(await billing.roomsAccess(owner.userId)).toBe(false);
  });

  it('действующую подписку поверх не оформить, чужой платёж — 404', async () => {
    const owner = await streamer();
    const stranger = await streamer();
    const paymentId = await subscribed(owner.token);

    await request(server())
      .post('/api/billing/checkout')
      .set(auth(owner.token))
      .send({ plan: 'pro', period: 'year', acceptOffer: true })
      .expect(409);
    await request(server())
      .get(`/api/billing/payments/${paymentId}`)
      .set(auth(stranger.token))
      .expect(404);
  });

  /* ---------------------------------------------------------------- */
  /* Комнаты                                                            */
  /* ---------------------------------------------------------------- */

  it('на бесплатном тарифе виджетов не больше лимита, платный снимает ограничение', async () => {
    const owner = await streamer();
    const limit = PLAN_FEATURES.free.widgets!;

    for (let index = 0; index < limit; index += 1) {
      await request(server())
        .post('/api/widgets')
        .set(auth(owner.token))
        .send({ name: `Виджет ${index}`, type: 'alerts', config: {} })
        .expect(201);
    }

    const denied = await request(server())
      .post('/api/widgets')
      .set(auth(owner.token))
      .send({ name: 'Лишний', type: 'alerts', config: {} })
      .expect(402);
    expect(denied.body.code).toBe('widget_limit');

    // «Мультистрим» снимает ограничение, и уже созданные никуда не деваются.
    await subscribed(owner.token, 'multistream');
    await request(server())
      .post('/api/widgets')
      .set(auth(owner.token))
      .send({ name: 'Пятый', type: 'alerts', config: {} })
      .expect(201);
    const widgets = await request(server()).get('/api/widgets').set(auth(owner.token)).expect(200);
    expect(widgets.body).toHaveLength(limit + 1);
  });

  it('продвинутое оформление хранится всегда, а в кадр идёт только с «Про»', async () => {
    const owner = await streamer();
    const advanced = {
      slots: { title: { x: 25, y: 10, color: '#FF0000', fontSize: 64 } },
      background: { imageUrl: 'https://example.com/bg.png', opacity: 0.5 },
      barImageUrl: 'https://example.com/bar.png',
      text: { fontFamily: 'Oswald' },
    };
    const created = await request(server())
      .post('/api/widgets')
      .set(auth(owner.token))
      .send({ name: 'Цель', type: 'goal', config: advanced })
      .expect(201);
    const widgetId = created.body.id as string;

    // Настройки сохранены целиком: конец тарифа ничего не стирает, и вернувшийся
    // «Про» обязан показать ровно то, что настроил стример.
    const stored = await request(server())
      .get(`/api/widgets/${widgetId}`)
      .set(auth(owner.token))
      .expect(200);
    expect(stored.body.config).toMatchObject(advanced);

    // А оверлей на бесплатном тарифе получает базовый конфиг.
    const widgets = harness.app.get(WidgetsService);
    const link = await widgets.createOverlayToken(owner.userId, widgetId, null);
    // Токен возвращается один раз и только в ссылке: в БД лежит его хэш.
    const raw = new URL(link.url).searchParams.get('token')!;
    const basic = await widgets.resolveOverlayToken(raw);
    expect(basic?.widget.config).toMatchObject({
      slots: { title: { x: null, y: null, color: null, fontSize: null } },
      background: { imageUrl: null, color: null },
      barImageUrl: null,
      text: { fontFamily: 'Inter' },
    });

    // С «Про» — тот же токен и всё оформление на месте.
    await subscribed(owner.token, 'pro');
    const full = await widgets.resolveOverlayToken(raw);
    expect(full?.widget.config).toMatchObject(advanced);
  });

  it('без «Про» рулетка едет колесом, и сервер крутит тот же урезанный список', async () => {
    const owner = await streamer();
    const sectors = Array.from({ length: 30 }, (_, index) => ({
      id: `s${index}`,
      label: `Зритель ${index + 1}`,
      weight: 1,
      color: '#A3850F',
    }));
    const created = await request(server())
      .post('/api/widgets')
      .set(auth(owner.token))
      .send({ name: 'Розыгрыш', type: 'roulette', config: { mode: 'vertical', sectors } })
      .expect(201);
    const widgetId = created.body.id as string;

    // В кадр идёт колесо и первые двадцать четыре позиции.
    const widgets = harness.app.get(WidgetsService);
    const link = await widgets.createOverlayToken(owner.userId, widgetId, null);
    const raw = new URL(link.url).searchParams.get('token')!;
    const basic = await widgets.resolveOverlayToken(raw);
    const shown = basic?.widget.config as { mode: string; sectors: unknown[] };
    expect(shown.mode).toBe('wheel');
    expect(shown.sectors).toHaveLength(MAX_ROULETTE_SECTORS);

    // И сервер выбирает сектор по этому же списку: номер за его пределами
    // оверлей доводить было бы некуда.
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const spin = await request(server())
        .patch(`/api/widgets/${widgetId}/state`)
        .set(auth(owner.token))
        .send({ kind: 'roulette', action: 'spin' })
        .expect(200);
      expect(spin.body.spins[0].sectorIndex).toBeLessThan(MAX_ROULETTE_SECTORS);
    }

    // С «Про» крутится весь список: настройки виджета не менялись.
    await subscribed(owner.token, 'pro');
    const full = await widgets.resolveOverlayToken(raw);
    expect((full?.widget.config as { mode: string }).mode).toBe('vertical');
    expect((full?.widget.config as { sectors: unknown[] }).sectors).toHaveLength(30);
  });

  it('после окончания «Про» уборка рассылает оверлеям базовое оформление', async () => {
    const owner = await streamer();
    await subscribed(owner.token, 'pro');
    await request(server())
      .post('/api/widgets')
      .set(auth(owner.token))
      .send({ name: 'Цель', type: 'goal', config: { slots: { title: { x: 10, y: 10 } } } })
      .expect(201);

    // Тариф кончился: открытая в OBS сцена конфиг не перезапрашивает, и снять
    // оформление может только рассылка.
    await harness.prisma.subscription.update({
      where: { userId: owner.userId },
      data: { currentPeriodEnd: new Date(Date.now() - DAY_MS), autoRenew: false },
    });

    const maintenance = harness.app.get(MaintenanceService);
    expect(await maintenance.refreshStyling()).toBe(1);
    // Проход идемпотентен по результату: он снова разошлёт тот же базовый
    // конфиг. Отмечать «уже разослано» значило бы хранить ещё одно состояние,
    // а цена — одно сообщение шины в сутки на виджет.
    expect(await maintenance.refreshStyling()).toBe(1);

    // Кончившийся давно — тоже: его сцены уже подключались с базовым конфигом,
    // и ночная рассылка лишь перерисовывала бы их посреди эфира.
    await harness.prisma.subscription.update({
      where: { userId: owner.userId },
      data: { currentPeriodEnd: new Date(Date.now() - 60 * DAY_MS) },
    });
    expect(await maintenance.refreshStyling()).toBe(0);

    // У оплаченного тарифа рассылать нечего.
    await harness.prisma.subscription.update({
      where: { userId: owner.userId },
      data: { currentPeriodEnd: new Date(Date.now() + DAY_MS) },
    });
    expect(await maintenance.refreshStyling()).toBe(0);
  });

  it('комнаты — только в «Про»: «Мультистрим» их не открывает', async () => {
    const owner = await streamer();
    await subscribed(owner.token, 'multistream');

    const view = await request(server())
      .get('/api/billing/subscription')
      .set(auth(owner.token))
      .expect(200);
    expect(view.body).toMatchObject({
      plan: 'multistream',
      roomsAccess: false,
      features: { rooms: false, platforms: null, widgets: null, advancedStyling: false },
    });

    await request(server())
      .post('/api/rooms')
      .set(auth(owner.token))
      .send({ name: 'Подкаст' })
      .expect(402);
  });

  it('смена тарифа меняет сумму продления и требует нового письма о списании', async () => {
    const owner = await streamer();
    await subscribed(owner.token);
    // Письмо о текущем конце периода уже ушло — после смены тарифа оно называет
    // не ту сумму, и списывать по нему нельзя.
    await harness.prisma.subscription.updateMany({
      where: { userId: owner.userId },
      data: { renewalNoticeFor: new Date(), renewalNoticeSentAt: new Date() },
    });

    const changed = await request(server())
      .patch('/api/billing/subscription')
      .set(auth(owner.token))
      .send({ plan: 'multistream' })
      .expect(200);

    // Доступ до конца оплаченного периода не меняется: «Про» ещё действует.
    expect(changed.body).toMatchObject({
      plan: 'pro',
      nextPlan: 'multistream',
      roomsAccess: true,
      renewalAmount: PLAN_PRICES.multistream.month,
    });
    const row = await harness.prisma.subscription.findUniqueOrThrow({
      where: { userId: owner.userId },
    });
    expect(row.renewalNoticeFor).toBeNull();
  });

  it('вторую площадку на тарифе с одной не подключить, а лишняя выключается уборкой', async () => {
    const owner = await streamer();
    const twitch = await harness.prisma.channel.create({
      data: {
        userId: owner.userId,
        platform: 'TWITCH',
        externalId: 'tw-1',
        login: 'streamer',
        displayName: 'Стример',
      },
    });

    // Подключение второй площадки на бесплатном тарифе — отказ с меткой, по
    // которой дашборд объясняет, что делать.
    const states = harness.app.get(OAuthStateService);
    const state = await states.issue(owner.userId, 'youtube');
    const response = await request(server())
      .get(`/api/integrations/youtube/callback?code=code&state=${state}`)
      .set('Cookie', `sk_oauth_state=${state}`)
      .expect(302);
    expect(response.headers.location).toContain('status=plan-limit');
    expect(await harness.prisma.channel.count({ where: { userId: owner.userId } })).toBe(1);

    // А если площадок уже две (подключались на платном тарифе) — ночная уборка
    // оставляет активной самую старую, не удаляя вторую.
    const youtube = await harness.prisma.channel.create({
      data: {
        userId: owner.userId,
        platform: 'YOUTUBE',
        externalId: 'UC' + 'y'.repeat(22),
        login: '@streamer',
        displayName: 'Стример на YouTube',
      },
    });
    expect(await harness.app.get(MaintenanceService).enforcePlatformLimits()).toBe(1);
    const channels = await harness.prisma.channel.findMany({
      where: { userId: owner.userId },
      select: { id: true, isEnabled: true },
      orderBy: { createdAt: 'asc' },
    });
    expect(channels).toEqual([
      { id: twitch.id, isEnabled: true },
      { id: youtube.id, isEnabled: false },
    ]);

    // Повторное подключение выключенной площадки чинит доступ, но не включает
    // её рядом с активной: иначе лимит обходился бы переподключением.
    const registry = harness.app.get(PlatformRegistry);
    const reconnect = vi.spyOn(registry, 'require').mockReturnValue({
      exchangeCode: async () => ({
        accessToken: 'yt-access',
        refreshToken: 'yt-refresh',
        scopes: [],
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      }),
      fetchIdentity: async () => ({
        externalId: 'UC' + 'y'.repeat(22),
        login: '@streamer',
        displayName: 'Стример на YouTube',
        avatarUrl: null,
      }),
    } as unknown as PlatformProvider);
    try {
      const again = await states.issue(owner.userId, 'youtube');
      const back = await request(server())
        .get(`/api/integrations/youtube/callback?code=code&state=${again}`)
        .set('Cookie', `sk_oauth_state=${again}`)
        .expect(302);
      expect(back.headers.location).not.toContain('plan-limit');
    } finally {
      reconnect.mockRestore();
    }
    expect(
      await harness.prisma.channel.findUniqueOrThrow({
        where: { id: youtube.id },
        select: { isEnabled: true },
      }),
    ).toEqual({ isEnabled: false });

    // Стример выбирает, какая из двух работает: включение одной выключает другую.
    await request(server())
      .patch(`/api/channels/${youtube.id}`)
      .set(auth(owner.token))
      .send({ isEnabled: true })
      .expect(204);
    const switched = await harness.prisma.channel.findMany({
      where: { userId: owner.userId },
      select: { id: true, isEnabled: true },
      orderBy: { createdAt: 'asc' },
    });
    expect(switched).toEqual([
      { id: twitch.id, isEnabled: false },
      { id: youtube.id, isEnabled: true },
    ]);
  });

  it('комнаты закрыты без подписки и открыты с ней', async () => {
    const owner = await streamer();
    const denied = await request(server())
      .post('/api/rooms')
      .set(auth(owner.token))
      .send({ name: 'Подкаст' })
      .expect(402);
    expect(denied.body.code).toBe('subscription_required');

    await subscribed(owner.token);
    const room = await request(server())
      .post('/api/rooms')
      .set(auth(owner.token))
      .send({ name: 'Подкаст' })
      .expect(201);
    await request(server())
      .post(`/api/rooms/${room.body.id as string}/host-access`)
      .set(auth(owner.token))
      .expect(200);
  });

  it('после конца оплаченного периода стример, гость и оверлей в комнату не попадают', async () => {
    const owner = await streamer();
    await subscribed(owner.token);
    const room = await request(server())
      .post('/api/rooms')
      .set(auth(owner.token))
      .send({ name: 'Подкаст' })
      .expect(201);
    const roomId = room.body.id as string;
    const invite = await request(server())
      .post(`/api/rooms/${roomId}/invites`)
      .set(auth(owner.token))
      .send({ label: 'Вася' })
      .expect(201);
    const inviteToken = (invite.body.url as string).split('#')[1]!;
    const widget = await request(server())
      .post('/api/widgets')
      .set(auth(owner.token))
      .send({ name: 'Гости', type: 'guests', config: { roomId } })
      .expect(201);
    const obs = await request(server())
      .post(`/api/widgets/${widget.body.id as string}/tokens`)
      .set(auth(owner.token))
      .send({})
      .expect(201);
    const obsToken = new URL(obs.body.url as string).searchParams.get('token')!;

    // Автопродление выключено, период кончился вчера.
    await harness.prisma.subscription.update({
      where: { userId: owner.userId },
      data: { autoRenew: false, currentPeriodEnd: new Date(Date.now() - DAY_MS) },
    });

    await request(server())
      .post(`/api/rooms/${roomId}/host-access`)
      .set(auth(owner.token))
      .expect(402);
    await request(server())
      .post('/api/rooms/join')
      .send({ token: inviteToken, displayName: 'Вася', acceptTerms: true })
      .expect(402);
    // Согласие гостя, которого не впустили, не записывается.
    expect(await harness.prisma.guestConsent.count()).toBe(0);
    await request(server()).post('/api/overlay/room-access').send({ token: obsToken }).expect(404);

    // Вошедшего по токену, выданному до конца периода, выгоняет проверка входа.
    const status = await harness.app
      .get((await import('../src/modules/rooms/rooms.service')).RoomsService)
      .enforceJoin(`room-${roomId}`, guestIdentity(invite.body.id as string, 'late'));
    expect(status).toBe('removed');
  });

  it('в льготные дни при включённом автопродлении комнаты открыты', async () => {
    const owner = await streamer();
    await subscribed(owner.token);
    await harness.prisma.subscription.update({
      where: { userId: owner.userId },
      data: { currentPeriodEnd: new Date(Date.now() - DAY_MS) },
    });
    const view = await request(server())
      .get('/api/billing/subscription')
      .set(auth(owner.token))
      .expect(200);
    expect(view.body).toMatchObject({ status: 'grace', roomsAccess: true });
  });

  /** Период кончился вчера, списание по сохранённой карте не прошло и ждёт повтора. */
  async function inGrace(): Promise<{ token: string; userId: string }> {
    const owner = await streamer();
    await subscribed(owner.token);
    const end = new Date(Date.now() - DAY_MS);
    await harness.prisma.subscription.update({
      where: { userId: owner.userId },
      data: {
        currentPeriodEnd: end,
        renewalFailures: 1,
        // Повтор уже положен: письмо ушло, пауза после отказа прошла.
        nextRenewalAttemptAt: new Date(Date.now() - 60 * 1000),
        renewalNoticeFor: end,
        renewalNoticeSentAt: new Date(Date.now() - 5 * DAY_MS),
      },
    });
    return owner;
  }

  it('в льготные дни можно оплатить другой картой — она заменяет сохранённую', async () => {
    const owner = await inGrace();

    const { payment } = await checkout(owner.token, 'year', 'multistream');

    // До оплаты подписка не меняется: тариф льготных дней действует, и выбор в
    // неоплаченной форме не должен ни открывать, ни закрывать доступ.
    const before = await harness.prisma.subscription.findUniqueOrThrow({
      where: { userId: owner.userId },
    });
    expect(before).toMatchObject({
      plan: 'PRO',
      period: 'MONTH',
      renewalAmountMinor: PLAN_PRICES.pro.month.amountMinor,
    });
    // Пока стример на странице ЮKassa, повтор по старой карте не списывает:
    // иначе период был бы оплачен дважды.
    await billing.renewDue();
    expect(gateway.charged).toHaveLength(0);

    gateway.pay(payment.providerPaymentId!, {
      paymentMethod: { id: 'pm-new-1111', saved: true, title: 'Карта *1111' },
    });
    await notify(payment.providerPaymentId!).expect(200);

    const after = await harness.prisma.subscription.findUniqueOrThrow({
      where: { userId: owner.userId },
    });
    expect(after).toMatchObject({
      plan: 'MULTISTREAM',
      nextPlan: null,
      period: 'YEAR',
      renewalAmountMinor: PLAN_PRICES.multistream.year.amountMinor,
      paymentMethodTitle: 'Карта *1111',
      autoRenew: true,
      renewalFailures: 0,
      nextRenewalAttemptAt: null,
    });
    // Период — с момента оплаты: льготные дни в новый период не засчитываются.
    expect(after.currentPeriodEnd!.getTime()).toBeGreaterThan(Date.now() + 360 * DAY_MS);

    // Следующие продления — новой картой.
    await harness.prisma.subscription.update({
      where: { userId: owner.userId },
      data: {
        currentPeriodEnd: new Date(Date.now() + 12 * 60 * 60 * 1000),
        renewalNoticeFor: new Date(Date.now() + 12 * 60 * 60 * 1000),
        renewalNoticeSentAt: new Date(Date.now() - 4 * DAY_MS),
      },
    });
    await billing.renewDue();
    expect(gateway.charged.map((charge) => charge.paymentMethodId)).toEqual(['pm-new-1111']);
  });

  it('оплата другой картой не начинается, пока идёт списание по старой', async () => {
    const owner = await inGrace();
    const subscription = await harness.prisma.subscription.findUniqueOrThrow({
      where: { userId: owner.userId },
    });
    await harness.prisma.payment.create({
      data: {
        userId: owner.userId,
        subscriptionId: subscription.id,
        kind: 'RENEWAL',
        plan: subscription.plan,
        period: subscription.period,
        amountMinor: subscription.renewalAmountMinor,
        currency: subscription.renewalCurrency,
        renewalFor: subscription.currentPeriodEnd,
        attempt: 2,
      },
    });

    const response = await request(server())
      .post('/api/billing/checkout')
      .set(auth(owner.token))
      .send({ plan: 'pro', period: 'month', acceptOffer: true })
      .expect(409);
    expect(response.body.message).toContain('ещё обрабатывается');
    expect(gateway.created).toHaveLength(1);
  });

  it('действующей подписке вторая оплата не нужна — 409', async () => {
    const owner = await streamer();
    await subscribed(owner.token);
    await request(server())
      .post('/api/billing/checkout')
      .set(auth(owner.token))
      .send({ plan: 'pro', period: 'month', acceptOffer: true })
      .expect(409);
  });

  /* ---------------------------------------------------------------- */
  /* Продление                                                          */
  /* ---------------------------------------------------------------- */

  /**
   * Подписка, которая кончится через 12 часов: продление уже положено, письмо о
   * списании ушло четыре дня назад.
   */
  async function dueSoon(): Promise<{ userId: string; end: Date }> {
    const owner = await streamer();
    await subscribed(owner.token);
    const end = new Date(Date.now() + 12 * 60 * 60 * 1000);
    await harness.prisma.subscription.update({
      where: { userId: owner.userId },
      data: {
        currentPeriodEnd: end,
        renewalNoticeFor: end,
        renewalNoticeSentAt: new Date(Date.now() - 4 * DAY_MS),
      },
    });
    return { userId: owner.userId, end };
  }

  it('заблокированному аккаунту продление не списывается, а комнаты закрыты', async () => {
    const { userId } = await dueSoon();
    await harness.prisma.user.update({ where: { id: userId }, data: { status: 'SUSPENDED' } });

    await billing.renewDue();
    expect(gateway.charged).toHaveLength(0);
    expect(await billing.roomsAccess(userId)).toBe(false);
  });

  it('бесплатные дни сдвигают конец периода и требуют нового письма о списании', async () => {
    const { userId, end } = await dueSoon();

    const view = await billing.extend(userId, 10, 'pro');

    expect(new Date(view.currentPeriodEnd!).getTime()).toBe(end.getTime() + 10 * DAY_MS);
    const row = await harness.prisma.subscription.findUniqueOrThrow({ where: { userId } });
    expect(row.renewalNoticeFor).toBeNull();
    expect(await harness.prisma.payment.count({ where: { userId } })).toBe(1);

    // Прежнее письмо называло другую дату — без нового списания нет.
    await billing.renewDue(new Date(end.getTime() + 9.5 * DAY_MS));
    expect(gateway.charged).toHaveLength(0);
  });

  it('снятие подарочных дней забирает подаренное и не трогает оплаченное', async () => {
    const owner = await streamer();
    const now = new Date();

    // Подарок поверх оплаченного месяца: снимаем ровно подаренное.
    await subscribed(owner.token);
    const paid = await harness.prisma.subscription.findUniqueOrThrow({
      where: { userId: owner.userId },
    });
    await billing.extend(owner.userId, 10, 'pro', {}, now);

    const view = await billing.revokeGift(owner.userId, 10, {}, now);

    expect(view.giftedDays).toBe(0);
    expect(new Date(view.currentPeriodEnd!).getTime()).toBe(paid.currentPeriodEnd!.getTime());
    // Письмо о списании называло прежнюю дату — после сдвига оно не про неё.
    const row = await harness.prisma.subscription.findUniqueOrThrow({
      where: { userId: owner.userId },
    });
    expect(row.renewalNoticeFor).toBeNull();
  });

  it('снять больше подаренного нельзя, а без подарка — нечего', async () => {
    const owner = await streamer();
    const now = new Date();
    await billing.extend(owner.userId, 5, 'pro', {}, now);

    // Запрос на тридцать дней снимает пять: остальное не подарено.
    const view = await billing.revokeGift(owner.userId, 30, {}, now);
    expect(view.giftedDays).toBe(0);
    expect(new Date(view.currentPeriodEnd!).getTime()).toBe(now.getTime());
    expect(view.roomsAccess).toBe(false);

    // Подарок снят целиком — снимать больше нечего.
    await expect(billing.revokeGift(owner.userId, 1, {}, now)).rejects.toThrow(
      'Подарочных дней у этой подписки нет',
    );
  });

  it('бесплатные дни без подписки открывают комнаты без автопродления', async () => {
    const owner = await streamer();
    const now = new Date();

    const view = await billing.extend(owner.userId, 7, 'pro', {}, now);

    expect(view).toMatchObject({ status: 'active', autoRenew: false, roomsAccess: true });
    expect(new Date(view.currentPeriodEnd!).getTime()).toBe(now.getTime() + 7 * DAY_MS);
  });

  it('бесплатные дни дарят выбранный тариф: «Мультистрим» комнат не открывает', async () => {
    const owner = await streamer();
    const now = new Date();

    const view = await billing.extend(owner.userId, 7, 'multistream', {}, now);

    expect(view).toMatchObject({
      status: 'active',
      plan: 'multistream',
      roomsAccess: false,
      features: { platforms: null, widgets: null, rooms: false },
      renewalAmount: PLAN_PRICES.multistream.month,
    });
  });

  it('кончившейся подписке подарок меняет тариф, но не цену продления', async () => {
    // Оплачивал «Мультистрим», подписка кончилась, дарят «Про». Продление,
    // если его включат, обязано списать ту цену, что называла подписка, — за
    // «Мультистрим», а не за подаренный тариф.
    const owner = await streamer();
    await subscribed(owner.token, 'multistream');
    await harness.prisma.subscription.update({
      where: { userId: owner.userId },
      data: { currentPeriodEnd: new Date(Date.now() - 30 * DAY_MS), autoRenew: false },
    });

    const view = await billing.extend(owner.userId, 7, 'pro');

    expect(view).toMatchObject({
      status: 'active',
      plan: 'pro',
      nextPlan: 'multistream',
      roomsAccess: true,
      renewalAmount: PLAN_PRICES.multistream.month,
    });
  });

  it('действующей подписке другой тариф не подарить — дни продлевают её тариф', async () => {
    const owner = await streamer();
    await subscribed(owner.token, 'multistream');
    const before = await harness.prisma.subscription.findUniqueOrThrow({
      where: { userId: owner.userId },
    });

    await expect(billing.extend(owner.userId, 7, 'pro')).rejects.toThrow('другой тариф');

    const after = await harness.prisma.subscription.findUniqueOrThrow({
      where: { userId: owner.userId },
    });
    expect(after).toMatchObject({
      plan: 'MULTISTREAM',
      currentPeriodEnd: before.currentPeriodEnd,
      giftedDays: 0,
    });
    // Тот же тариф — обычное продление подарком.
    const view = await billing.extend(owner.userId, 7, 'multistream');
    expect(new Date(view.currentPeriodEnd!).getTime()).toBe(
      before.currentPeriodEnd!.getTime() + 7 * DAY_MS,
    );
  });

  it('письмо о списании уходит за три дня до окна продления, один раз и с суммой подписки', async () => {
    const owner = await streamer();
    await subscribed(owner.token);
    const now = new Date();
    const end = new Date(now.getTime() + 3.5 * DAY_MS);
    await harness.prisma.subscription.update({
      where: { userId: owner.userId },
      data: { currentPeriodEnd: end },
    });

    expect(await billing.sendRenewalNotices(now)).toBe(1);
    expect(await billing.sendRenewalNotices(now)).toBe(0);
    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0]!.to).toBe(owner.email);
    expect(mailer.sent[0]!.text).toContain(String(PLAN_PRICES.pro.month.amountMinor / 100));
    expect(mailer.sent[0]!.text).toContain('/billing');

    // Через сутки окно продления уже открыто, но трёх дней с письма нет.
    await billing.renewDue(new Date(now.getTime() + 2.6 * DAY_MS));
    expect(gateway.charged).toHaveLength(0);
    await billing.renewDue(new Date(now.getTime() + 3.01 * DAY_MS));
    expect(gateway.charged).toHaveLength(1);
  });

  it('без письма о списании продление не списывается', async () => {
    const { userId } = await dueSoon();
    await harness.prisma.subscription.update({
      where: { userId },
      data: { renewalNoticeFor: null, renewalNoticeSentAt: null },
    });

    await billing.renewDue();
    expect(gateway.charged).toHaveLength(0);
  });

  it('без настроенной почты письма не уходят — и продления не списываются', async () => {
    const owner = await streamer();
    mailer.configured = false;
    await subscribed(owner.token);
    await harness.prisma.subscription.update({
      where: { userId: owner.userId },
      data: { currentPeriodEnd: new Date(Date.now() + 12 * 60 * 60 * 1000) },
    });

    expect(await billing.sendRenewalNotices()).toBe(0);
    await billing.renewDue(new Date(Date.now() + 3 * DAY_MS));
    expect(gateway.charged).toHaveLength(0);
  });

  it('упавшая отправка письма не считается отправленной', async () => {
    const owner = await streamer();
    await subscribed(owner.token);
    await harness.prisma.subscription.update({
      where: { userId: owner.userId },
      data: { currentPeriodEnd: new Date(Date.now() + 2 * DAY_MS) },
    });
    mailer.fail = true;

    expect(await billing.sendRenewalNotices()).toBe(0);
    const row = await harness.prisma.subscription.findUniqueOrThrow({
      where: { userId: owner.userId },
    });
    expect(row.renewalNoticeFor).toBeNull();

    mailer.fail = false;
    expect(await billing.sendRenewalNotices()).toBe(1);
  });

  /** Оплаченный месяц без автопродления, кончающийся через `days` дней. */
  async function paidWithoutRenewal(days: number) {
    const owner = await streamer();
    const paymentId = await subscribed(owner.token);
    const end = new Date(Date.now() + days * DAY_MS);
    await harness.prisma.subscription.update({
      where: { userId: owner.userId },
      data: { currentPeriodEnd: end, autoRenew: false },
    });
    await harness.prisma.payment.update({ where: { id: paymentId }, data: { periodEnd: end } });
    return owner;
  }

  it('неподтверждённой почте писем о списании и конце периода нет', async () => {
    const renewing = await streamer();
    await subscribed(renewing.token);
    await harness.prisma.subscription.update({
      where: { userId: renewing.userId },
      data: { currentPeriodEnd: new Date(Date.now() + 12 * 60 * 60 * 1000) },
    });
    await paidWithoutRenewal(2);
    await harness.prisma.user.updateMany({ data: { emailVerifiedAt: null } });
    mailer.sent.length = 0;

    expect(await billing.sendRenewalNotices()).toBe(0);
    expect(await billing.sendExpiryNotices()).toBe(0);
    expect(mailer.sent).toHaveLength(0);
    // Без письма нет и списания.
    await billing.renewDue(new Date(Date.now() + 3 * DAY_MS));
    expect(gateway.charged).toHaveLength(0);
  });

  it('без автопродления оплаченный период кончается письмом — одним, на языке аккаунта', async () => {
    const owner = await paidWithoutRenewal(2);
    await harness.prisma.user.update({ where: { id: owner.userId }, data: { language: 'en' } });

    expect(await billing.sendExpiryNotices()).toBe(1);
    expect(await billing.sendExpiryNotices()).toBe(0);
    expect(await billing.sendRenewalNotices()).toBe(0);
    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0]!.to).toBe(owner.email);
    expect(mailer.sent[0]!.subject).toContain('“Pro” plan is paid until');
    expect(mailer.sent[0]!.html).toContain('/account/billing?lang=en');
  });

  it('о конце оплаченного периода не пишут раньше срока', async () => {
    await paidWithoutRenewal(10);
    expect(await billing.sendExpiryNotices()).toBe(0);
  });

  it('подаренные дни кончаются без письма', async () => {
    const owner = await paidWithoutRenewal(2);
    // Подарок сдвигает конец за пределы оплаченного: кончается уже подарок.
    await billing.extend(owner.userId, 1, 'pro');
    expect(await billing.sendExpiryNotices()).toBe(0);
    expect(mailer.sent).toHaveLength(0);
  });

  it('возвращённый платёж — не оплаченный период', async () => {
    const owner = await paidWithoutRenewal(2);
    await harness.prisma.payment.updateMany({
      where: { userId: owner.userId },
      data: { refundedAt: new Date() },
    });
    expect(await billing.sendExpiryNotices()).toBe(0);
  });

  it('при включённом автопродлении письмо о конце периода не уходит — уходит о списании', async () => {
    const owner = await streamer();
    await subscribed(owner.token);
    expect(await billing.sendExpiryNotices()).toBe(0);
  });

  it('упавшая отправка письма о конце периода повторяется следующим тактом', async () => {
    await paidWithoutRenewal(2);
    mailer.fail = true;
    expect(await billing.sendExpiryNotices()).toBe(0);
    mailer.fail = false;
    expect(await billing.sendExpiryNotices()).toBe(1);
  });

  it('смена периода меняет сумму продления и требует нового письма', async () => {
    const { userId } = await dueSoon();
    const owner = await harness.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const token = (
      await request(server())
        .post('/api/auth/login')
        .send({ email: owner.email, password: registrationPayload().password })
        .expect(200)
    ).body.accessToken as string;

    const view = await request(server())
      .patch('/api/billing/subscription')
      .set(auth(token))
      .send({ period: 'year' })
      .expect(200);
    expect(view.body.renewalAmount).toEqual(PLAN_PRICES.pro.year);

    await billing.renewDue();
    expect(gateway.charged).toHaveLength(0);
  });

  it('продление списывает цену подписки, а не текущий прайс', async () => {
    const { userId } = await dueSoon();
    await harness.prisma.subscription.update({
      where: { userId },
      data: { renewalAmountMinor: 39_000 },
    });

    await billing.renewDue();
    expect(gateway.charged[0]).toMatchObject({ amountMinor: 39_000 });
  });

  it('за сутки до конца списывает продление по сохранённому способу, от конца периода', async () => {
    const { userId, end } = await dueSoon();

    await billing.renewDue();

    expect(gateway.charged).toHaveLength(1);
    expect(gateway.charged[0]).toMatchObject({
      paymentMethodId: 'pm-secret-4444',
      amountMinor: PLAN_PRICES.pro.month.amountMinor,
    });
    const row = await harness.prisma.subscription.findUniqueOrThrow({ where: { userId } });
    // Оплаченные 12 часов не теряются: новый период начинается с конца старого.
    const renewal = await harness.prisma.payment.findFirstOrThrow({
      where: { userId, kind: 'RENEWAL' },
    });
    expect(renewal.status).toBe('SUCCEEDED');
    expect(renewal.periodStart!.getTime()).toBe(end.getTime());
    expect(row.currentPeriodEnd!.getTime()).toBe(renewal.periodEnd!.getTime());

    // Следующий такт ничего не списывает: до нового конца больше суток.
    await billing.renewDue();
    expect(gateway.charged).toHaveLength(1);
  });

  it('два одновременных такта воркера списывают продление один раз', async () => {
    await dueSoon();
    await Promise.all([billing.renewDue(), billing.renewDue(), billing.renewDue()]);
    expect(new Set(gateway.charged.map((charge) => charge.paymentId)).size).toBe(1);
    expect(await harness.prisma.payment.count({ where: { kind: 'RENEWAL' } })).toBe(1);
  });

  it('отказ банка — повтор через сутки, после последней попытки автопродление выключено', async () => {
    const { userId } = await dueSoon();
    gateway.chargeOutcome = { status: 'canceled', reason: 'insufficient_funds' };

    await billing.renewDue();
    let row = await harness.prisma.subscription.findUniqueOrThrow({ where: { userId } });
    expect(row).toMatchObject({ renewalFailures: 1, autoRenew: true });
    expect(row.nextRenewalAttemptAt!.getTime()).toBeGreaterThan(Date.now() + 23 * 60 * 60 * 1000);

    // Сейчас — рано: повтор назначен на завтра.
    await billing.renewDue();
    expect(gateway.charged).toHaveLength(1);

    for (let attempt = 2; attempt <= MAX_RENEWAL_ATTEMPTS; attempt += 1) {
      await billing.renewDue(new Date(Date.now() + attempt * DAY_MS));
    }
    row = await harness.prisma.subscription.findUniqueOrThrow({ where: { userId } });
    expect(gateway.charged).toHaveLength(MAX_RENEWAL_ATTEMPTS);
    expect(row).toMatchObject({ renewalFailures: MAX_RENEWAL_ATTEMPTS, autoRenew: false });
    // Способ оплаты жив — стример может включить продление снова.
    expect(row.paymentMethodEncrypted).toBeTruthy();
  });

  it('отказ ЮKassa магазину не считается отказом карты: продление откладывается на час', async () => {
    const { userId } = await dueSoon();
    // Неверные ключи магазина: так отвечали бы все продления разом.
    gateway.rejectCharge = 401;

    for (let tick = 0; tick <= MAX_RENEWAL_ATTEMPTS; tick += 1) {
      await billing.renewDue(new Date(Date.now() + tick * 2 * 60 * 60 * 1000));
    }

    let row = await harness.prisma.subscription.findUniqueOrThrow({ where: { userId } });
    expect(gateway.charged).toHaveLength(MAX_RENEWAL_ATTEMPTS + 1);
    expect(row).toMatchObject({ renewalFailures: 0, autoRenew: true });
    expect(row.paymentMethodEncrypted).toBeTruthy();
    // Платежа у ЮKassa не было — ни висящих, ни отменённых записей.
    expect(await harness.prisma.payment.count({ where: { userId, kind: 'RENEWAL' } })).toBe(0);

    // Ключи починили — продление проходит по расписанию.
    gateway.rejectCharge = null;
    await billing.renewDue(new Date(Date.now() + 9 * 60 * 60 * 1000));
    row = await harness.prisma.subscription.findUniqueOrThrow({ where: { userId } });
    expect(
      await harness.prisma.payment.count({
        where: { userId, kind: 'RENEWAL', status: 'SUCCEEDED' },
      }),
    ).toBe(1);
    expect(row.renewalFailures).toBe(0);
  });

  it('отказ ЮKassa в самом запросе по-прежнему считается неудачной попыткой', async () => {
    const { userId } = await dueSoon();
    gateway.rejectCharge = 400;

    await billing.renewDue();

    const row = await harness.prisma.subscription.findUniqueOrThrow({ where: { userId } });
    expect(row.renewalFailures).toBe(1);
    const renewal = await harness.prisma.payment.findFirstOrThrow({
      where: { userId, kind: 'RENEWAL' },
    });
    expect(renewal).toMatchObject({ status: 'CANCELED', cancellationReason: 'gateway_rejected' });
  });

  it('после льготных дней продление не списывается, даже если письмо ушло поздно', async () => {
    const { userId, end } = await dueSoon();
    // Почта лежала: письмо ушло во второй льготный день, и три дня с него
    // истекают уже после льготных.
    await harness.prisma.subscription.update({
      where: { userId },
      data: { renewalNoticeSentAt: new Date(end.getTime() + 2 * DAY_MS) },
    });

    await billing.renewDue(new Date(end.getTime() + 5.1 * DAY_MS));
    expect(gateway.charged).toHaveLength(0);
  });

  it('оформление на кончившейся подписке сбрасывает старое письмо и автопродление', async () => {
    const { userId } = await dueSoon();
    const owner = await harness.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    // Подписка кончилась за льготными днями, а автопродление и свежее письмо остались.
    const ended = new Date(Date.now() - 3.5 * DAY_MS);
    await harness.prisma.subscription.update({
      where: { userId },
      data: { currentPeriodEnd: ended, renewalNoticeFor: ended },
    });
    const token = await harness.app
      .get(TokenService)
      .issueAccessToken({ id: userId, email: owner.email });

    // Выбрал «Про» на год и бросил страницу оплаты.
    const { payment } = await checkout(token, 'year');
    gateway.cancel(payment.providerPaymentId!, 'expired_on_confirmation');
    await notify(payment.providerPaymentId!).expect(200);

    const row = await harness.prisma.subscription.findUniqueOrThrow({ where: { userId } });
    expect(row).toMatchObject({ autoRenew: false, renewalNoticeFor: null });
    await billing.renewDue();
    expect(gateway.charged).toHaveLength(0);
  });

  it('на кончившейся подписке автопродление не включить — льготные дни так не получить', async () => {
    const owner = await streamer();
    await subscribed(owner.token);
    await request(server())
      .patch('/api/billing/subscription')
      .set(auth(owner.token))
      .send({ autoRenew: false })
      .expect(200);
    await harness.prisma.subscription.update({
      where: { userId: owner.userId },
      data: { currentPeriodEnd: new Date(Date.now() - DAY_MS) },
    });

    await request(server())
      .patch('/api/billing/subscription')
      .set(auth(owner.token))
      .send({ autoRenew: true, acceptOffer: true })
      .expect(409);
    const view = await request(server())
      .get('/api/billing/subscription')
      .set(auth(owner.token))
      .expect(200);
    expect(view.body).toMatchObject({ status: 'expired', plan: 'free', autoRenew: false });
  });

  it('отозванный доступ к карте выключает продление сразу и стирает способ оплаты', async () => {
    const { userId } = await dueSoon();
    gateway.chargeOutcome = { status: 'canceled', reason: 'permission_revoked' };

    await billing.renewDue();
    const row = await harness.prisma.subscription.findUniqueOrThrow({ where: { userId } });
    expect(row).toMatchObject({
      autoRenew: false,
      paymentMethodEncrypted: null,
      paymentMethodTitle: null,
    });
  });

  it('выключенное автопродление не списывает и отзывает согласие на списания', async () => {
    const owner = await streamer();
    await subscribed(owner.token);
    await request(server())
      .patch('/api/billing/subscription')
      .set(auth(owner.token))
      .send({ autoRenew: false })
      .expect(200);
    await harness.prisma.subscription.update({
      where: { userId: owner.userId },
      data: { currentPeriodEnd: new Date(Date.now() + 60 * 60 * 1000) },
    });

    await billing.renewDue();
    expect(gateway.charged).toHaveLength(0);
    const consent = await harness.prisma.consent.findFirstOrThrow({
      where: { userId: owner.userId, document: 'SUBSCRIPTION_OFFER' },
    });
    expect(consent.revokedAt).not.toBeNull();

    // Обратно — только с новым согласием.
    await request(server())
      .patch('/api/billing/subscription')
      .set(auth(owner.token))
      .send({ autoRenew: true })
      .expect(400);
    await request(server())
      .patch('/api/billing/subscription')
      .set(auth(owner.token))
      .send({ autoRenew: true, acceptOffer: true })
      .expect(200);
  });

  it('отвязка способа оплаты стирает его, выключает автопродление и ничего не списывает', async () => {
    // У ЮKassa отозвать сохранённый способ нельзя — отвязка это удаление его
    // идентификатора у нас. После неё списать не по чему, а доступ до конца
    // оплаченного периода остаётся (оферта, 5.6).
    const owner = await streamer();
    await subscribed(owner.token);

    const response = await request(server())
      .delete('/api/billing/payment-method')
      .set(auth(owner.token))
      .expect(200);
    expect(response.body).toMatchObject({
      plan: 'pro',
      status: 'active',
      autoRenew: false,
      paymentMethodTitle: null,
    });

    const row = await harness.prisma.subscription.findUniqueOrThrow({
      where: { userId: owner.userId },
    });
    expect(row).toMatchObject({ autoRenew: false, paymentMethodEncrypted: null });
    const consent = await harness.prisma.consent.findFirstOrThrow({
      where: { userId: owner.userId, document: 'SUBSCRIPTION_OFFER' },
    });
    expect(consent.revokedAt).not.toBeNull();

    await harness.prisma.subscription.update({
      where: { userId: owner.userId },
      data: { currentPeriodEnd: new Date(Date.now() + 60 * 60 * 1000) },
    });
    await billing.renewDue();
    expect(gateway.charged).toHaveLength(0);

    // Включить автопродление без способа оплаты нельзя — только новой оплатой.
    await request(server())
      .patch('/api/billing/subscription')
      .set(auth(owner.token))
      .send({ autoRenew: true, acceptOffer: true })
      .expect(409);
    // Повтор ничего не ломает: отвязывать уже нечего.
    await request(server())
      .delete('/api/billing/payment-method')
      .set(auth(owner.token))
      .expect(200);
    expect(
      await harness.prisma.auditLog.count({
        where: { userId: owner.userId, action: 'billing.payment_method.removed' },
      }),
    ).toBe(1);
  });

  it('продление, подтверждённое после отвязки, не возвращает отвязанную карту', async () => {
    // Продление списано и ждёт подтверждения, стример в это время отвязал
    // карту. ЮKassa подтверждает платёж с `saved: true` — это её же
    // сохранённый способ, — и запись его заново вернула бы карту, а с ней и
    // возможность включить автопродление без новой оплаты.
    const owner = await streamer();
    await subscribed(owner.token);
    const subscription = await harness.prisma.subscription.findUniqueOrThrow({
      where: { userId: owner.userId },
    });
    const renewal = await harness.prisma.payment.create({
      data: {
        userId: owner.userId,
        subscriptionId: subscription.id,
        kind: 'RENEWAL',
        plan: subscription.plan,
        period: subscription.period,
        amountMinor: subscription.renewalAmountMinor,
        currency: subscription.renewalCurrency,
        renewalFor: subscription.currentPeriodEnd,
        attempt: 1,
        providerPaymentId: 'yk-renewal-in-flight',
      },
    });
    gateway.payments.set('yk-renewal-in-flight', {
      id: 'yk-renewal-in-flight',
      status: 'succeeded',
      amountMinor: renewal.amountMinor,
      currency: renewal.currency,
      paymentId: renewal.id,
      paymentMethod: { id: 'pm-saved', saved: true, title: 'Карта *4444' },
      cancellationReason: null,
      confirmationUrl: null,
    });

    await request(server())
      .delete('/api/billing/payment-method')
      .set(auth(owner.token))
      .expect(200);
    expect(await billing.handleNotification('yk-renewal-in-flight')).toBe('processed');

    const row = await harness.prisma.subscription.findUniqueOrThrow({
      where: { userId: owner.userId },
    });
    // Оплаченный период продлён — деньги списаны, — а карта осталась отвязанной.
    expect(row.currentPeriodEnd!.getTime()).toBeGreaterThan(
      subscription.currentPeriodEnd!.getTime(),
    );
    expect(row).toMatchObject({
      paymentMethodEncrypted: null,
      paymentMethodTitle: null,
      autoRenew: false,
    });
  });

  it('отвязка без подписки — 404', async () => {
    const owner = await streamer();
    await request(server())
      .delete('/api/billing/payment-method')
      .set(auth(owner.token))
      .expect(404);
  });

  it('отзыв оферты в разделе «Приватность» выключает автопродление', async () => {
    const owner = await streamer();
    await subscribed(owner.token);

    // Принять оферту оттуда нельзя: согласие на списания даётся при оплате.
    await request(server())
      .post('/api/privacy/consents')
      .set(auth(owner.token))
      .send({ document: 'SUBSCRIPTION_OFFER' })
      .expect(400);
    await request(server())
      .post('/api/privacy/consents/revoke')
      .set(auth(owner.token))
      .send({ document: 'SUBSCRIPTION_OFFER' })
      .expect(204);

    const row = await harness.prisma.subscription.findUniqueOrThrow({
      where: { userId: owner.userId },
    });
    expect(row.autoRenew).toBe(false);
  });

  /* ---------------------------------------------------------------- */
  /* Приватность                                                        */
  /* ---------------------------------------------------------------- */

  function notifyRefund(providerPaymentId: string) {
    return request(server())
      .post('/api/billing/yookassa/webhook')
      .send({
        type: 'notification',
        event: 'refund.succeeded',
        object: { id: 'refund-1', payment_id: providerPaymentId, status: 'succeeded' },
      });
  }

  it('возврат по текущему периоду закрывает доступ и выключает продление; повтор ничего не удваивает', async () => {
    const owner = await streamer();
    const paymentId = await subscribed(owner.token);
    const payment = await harness.prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
    // Возврат за неиспользованные дни — часть суммы.
    gateway.refunds.set(payment.providerPaymentId!, 30_000);

    const first = await notifyRefund(payment.providerPaymentId!).expect(200);
    expect(first.body.status).toBe('processed');
    const second = await notifyRefund(payment.providerPaymentId!).expect(200);
    expect(second.body.status).toBe('ignored');

    const row = await harness.prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
    expect(row.refundedAmountMinor).toBe(30_000);
    const view = await request(server())
      .get('/api/billing/subscription')
      .set(auth(owner.token))
      .expect(200);
    expect(view.body).toMatchObject({ status: 'expired', roomsAccess: false, autoRenew: false });
    const history = await request(server())
      .get('/api/billing/payments')
      .set(auth(owner.token))
      .expect(200);
    expect(history.body[0]).toMatchObject({ refundedAmountMinor: 30_000 });
  });

  it('возврат закрывает доступ и тогда, когда поверх периода подарены дни', async () => {
    const owner = await streamer();
    const paymentId = await subscribed(owner.token);
    const payment = await harness.prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
    await billing.extend(owner.userId, 10, 'pro');

    gateway.refunds.set(payment.providerPaymentId!, payment.amountMinor);
    await notifyRefund(payment.providerPaymentId!).expect(200);

    const view = await request(server())
      .get('/api/billing/subscription')
      .set(auth(owner.token))
      .expect(200);
    expect(view.body).toMatchObject({ status: 'expired', plan: 'free', giftedDays: 0 });
  });

  it('возврат прошлого периода не закрывает уже оплаченный следующий', async () => {
    const { userId } = await dueSoon();
    await billing.renewDue();
    const initial = await harness.prisma.payment.findFirstOrThrow({
      where: { userId, kind: 'INITIAL' },
    });
    const renewed = await harness.prisma.subscription.findUniqueOrThrow({ where: { userId } });

    // Возврат за последние полсуток первого месяца.
    gateway.refunds.set(initial.providerPaymentId!, 1_000);
    await notifyRefund(initial.providerPaymentId!).expect(200);

    const row = await harness.prisma.subscription.findUniqueOrThrow({ where: { userId } });
    expect(row.currentPeriodEnd!.getTime()).toBe(renewed.currentPeriodEnd!.getTime());
    expect(row.autoRenew).toBe(true);
  });

  it('уведомление о возврате по чужому или неоплаченному платежу не идёт в ЮKassa', async () => {
    const owner = await streamer();
    const { payment } = await checkout(owner.token);

    await notifyRefund('yk-unknown').expect(200);
    await notifyRefund(payment.providerPaymentId!).expect(200);
    expect(gateway.refundQueries).toBe(0);
  });

  it('уборка удаляет платежи старше срока хранения, но не незакрытые', async () => {
    const owner = await streamer();
    const paid = await subscribed(owner.token);
    const { payment: pending } = await checkout((await streamer()).token);
    const sixYearsAgo = new Date(Date.now() - 6 * 365 * DAY_MS);
    await harness.prisma.payment.updateMany({ data: { createdAt: sixYearsAgo } });

    const maintenance = harness.app.get(MaintenanceService);
    expect(await maintenance.purgeOldPayments(5 * 365)).toBe(1);
    expect(await harness.prisma.payment.findUnique({ where: { id: paid } })).toBeNull();
    expect(await harness.prisma.payment.findUnique({ where: { id: pending.id } })).not.toBeNull();
  });

  it('выгрузка включает подписку и платежи без способа оплаты; удаление аккаунта стирает его', async () => {
    const owner = await streamer();
    await subscribed(owner.token);

    const exported = await request(server())
      .get('/api/privacy/export')
      .set(auth(owner.token))
      .expect(200);
    expect(exported.body.subscription).toMatchObject({ autoRenew: true });
    expect(exported.body.payments).toHaveLength(1);
    expect(JSON.stringify(exported.body)).not.toContain('paymentMethodEncrypted');

    await request(server())
      .delete('/api/privacy/account')
      .set(auth(owner.token))
      .send({ confirmation: 'УДАЛИТЬ', password: registrationPayload().password })
      .expect((response) => expect(response.status).toBeLessThan(300));
    const row = await harness.prisma.subscription.findUniqueOrThrow({
      where: { userId: owner.userId },
    });
    expect(row).toMatchObject({ autoRenew: false, paymentMethodEncrypted: null });
    // Платежи — учёт выручки, они остаются.
    expect(await harness.prisma.payment.count({ where: { userId: owner.userId } })).toBe(1);
  });
});
