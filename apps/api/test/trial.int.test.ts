// Оплата настроена — ключи до создания приложения: конфиг читает окружение при
// старте. setup.ts ключи ЮKassa вычищает, иначе прогон зависел бы от .env.
process.env.YOOKASSA_SHOP_ID = 'test-shop';
process.env.YOOKASSA_SECRET_KEY = 'test-secret-key';

import { REFERRAL_REWARD_DAYS, TRIAL_DAYS } from '@streamkit/contracts';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MAILER } from '../src/common/mail/mailer';
import { BillingService } from '../src/modules/billing/billing.service';
import { PAYMENT_GATEWAY } from '../src/modules/billing/payment-gateway';
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

describe('Пробный период и подпись бесплатного тарифа (feature)', () => {
  let harness: TestHarness;
  let billing: BillingService;
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
    billing = harness.app.get(BillingService);
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
    verified = true,
  ): Promise<{ token: string; userId: string; email: string }> {
    const payload = registrationPayload(overrides);
    const response = await request(server()).post('/api/auth/register').send(payload).expect(201);
    const userId = response.body.user.id as string;
    await takeVerificationLetter(mailer.sent, payload.email);
    if (verified) await markEmailVerified(harness, userId);
    return { token: response.body.accessToken as string, userId, email: payload.email };
  }

  async function pay(token: string, plan: 'multistream' | 'pro'): Promise<void> {
    const response = await request(server())
      .post('/api/billing/checkout')
      .set(auth(token))
      .send({ plan, period: 'month', acceptOffer: true })
      .expect(201);
    const payment = await harness.prisma.payment.findUniqueOrThrow({
      where: { id: response.body.paymentId as string },
    });
    gateway.pay(payment.providerPaymentId!);
    await request(server())
      .post('/api/billing/yookassa/webhook')
      .send({
        type: 'notification',
        event: 'payment.succeeded',
        object: { id: payment.providerPaymentId },
      })
      .expect(200);
  }

  async function overlayFor(token: string, userId: string) {
    const widget = await request(server())
      .post('/api/widgets')
      .set(auth(token))
      .send({ name: 'Цель', type: 'goal', config: {} })
      .expect(201);
    const widgets = harness.app.get(WidgetsService);
    const link = await widgets.createOverlayToken(userId, widget.body.id as string, null);
    const raw = new URL(link.url).searchParams.get('token')!;
    return () => widgets.resolveOverlayToken(raw);
  }

  it('пробный период открывает «Про» на 14 дней и включается один раз', async () => {
    const owner = await streamer();
    const before = await request(server())
      .get('/api/billing/subscription')
      .set(auth(owner.token))
      .expect(200);
    expect(before.body).toMatchObject({ trialAvailable: true, trialEndsAt: null, plan: 'free' });
    expect(before.body.features).toMatchObject({ rooms: false, branding: true });

    const started = Date.now();
    const trial = await request(server())
      .post('/api/billing/trial')
      .set(auth(owner.token))
      .expect(200);
    expect(trial.body).toMatchObject({
      trialAvailable: false,
      plan: 'free',
      status: 'none',
      features: { rooms: true, advancedStyling: true, branding: false },
    });
    const ends = new Date(trial.body.trialEndsAt as string).getTime();
    expect(ends).toBeGreaterThanOrEqual(started + TRIAL_DAYS * DAY_MS);
    expect(ends).toBeLessThan(started + TRIAL_DAYS * DAY_MS + 60_000);
    expect(trial.body.bonusProUntil).toBe(trial.body.trialEndsAt);

    const again = await request(server())
      .post('/api/billing/trial')
      .set(auth(owner.token))
      .expect(409);
    expect(again.body.message).toBe('Пробный период уже был');
  });

  it('без подтверждённой почты пробный период не включить', async () => {
    const owner = await streamer({}, false);
    const response = await request(server())
      .post('/api/billing/trial')
      .set(auth(owner.token))
      .expect(403);
    expect(response.body.message).toBe('Подтвердите почту, чтобы включить пробный период');
  });

  it('тому, кто уже платил, пробный период не положен', async () => {
    const owner = await streamer();
    await pay(owner.token, 'multistream');
    const view = await request(server())
      .get('/api/billing/subscription')
      .set(auth(owner.token))
      .expect(200);
    expect(view.body.trialAvailable).toBe(false);
    await request(server()).post('/api/billing/trial').set(auth(owner.token)).expect(409);
  });

  it('оплата в пробный период начинается после него, а пригласившему — дни за оплату', async () => {
    const referrer = await streamer();
    const code = (await request(server()).get('/api/referrals').set(auth(referrer.token))).body
      .code as string;
    const owner = await streamer({ referralCode: code });

    const trial = await request(server())
      .post('/api/billing/trial')
      .set(auth(owner.token))
      .expect(200);
    // Пробный период — не оплата: пригласившему за него ничего.
    const untouched = await harness.prisma.user.findUniqueOrThrow({
      where: { id: referrer.userId },
    });
    expect(untouched.referralDaysBalance).toBe(0);

    await pay(owner.token, 'pro');
    const payment = await harness.prisma.payment.findFirstOrThrow({
      where: { userId: owner.userId, status: 'SUCCEEDED' },
    });
    expect(payment.periodStart!.toISOString()).toBe(trial.body.trialEndsAt);

    const credited = await harness.prisma.user.findUniqueOrThrow({
      where: { id: referrer.userId },
    });
    expect(credited.referralDaysBalance).toBe(REFERRAL_REWARD_DAYS.pro);
  });

  it('за два дня до конца бесплатного «Про» — одно письмо, если дальше нет оплаты', async () => {
    const owner = await streamer();
    await request(server()).post('/api/billing/trial').set(auth(owner.token)).expect(200);
    const soon = new Date(Date.now() + DAY_MS);
    await harness.prisma.user.update({
      where: { id: owner.userId },
      data: { bonusProUntil: soon, trialEndsAt: soon },
    });

    expect(await billing.sendBonusEndNotices()).toBe(1);
    const letter = mailer.sent.find((mail) => mail.to === owner.email);
    expect(letter?.subject).toContain('пробный период заканчивается');
    expect(await billing.sendBonusEndNotices()).toBe(0);

    const log = await harness.prisma.mailLog.findFirstOrThrow({
      where: { userId: owner.userId, kind: 'FREE_PRO_ENDING' },
    });
    expect(log.status).toBe('SENT');
  });

  it('письма нет, если после бесплатных дней идёт оплаченный период', async () => {
    const owner = await streamer();
    await pay(owner.token, 'multistream');
    await harness.prisma.user.update({
      where: { id: owner.userId },
      data: { bonusProUntil: new Date(Date.now() + DAY_MS) },
    });
    expect(await billing.sendBonusEndNotices()).toBe(0);
  });

  it('подпись в кадре — только на бесплатном тарифе', async () => {
    const owner = await streamer();
    const resolve = await overlayFor(owner.token, owner.userId);
    expect((await resolve())?.branding).toBe(true);

    await request(server()).post('/api/billing/trial').set(auth(owner.token)).expect(200);
    expect((await resolve())?.branding).toBe(false);

    // Пробный кончился — подпись вернулась.
    await harness.prisma.user.update({
      where: { id: owner.userId },
      data: { bonusProUntil: new Date(Date.now() - 1000) },
    });
    expect((await resolve())?.branding).toBe(true);

    await pay(owner.token, 'multistream');
    expect((await resolve())?.branding).toBe(false);
  });

  it('конфиги для рассылки после смены тарифа несут подпись по тарифу', async () => {
    const owner = await streamer();
    await overlayFor(owner.token, owner.userId);
    const widgets = harness.app.get(WidgetsService);
    expect((await widgets.overlayConfigs(owner.userId)).map((config) => config.branding)).toEqual([
      true,
    ]);
    await request(server()).post('/api/billing/trial').set(auth(owner.token)).expect(200);
    expect((await widgets.overlayConfigs(owner.userId)).map((config) => config.branding)).toEqual([
      false,
    ]);
  });
});
