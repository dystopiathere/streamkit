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
  PLAN_PRICES,
  type RoomParticipant,
} from '@streamkit/contracts';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PlatformAuthError } from '../src/common/http/platform-errors';
import { MAILER, type MailMessage, type Mailer } from '../src/common/mail/mailer';
import { BillingService } from '../src/modules/billing/billing.service';
import { MaintenanceModule } from '../src/modules/maintenance/maintenance.module';
import { MaintenanceService } from '../src/modules/maintenance/maintenance.service';
import {
  type ChargeSavedRequest,
  type CreatePaymentRequest,
  PAYMENT_GATEWAY,
  type PaymentGateway,
  type ProviderPayment,
} from '../src/modules/billing/payment-gateway';
import { ROOM_MEDIA_SERVER, type RoomMediaServer } from '../src/modules/rooms/livekit.service';
import { createHarness, registrationPayload, type TestHarness } from './harness';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * ЮKassa в памяти. Ведёт себя как настоящая в том, что важно для денег: платёж
 * с тем же ключом идемпотентности — тот же платёж, а не новый.
 */
class FakeGateway implements PaymentGateway {
  readonly payments = new Map<string, ProviderPayment>();
  readonly created: CreatePaymentRequest[] = [];
  readonly charged: ChargeSavedRequest[] = [];
  gets = 0;
  failGet = false;
  failCreate = false;
  /** Отказ ЮKassa (4xx), а не сбой связи: так отвечает боевой магазин без автоплатежей. */
  rejectCreate = false;
  /** Чем ответит следующее списание по сохранённому способу. */
  chargeOutcome: { status: 'succeeded' } | { status: 'canceled'; reason: string } = {
    status: 'succeeded',
  };
  private sequence = 0;

  private byIdempotenceKey(paymentId: string): ProviderPayment | undefined {
    return [...this.payments.values()].find((payment) => payment.paymentId === paymentId);
  }

  async createPayment(request: CreatePaymentRequest): Promise<ProviderPayment> {
    if (this.failCreate) throw new Error('ЮKassa недоступна');
    if (this.rejectCreate) throw new PlatformAuthError('yookassa', 403, 'Площадка отвергла токен');
    this.created.push(request);
    const existing = this.byIdempotenceKey(request.paymentId);
    if (existing) return { ...existing };
    const id = `yk-${++this.sequence}`;
    const payment: ProviderPayment = {
      id,
      status: 'pending',
      amountMinor: request.amountMinor,
      currency: request.currency,
      paymentId: request.paymentId,
      paymentMethod: null,
      cancellationReason: null,
      confirmationUrl: `https://yookassa.test/confirm/${id}`,
    };
    this.payments.set(id, payment);
    return { ...payment };
  }

  async chargeSaved(request: ChargeSavedRequest): Promise<ProviderPayment> {
    this.charged.push(request);
    const existing = this.byIdempotenceKey(request.paymentId);
    if (existing) return { ...existing };
    const id = `yk-${++this.sequence}`;
    const outcome = this.chargeOutcome;
    const payment: ProviderPayment = {
      id,
      status: outcome.status,
      amountMinor: request.amountMinor,
      currency: request.currency,
      paymentId: request.paymentId,
      paymentMethod: { id: request.paymentMethodId, saved: true, title: 'Карта *4444' },
      cancellationReason: outcome.status === 'canceled' ? outcome.reason : null,
      confirmationUrl: null,
    };
    this.payments.set(id, payment);
    return { ...payment };
  }

  /** Возвраты в копейках по идентификатору платежа ЮKassa. */
  readonly refunds = new Map<string, number>();
  refundQueries = 0;

  async refundedAmount(providerPaymentId: string) {
    this.refundQueries += 1;
    return { amountMinor: this.refunds.get(providerPaymentId) ?? 0, currency: 'RUB' };
  }

  async getPayment(providerPaymentId: string): Promise<ProviderPayment> {
    this.gets += 1;
    if (this.failGet) throw new Error('ЮKassa недоступна');
    const payment = this.payments.get(providerPaymentId);
    if (!payment) throw new Error('нет такого платежа');
    return { ...payment };
  }

  /** Стример оплатил на странице ЮKassa. */
  pay(providerPaymentId: string, overrides: Partial<ProviderPayment> = {}): void {
    const payment = this.payments.get(providerPaymentId)!;
    Object.assign(payment, {
      status: 'succeeded',
      paymentMethod: { id: 'pm-secret-4444', saved: true, title: 'Карта *4444' },
      ...overrides,
    });
  }

  cancel(providerPaymentId: string, reason: string): void {
    Object.assign(this.payments.get(providerPaymentId)!, {
      status: 'canceled',
      cancellationReason: reason,
    });
  }

  reset(): void {
    this.payments.clear();
    this.refunds.clear();
    this.refundQueries = 0;
    this.created.length = 0;
    this.charged.length = 0;
    this.gets = 0;
    this.failGet = false;
    this.failCreate = false;
    this.rejectCreate = false;
    this.chargeOutcome = { status: 'succeeded' };
  }
}

/** Почта в памяти: что и кому ушло. */
class FakeMailer implements Mailer {
  readonly sent: MailMessage[] = [];
  configured = true;
  fail = false;

  async send(message: MailMessage): Promise<void> {
    if (this.fail) throw new Error('SMTP недоступен');
    this.sent.push(message);
  }

  reset(): void {
    this.sent.length = 0;
    this.configured = true;
    this.fail = false;
  }
}

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
    return {
      token: response.body.accessToken as string,
      userId: response.body.user.id as string,
      email: payload.email,
    };
  }

  async function checkout(token: string, period: 'month' | 'year' = 'month') {
    const response = await request(server())
      .post('/api/billing/checkout')
      .set(auth(token))
      .send({ period, acceptOffer: true })
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
  async function subscribed(token: string): Promise<string> {
    const { payment } = await checkout(token);
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
      amountMinor: PLAN_PRICES.year.amountMinor,
      currency: 'RUB',
    });
    expect(gateway.created[0]).toMatchObject({
      paymentId: payment.id,
      customerEmail: owner.email,
      amountMinor: PLAN_PRICES.year.amountMinor,
    });
    expect(gateway.created[0]!.returnUrl).toContain(`/billing?payment=${payment.id}`);

    const consent = await harness.prisma.consent.findFirstOrThrow({
      where: { userId: owner.userId, document: 'SUBSCRIPTION_OFFER' },
    });
    expect(consent.revokedAt).toBeNull();
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
      .send({ period: 'month', acceptOffer: true })
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
      .send({ period: 'month', acceptOffer: true })
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
      .send({ period: 'year', acceptOffer: true })
      .expect(409);
    await request(server())
      .get(`/api/billing/payments/${paymentId}`)
      .set(auth(stranger.token))
      .expect(404);
  });

  /* ---------------------------------------------------------------- */
  /* Комнаты                                                            */
  /* ---------------------------------------------------------------- */

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

    const view = await billing.extend(userId, 10);

    expect(new Date(view.currentPeriodEnd!).getTime()).toBe(end.getTime() + 10 * DAY_MS);
    const row = await harness.prisma.subscription.findUniqueOrThrow({ where: { userId } });
    expect(row.renewalNoticeFor).toBeNull();
    expect(await harness.prisma.payment.count({ where: { userId } })).toBe(1);

    // Прежнее письмо называло другую дату — без нового списания нет.
    await billing.renewDue(new Date(end.getTime() + 9.5 * DAY_MS));
    expect(gateway.charged).toHaveLength(0);
  });

  it('бесплатные дни без подписки открывают комнаты без автопродления', async () => {
    const owner = await streamer();
    const now = new Date();

    const view = await billing.extend(owner.userId, 7, {}, now);

    expect(view).toMatchObject({ status: 'active', autoRenew: false, roomsAccess: true });
    expect(new Date(view.currentPeriodEnd!).getTime()).toBe(now.getTime() + 7 * DAY_MS);
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
    expect(mailer.sent[0]!.text).toContain('490');
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
    mailer.configured = false;
    const owner = await streamer();
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
    expect(view.body.renewalAmount).toEqual(PLAN_PRICES.year);

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
      amountMinor: PLAN_PRICES.month.amountMinor,
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
