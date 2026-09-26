import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MAILER, type Mailer, type MailMessage } from '../src/common/mail/mailer';
import {
  createHarness,
  linkTokenFrom,
  registrationPayload,
  takeVerificationLetter,
  type TestHarness,
} from './harness';

class FakeMailer implements Mailer {
  readonly sent: MailMessage[] = [];
  configured = true;

  async send(message: MailMessage): Promise<void> {
    this.sent.push(message);
  }

  reset(): void {
    this.sent.length = 0;
    this.configured = true;
  }
}

describe('Подтверждение почты (feature)', () => {
  let harness: TestHarness;
  const mailer = new FakeMailer();

  beforeAll(async () => {
    harness = await createHarness([], (builder) =>
      builder.overrideProvider(MAILER).useValue(mailer),
    );
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await harness.reset();
    mailer.reset();
  });

  const server = () => harness.app.getHttpServer();
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  async function register(overrides: Record<string, unknown> = {}) {
    const payload = registrationPayload(overrides);
    const response = await request(server()).post('/api/auth/register').send(payload).expect(201);
    return {
      email: payload.email,
      userId: response.body.user.id as string,
      accessToken: response.body.accessToken as string,
      verified: response.body.user.emailVerified as boolean,
    };
  }

  async function me(token: string): Promise<{ emailVerified: boolean }> {
    return (await request(server()).get('/api/auth/me').set(auth(token)).expect(200)).body;
  }

  it('регистрация шлёт письмо, ссылка подтверждает почту без входа', async () => {
    const user = await register();
    expect(user.verified).toBe(false);

    const letter = await takeVerificationLetter(mailer.sent, user.email);
    expect(letter.html).toContain('/verify-email#token=');
    await request(server())
      .post('/api/auth/email/verify')
      .send({ token: linkTokenFrom(letter) })
      .expect(204);

    expect((await me(user.accessToken)).emailVerified).toBe(true);
    const logs = await harness.prisma.mailLog.findMany();
    expect(logs.map((log) => [log.kind, log.status])).toEqual([['EMAIL_VERIFICATION', 'SENT']]);
  });

  it('повторное открытие той же ссылки — не ошибка', async () => {
    const user = await register();
    const token = linkTokenFrom(await takeVerificationLetter(mailer.sent, user.email));
    await request(server()).post('/api/auth/email/verify').send({ token }).expect(204);
    await request(server()).post('/api/auth/email/verify').send({ token }).expect(204);
  });

  it('истёкшая, чужая и погашенная новым письмом ссылки не подтверждают', async () => {
    const user = await register({ language: 'en' });
    const first = linkTokenFrom(await takeVerificationLetter(mailer.sent, user.email));

    await request(server())
      .post('/api/auth/email/verify')
      .send({ token: 'A'.repeat(43) })
      .expect(400);

    await request(server()).post('/api/auth/email/resend').set(auth(user.accessToken)).expect(204);
    const letter = await takeVerificationLetter(mailer.sent, user.email);
    expect(letter.html).toContain('/verify-email?lang=en#token=');
    const second = linkTokenFrom(letter);
    await request(server()).post('/api/auth/email/verify').send({ token: first }).expect(400);

    await harness.prisma.emailVerificationToken.updateMany({
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    const expired = await request(server())
      .post('/api/auth/email/verify')
      .send({ token: second })
      .expect(400);
    expect(expired.body.message).toBe('Ссылка недействительна или устарела');
    expect((await me(user.accessToken)).emailVerified).toBe(false);
  });

  it('новое письмо — не чаще раза в минуту, подтверждённому — не нужно', async () => {
    const user = await register();
    await takeVerificationLetter(mailer.sent, user.email);

    await request(server()).post('/api/auth/email/resend').set(auth(user.accessToken)).expect(204);
    const token = linkTokenFrom(await takeVerificationLetter(mailer.sent, user.email));
    await request(server()).post('/api/auth/email/resend').set(auth(user.accessToken)).expect(429);

    await request(server()).post('/api/auth/email/verify').send({ token }).expect(204);
    await harness.redis.flushdb();
    await request(server()).post('/api/auth/email/resend').set(auth(user.accessToken)).expect(204);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(mailer.sent).toHaveLength(0);
  });

  it('пароль, заданный по ссылке из письма, подтверждает почту', async () => {
    const user = await register();
    await takeVerificationLetter(mailer.sent, user.email);

    await request(server())
      .post('/api/auth/password/forgot')
      .send({ email: user.email })
      .expect(204);
    for (let attempt = 0; attempt < 50 && mailer.sent.length === 0; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    const reset = mailer.sent.shift()!;
    expect(reset.subject).toBe('StreamKit: восстановление пароля');

    await request(server())
      .post('/api/auth/password/reset')
      .send({ token: linkTokenFrom(reset), newPassword: 'пароль-после-сброса-7' })
      .expect(204);

    const stored = await harness.prisma.user.findUniqueOrThrow({ where: { id: user.userId } });
    expect(stored.emailVerifiedAt).not.toBeNull();
  });

  it('без почты письмо не запросить — 503, а регистрация проходит', async () => {
    mailer.configured = false;
    const user = await register();
    await request(server()).post('/api/auth/email/resend').set(auth(user.accessToken)).expect(503);
    expect(mailer.sent).toHaveLength(0);
  });
});
