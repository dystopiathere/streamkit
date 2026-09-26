// Оплата настроена — ключи до создания приложения: конфиг читает окружение при
// старте. setup.ts ключи ЮKassa вычищает, иначе прогон зависел бы от .env.
process.env.YOOKASSA_SHOP_ID = 'test-shop';
process.env.YOOKASSA_SECRET_KEY = 'test-secret-key';

import { REFERRAL_REWARD_DAYS } from '@streamkit/contracts';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MAILER } from '../src/common/mail/mailer';
import { PAYMENT_GATEWAY } from '../src/modules/billing/payment-gateway';
import { FakeGateway, FakeMailer } from './billing-fakes';
import {
  createHarness,
  markEmailVerified,
  registrationPayload,
  takeVerificationLetter,
  type TestHarness,
} from './harness';

const DAY_MS = 24 * 60 * 60 * 1000;

describe('Приглашения (feature)', () => {
  let harness: TestHarness;
  const gateway = new FakeGateway();
  const mailer = new FakeMailer();

  beforeAll(async () => {
    harness = await createHarness([], (builder) =>
      builder
        .overrideProvider(PAYMENT_GATEWAY)
        .useValue(gateway)
        .overrideProvider(MAILER)
        .useValue(mailer),
    );
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await harness.reset();
    gateway.reset();
    mailer.reset();
  });

  const server = () => harness.app.getHttpServer();
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  async function streamer(
    overrides: Record<string, unknown> = {},
  ): Promise<{ token: string; userId: string }> {
    const payload = registrationPayload(overrides);
    const response = await request(server()).post('/api/auth/register').send(payload).expect(201);
    const userId = response.body.user.id as string;
    await takeVerificationLetter(mailer.sent, payload.email);
    await markEmailVerified(harness, userId);
    return { token: response.body.accessToken as string, userId };
  }

  async function codeOf(token: string): Promise<string> {
    const response = await request(server()).get('/api/referrals').set(auth(token)).expect(200);
    return response.body.code as string;
  }

  /** Оформил и оплатил месяц; возвращает идентификатор платежа у ЮKassa. */
  async function pay(token: string, plan: 'multistream' | 'pro'): Promise<string> {
    const response = await request(server())
      .post('/api/billing/checkout')
      .set(auth(token))
      .send({ plan, period: 'month', acceptOffer: true })
      .expect(201);
    const payment = await harness.prisma.payment.findUniqueOrThrow({
      where: { id: response.body.paymentId as string },
    });
    gateway.pay(payment.providerPaymentId!);
    await notify(payment.providerPaymentId!).expect(200);
    return payment.providerPaymentId!;
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

  async function balance(userId: string): Promise<number> {
    const user = await harness.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    return user.referralDaysBalance;
  }

  /** Подписка кончилась давно: следующую можно оформить заново. */
  async function expire(userId: string): Promise<void> {
    await harness.prisma.subscription.update({
      where: { userId },
      data: { currentPeriodEnd: new Date(Date.now() - 30 * DAY_MS), autoRenew: false },
    });
  }

  it('промокод выдаётся при первом открытии раздела и дальше не меняется', async () => {
    const owner = await streamer();
    const code = await codeOf(owner.token);
    expect(code).toMatch(/^[A-HJ-NP-Z2-9]{8}$/);
    expect(await codeOf(owner.token)).toBe(code);
  });

  it('регистрация по промокоду запоминает пригласившего; регистр и пробелы не важны', async () => {
    const referrer = await streamer();
    const code = await codeOf(referrer.token);
    const invited = await streamer({ referralCode: ` ${code.toLowerCase()} ` });

    const row = await harness.prisma.user.findUniqueOrThrow({ where: { id: invited.userId } });
    expect(row.referredById).toBe(referrer.userId);
    const overview = await request(server()).get('/api/referrals').set(auth(referrer.token));
    expect(overview.body).toMatchObject({ invited: 1, paid: 0, balanceDays: 0 });
  });

  it('несуществующий промокод — ошибка формы, а аккаунт не создаётся', async () => {
    const payload = registrationPayload({ referralCode: 'NOSUCH22' });
    const response = await request(server()).post('/api/auth/register').send(payload).expect(400);
    expect(response.body.message).toBe('Промокод не найден');
    expect(await harness.prisma.user.count({ where: { email: payload.email } })).toBe(0);
  });

  it('пустой промокод — регистрация без приглашения', async () => {
    const invited = await streamer({ referralCode: '' });
    const row = await harness.prisma.user.findUniqueOrThrow({ where: { id: invited.userId } });
    expect(row.referredById).toBeNull();
  });

  it('первая оплата «Мультистрима» — три дня, повтор уведомления и следующие оплаты — ничего', async () => {
    const referrer = await streamer();
    const invited = await streamer({ referralCode: await codeOf(referrer.token) });

    const providerId = await pay(invited.token, 'multistream');
    expect(await balance(referrer.userId)).toBe(REFERRAL_REWARD_DAYS.multistream);

    await notify(providerId).expect(200);
    expect(await balance(referrer.userId)).toBe(REFERRAL_REWARD_DAYS.multistream);

    // Вторая оплата, и уже «Про», — не первая: начисления нет.
    await expire(invited.userId);
    await pay(invited.token, 'pro');
    expect(await balance(referrer.userId)).toBe(REFERRAL_REWARD_DAYS.multistream);
    expect(await harness.prisma.referralReward.count()).toBe(1);

    const audit = await harness.prisma.auditLog.count({
      where: { userId: referrer.userId, action: 'billing.referral.credited' },
    });
    expect(audit).toBe(1);
  });

  it('первая оплата «Про» — четырнадцать дней; без промокода никому ничего', async () => {
    const referrer = await streamer();
    const invited = await streamer({ referralCode: await codeOf(referrer.token) });
    const stranger = await streamer();

    await pay(invited.token, 'pro');
    await pay(stranger.token, 'pro');

    expect(await balance(referrer.userId)).toBe(REFERRAL_REWARD_DAYS.pro);
    const overview = await request(server()).get('/api/referrals').set(auth(referrer.token));
    expect(overview.body).toMatchObject({ invited: 1, paid: 1, balanceDays: 14 });
    expect(overview.body.rewards).toEqual([
      expect.objectContaining({ plan: 'pro', days: 14, revoked: false }),
    ]);
    // Кто именно заплатил, пригласивший не узнаёт.
    expect(JSON.stringify(overview.body)).not.toContain(invited.userId);
  });

  it('возврат первой оплаты отзывает начисление — и снимает с баланса не больше остатка', async () => {
    const referrer = await streamer();
    const invited = await streamer({ referralCode: await codeOf(referrer.token) });
    const providerId = await pay(invited.token, 'pro');

    // Десять дней из четырнадцати уже включены.
    await request(server())
      .post('/api/referrals/activate')
      .set(auth(referrer.token))
      .send({ days: 10 })
      .expect(200);

    gateway.refunds.set(providerId, 49_900);
    await request(server())
      .post('/api/billing/yookassa/webhook')
      .send({
        type: 'notification',
        event: 'refund.succeeded',
        object: { id: 'refund-1', payment_id: providerId },
      })
      .expect(200);

    expect(await balance(referrer.userId)).toBe(0);
    const reward = await harness.prisma.referralReward.findFirstOrThrow();
    expect(reward.revokedAt).not.toBeNull();
  });

  it('включение дней открывает «Про» бесплатному тарифу и списывает баланс', async () => {
    const owner = await streamer();
    await harness.prisma.user.update({
      where: { id: owner.userId },
      data: { referralDaysBalance: 5 },
    });

    const before = Date.now();
    const response = await request(server())
      .post('/api/referrals/activate')
      .set(auth(owner.token))
      .send({ days: 3 })
      .expect(200);
    expect(response.body.balanceDays).toBe(2);
    const until = new Date(response.body.proUntil as string).getTime();
    expect(until).toBeGreaterThanOrEqual(before + 3 * DAY_MS);
    expect(until).toBeLessThan(before + 3 * DAY_MS + 60_000);

    const subscription = await request(server())
      .get('/api/billing/subscription')
      .set(auth(owner.token))
      .expect(200);
    expect(subscription.body).toMatchObject({
      status: 'none',
      plan: 'free',
      roomsAccess: true,
      features: { rooms: true, advancedStyling: true },
    });
    expect(subscription.body.bonusProUntil).toBe(response.body.proUntil);

    // Следующие дни — подряд после уже включённых.
    const more = await request(server())
      .post('/api/referrals/activate')
      .set(auth(owner.token))
      .send({ days: 2 })
      .expect(200);
    expect(new Date(more.body.proUntil as string).getTime()).toBe(until + 2 * DAY_MS);
    expect(more.body.balanceDays).toBe(0);
  });

  it('больше накопленного не включить', async () => {
    const owner = await streamer();
    await harness.prisma.user.update({
      where: { id: owner.userId },
      data: { referralDaysBalance: 2 },
    });
    const response = await request(server())
      .post('/api/referrals/activate')
      .set(auth(owner.token))
      .send({ days: 3 })
      .expect(409);
    expect(response.body.message).toBe('Столько дней ещё не накоплено');
    expect(await balance(owner.userId)).toBe(2);
    await request(server())
      .post('/api/referrals/activate')
      .set(auth(owner.token))
      .send({ days: 0 })
      .expect(400);
  });

  it('оплаченный «Мультистрим» на время «Про» встаёт на паузу: конец периода сдвигается', async () => {
    const owner = await streamer();
    await pay(owner.token, 'multistream');
    const paid = await harness.prisma.subscription.findUniqueOrThrow({
      where: { userId: owner.userId },
    });
    const payment = await harness.prisma.payment.findFirstOrThrow({
      where: { userId: owner.userId, status: 'SUCCEEDED' },
    });
    await harness.prisma.subscription.update({
      where: { id: paid.id },
      data: { renewalNoticeFor: paid.currentPeriodEnd, renewalNoticeSentAt: new Date() },
    });
    await harness.prisma.user.update({
      where: { id: owner.userId },
      data: { referralDaysBalance: 7 },
    });

    await request(server())
      .post('/api/referrals/activate')
      .set(auth(owner.token))
      .send({ days: 7 })
      .expect(200);

    const shifted = await harness.prisma.subscription.findUniqueOrThrow({
      where: { id: paid.id },
    });
    expect(shifted.currentPeriodEnd!.getTime()).toBe(paid.currentPeriodEnd!.getTime() + 7 * DAY_MS);
    // Письмо о списании называло прежнюю дату — нужно новое.
    expect(shifted.renewalNoticeFor).toBeNull();
    const shiftedPayment = await harness.prisma.payment.findUniqueOrThrow({
      where: { id: payment.id },
    });
    expect(shiftedPayment.periodEnd!.getTime()).toBe(payment.periodEnd!.getTime() + 7 * DAY_MS);

    const subscription = await request(server())
      .get('/api/billing/subscription')
      .set(auth(owner.token))
      .expect(200);
    expect(subscription.body).toMatchObject({
      status: 'active',
      plan: 'multistream',
      roomsAccess: true,
    });
  });

  it('оплата во время дней «Про» начинает оплаченный период после них', async () => {
    const owner = await streamer();
    await harness.prisma.user.update({
      where: { id: owner.userId },
      data: { referralDaysBalance: 10 },
    });
    const activated = await request(server())
      .post('/api/referrals/activate')
      .set(auth(owner.token))
      .send({ days: 10 })
      .expect(200);
    const until = new Date(activated.body.proUntil as string);

    await pay(owner.token, 'multistream');
    const payment = await harness.prisma.payment.findFirstOrThrow({
      where: { userId: owner.userId, status: 'SUCCEEDED' },
    });
    expect(payment.periodStart!.getTime()).toBe(until.getTime());
  });

  it('обезличивание гасит промокод: по нему больше никто не зарегистрируется', async () => {
    const referrer = await streamer();
    const code = await codeOf(referrer.token);
    await harness.prisma.user.update({
      where: { id: referrer.userId },
      data: { status: 'ANONYMIZED', anonymizedAt: new Date() },
    });
    await request(server())
      .post('/api/auth/register')
      .send(registrationPayload({ referralCode: code }))
      .expect(400);
  });
});
