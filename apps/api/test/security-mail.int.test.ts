import { generateSync } from 'otplib';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MAILER, type Mailer, type MailMessage } from '../src/common/mail/mailer';
import { DEVICE_COOKIE_NAME } from '../src/modules/auth/device-cookie';
import { REFRESH_COOKIE_NAME } from '../src/modules/auth/refresh-cookie';
import {
  createHarness,
  extractCookie,
  markEmailVerified,
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

const CHROME_WINDOWS =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

/** Письма о безопасности уходят без ожидания ответа — ждём, пока дойдут. */
async function lettersWith(mailer: FakeMailer, subject: string, count = 1): Promise<MailMessage[]> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const found = mailer.sent.filter((letter) => letter.subject.includes(subject));
    if (found.length >= count) return found;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Нет письма «${subject}»`);
}

/** Дать неотправленным письмам шанс дойти — для проверки, что их нет. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 80));

describe('Письма о безопасности (feature)', () => {
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

  async function register(overrides: Record<string, unknown> = {}) {
    const payload = registrationPayload(overrides);
    const response = await request(server())
      .post('/api/auth/register')
      .set('User-Agent', CHROME_WINDOWS)
      .send(payload)
      .expect(201);
    const cookies = response.headers['set-cookie'] as unknown as string[];
    if (mailer.configured) await takeVerificationLetter(mailer.sent, payload.email);
    await markEmailVerified(harness, response.body.user.id as string);
    return {
      payload,
      accessToken: response.body.accessToken as string,
      refresh: extractCookie(cookies, REFRESH_COOKIE_NAME)!,
      device: extractCookie(cookies, DEVICE_COOKIE_NAME)!,
    };
  }

  describe('вход с нового устройства', () => {
    it('браузер регистрации известен: вход из него письма не шлёт', async () => {
      const user = await register();
      expect(user.device).toBeTruthy();

      await request(server())
        .post('/api/auth/login')
        .set('Cookie', `${DEVICE_COOKIE_NAME}=${user.device}`)
        .send({ email: user.payload.email, password: user.payload.password })
        .expect(200);

      await settle();
      expect(mailer.sent).toHaveLength(0);
    });

    it('вход из другого браузера — одно письмо с устройством и временем, повторный — без письма', async () => {
      const user = await register();

      const first = await request(server())
        .post('/api/auth/login')
        .set('User-Agent', CHROME_WINDOWS)
        .send({ email: user.payload.email, password: user.payload.password })
        .expect(200);
      const device = extractCookie(
        first.headers['set-cookie'] as unknown as string[],
        DEVICE_COOKIE_NAME,
      );
      expect(device).toBeTruthy();
      expect(device).not.toBe(user.device);

      const [letter] = await lettersWith(mailer, 'вход с нового устройства');
      expect(letter!.to).toBe(user.payload.email);
      expect(letter!.text).toContain('Chrome, Windows');
      expect(letter!.text).toContain('по Москве');
      expect(letter!.html).toContain('/account/security');

      await request(server())
        .post('/api/auth/login')
        .set('Cookie', `${DEVICE_COOKIE_NAME}=${device}`)
        .send({ email: user.payload.email, password: user.payload.password })
        .expect(200);
      await settle();
      expect(mailer.sent).toHaveLength(1);

      // В базе — только хэш метки.
      const stored = await harness.prisma.knownDevice.findMany();
      expect(stored).toHaveLength(2);
      expect(stored.map((row) => row.deviceHash)).not.toContain(device);
    });

    it('неверный пароль не шлёт ничего', async () => {
      const user = await register();
      await request(server())
        .post('/api/auth/login')
        .send({ email: user.payload.email, password: 'не-тот-пароль-совсем' })
        .expect(401);
      await settle();
      expect(mailer.sent).toHaveLength(0);
    });

    it('обновление сессии запоминает браузер молча', async () => {
      const user = await register();
      await harness.prisma.knownDevice.deleteMany();

      const refreshed = await request(server())
        .post('/api/auth/refresh')
        .set(
          'Cookie',
          `${REFRESH_COOKIE_NAME}=${user.refresh}; ${DEVICE_COOKIE_NAME}=${user.device}`,
        )
        .expect(200);
      expect(
        extractCookie(refreshed.headers['set-cookie'] as unknown as string[], DEVICE_COOKIE_NAME),
      ).toBe(user.device);
      expect(await harness.prisma.knownDevice.count()).toBe(1);

      await request(server())
        .post('/api/auth/login')
        .set('Cookie', `${DEVICE_COOKIE_NAME}=${user.device}`)
        .send({ email: user.payload.email, password: user.payload.password })
        .expect(200);
      await settle();
      expect(mailer.sent).toHaveLength(0);
    });

    it('пишет на языке страницы, с которой вошли, и запоминает его', async () => {
      const user = await register();
      await request(server())
        .post('/api/auth/login')
        .send({ email: user.payload.email, password: user.payload.password, language: 'en' })
        .expect(200);

      const [letter] = await lettersWith(mailer, 'new sign-in');
      expect(letter!.html).toContain('lang="en"');
      expect(letter!.html).toContain('/account/security?lang=en');
      const stored = await harness.prisma.user.findUniqueOrThrow({
        where: { email: user.payload.email },
      });
      expect(stored.language).toBe('en');
    });
  });

  it('смена пароля в профиле — письмо «пароль изменён»', async () => {
    const user = await register();
    await request(server())
      .post('/api/auth/password')
      .set('Authorization', `Bearer ${user.accessToken}`)
      .set('User-Agent', CHROME_WINDOWS)
      .send({ currentPassword: user.payload.password, newPassword: 'совсем-новый-пароль-42' })
      .expect(200);

    const [letter] = await lettersWith(mailer, 'пароль изменён');
    expect(letter!.text).toContain('Остальные устройства вышли из аккаунта');
    expect(letter!.text).toContain('/forgot-password');
    expect(letter!.text).toContain('Chrome, Windows');
  });

  it('пароль по ссылке восстановления — тоже письмо, на языке аккаунта', async () => {
    const user = await register({ language: 'en' });
    await request(server())
      .post('/api/auth/password/forgot')
      .send({ email: user.payload.email, language: 'en' })
      .expect(204);
    const [reset] = await lettersWith(mailer, 'reset your password');
    const token = /#token=([A-Za-z0-9_-]{43})/.exec(reset!.text)![1]!;

    await request(server())
      .post('/api/auth/password/reset')
      .send({ token, newPassword: 'пароль-после-сброса-7' })
      .expect(204);

    const [letter] = await lettersWith(mailer, 'your password was changed');
    expect(letter!.text).toContain('Every device has been signed out');
  });

  it('выключение двухфакторного входа — письмо', async () => {
    const user = await register();
    const auth = { Authorization: `Bearer ${user.accessToken}` };
    const setup = await request(server()).post('/api/auth/totp/setup').set(auth).expect(201);
    const secret = setup.body.secret as string;
    await request(server())
      .post('/api/auth/totp/confirm')
      .set(auth)
      .send({ code: generateSync({ secret }) })
      .expect(204);
    await settle();
    expect(mailer.sent).toHaveLength(0);

    await request(server())
      .post('/api/auth/totp/disable')
      .set(auth)
      .send({
        password: user.payload.password,
        // Код подтверждения уже израсходован — следующий шаг.
        code: generateSync({ secret, epoch: Math.floor(Date.now() / 1000) + 30 }),
      })
      .expect(204);

    const [letter] = await lettersWith(mailer, 'двухфакторный вход выключен');
    expect(letter!.text).toContain('теперь для входа достаточно пароля');
  });

  it('неподтверждённой почте не пишет, а в журнал писем ложится причина', async () => {
    const user = await register();
    await harness.prisma.user.updateMany({ data: { emailVerifiedAt: null } });

    await request(server())
      .post('/api/auth/login')
      .send({ email: user.payload.email, password: user.payload.password })
      .expect(200);

    for (let attempt = 0; attempt < 50; attempt += 1) {
      if ((await harness.prisma.mailLog.count({ where: { kind: 'NEW_DEVICE' } })) > 0) break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(mailer.sent).toHaveLength(0);
    const logs = await harness.prisma.mailLog.findMany({ where: { kind: 'NEW_DEVICE' } });
    expect(logs.map((log) => log.status)).toEqual(['SKIPPED_UNVERIFIED']);
  });

  it('отправленное письмо попадает в журнал писем', async () => {
    const user = await register();
    await request(server())
      .post('/api/auth/login')
      .send({ email: user.payload.email, password: user.payload.password })
      .expect(200);
    await lettersWith(mailer, 'вход с нового устройства');

    const logs = await harness.prisma.mailLog.findMany({ where: { kind: 'NEW_DEVICE' } });
    expect(logs.map((log) => log.status)).toEqual(['SENT']);
  });

  it('без настроенной почты действия работают, писем нет', async () => {
    mailer.configured = false;
    const user = await register();
    await request(server())
      .post('/api/auth/login')
      .send({ email: user.payload.email, password: user.payload.password })
      .expect(200);
    await settle();
    expect(mailer.sent).toHaveLength(0);
  });
});
