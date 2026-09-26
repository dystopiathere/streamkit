import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MAILER, type Mailer, type MailMessage } from '../src/common/mail/mailer';
import { REFRESH_COOKIE_NAME } from '../src/modules/auth/refresh-cookie';
import {
  createHarness,
  extractCookie,
  registrationPayload,
  takeVerificationLetter,
  type TestHarness,
} from './harness';

/** Почта в памяти: что и кому ушло. */
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

/** Письмо уходит без ожидания ответа — даём ему дойти до почты в памяти. */
async function nextLetter(mailer: FakeMailer): Promise<MailMessage> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const letter = mailer.sent.at(-1);
    if (letter) return letter;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('Письмо не отправлено');
}

function tokenFrom(letter: MailMessage): string {
  const match = /#token=([A-Za-z0-9_-]{43})/.exec(letter.text);
  if (!match) throw new Error('В письме нет ссылки');
  return match[1]!;
}

describe('Пароль: смена и восстановление (feature)', () => {
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

  async function register() {
    const payload = registrationPayload();
    const response = await request(server()).post('/api/auth/register').send(payload).expect(201);
    const cookies = response.headers['set-cookie'] as unknown as string[];
    if (mailer.configured) await takeVerificationLetter(mailer.sent, payload.email);
    return {
      payload,
      accessToken: response.body.accessToken as string,
      refresh: extractCookie(cookies, REFRESH_COOKIE_NAME)!,
    };
  }

  describe('смена пароля', () => {
    it('гасит прежние сессии и оставляет это устройство в аккаунте', async () => {
      const user = await register();

      const response = await request(server())
        .post('/api/auth/password')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ currentPassword: user.payload.password, newPassword: 'совсем-новый-пароль-42' })
        .expect(200);

      expect(response.body.accessToken).toBeTruthy();
      const fresh = extractCookie(
        response.headers['set-cookie'] as unknown as string[],
        REFRESH_COOKIE_NAME,
      );
      expect(fresh).toBeTruthy();

      // Старая сессия мертва, новая работает.
      await request(server())
        .post('/api/auth/refresh')
        .set('Cookie', `${REFRESH_COOKIE_NAME}=${user.refresh}`)
        .expect(401);
      await request(server())
        .post('/api/auth/refresh')
        .set('Cookie', `${REFRESH_COOKIE_NAME}=${fresh}`)
        .expect(200);

      await request(server())
        .post('/api/auth/login')
        .send({ email: user.payload.email, password: 'совсем-новый-пароль-42' })
        .expect(200);
    });

    it('на неверный текущий пароль отвечает 400, а не 401', async () => {
      // 401 клиент принял бы за протухший токен и пошёл бы его обновлять.
      const user = await register();
      const response = await request(server())
        .post('/api/auth/password')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ currentPassword: 'не-тот-пароль', newPassword: 'совсем-новый-пароль-42' })
        .expect(400);
      expect(response.body.message).toBe('Текущий пароль указан неверно');
    });
  });

  describe('восстановление', () => {
    it('шлёт ссылку, меняет пароль по ней и гасит все сессии', async () => {
      const user = await register();

      await request(server())
        .post('/api/auth/password/forgot')
        .send({ email: user.payload.email.toUpperCase(), language: 'ru' })
        .expect(204);

      const letter = await nextLetter(mailer);
      expect(letter.to).toBe(user.payload.email);
      expect(letter.text).toContain('/reset-password#token=');
      const token = tokenFrom(letter);

      // В базе — только хэш: сам токен там не встречается.
      const stored = await harness.prisma.passwordResetToken.findFirstOrThrow();
      expect(stored.tokenHash).not.toContain(token);

      await request(server())
        .post('/api/auth/password/reset')
        .send({ token, newPassword: 'пароль-после-сброса-7' })
        .expect(204);

      await request(server())
        .post('/api/auth/refresh')
        .set('Cookie', `${REFRESH_COOKIE_NAME}=${user.refresh}`)
        .expect(401);
      await request(server())
        .post('/api/auth/login')
        .send({ email: user.payload.email, password: 'пароль-после-сброса-7' })
        .expect(200);

      // Ссылка одноразовая.
      const again = await request(server())
        .post('/api/auth/password/reset')
        .send({ token, newPassword: 'ещё-один-пароль-99' })
        .expect(400);
      expect(again.body.message).toBe('Ссылка недействительна или устарела');
    });

    it('отвечает одинаково на незнакомый адрес и ничего не шлёт', async () => {
      await request(server())
        .post('/api/auth/password/forgot')
        .send({ email: 'nobody@example.com' })
        .expect(204);
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(mailer.sent).toHaveLength(0);
    });

    it('не принимает истёкшую ссылку', async () => {
      const user = await register();
      await request(server())
        .post('/api/auth/password/forgot')
        .send({ email: user.payload.email })
        .expect(204);
      const token = tokenFrom(await nextLetter(mailer));
      await harness.prisma.passwordResetToken.updateMany({
        data: { expiresAt: new Date(Date.now() - 1000) },
      });

      await request(server())
        .post('/api/auth/password/reset')
        .send({ token, newPassword: 'пароль-после-сброса-7' })
        .expect(400);
    });

    it('шлёт не больше одного письма в минуту на адрес', async () => {
      const user = await register();
      for (let i = 0; i < 3; i += 1) {
        await request(server())
          .post('/api/auth/password/forgot')
          .send({ email: user.payload.email, language: 'en' })
          .expect(204);
      }
      const letter = await nextLetter(mailer);
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(mailer.sent).toHaveLength(1);
      expect(letter.subject).toContain('reset your password');
    });

    it('говорит, что почта не настроена, не раскрывая аккаунтов', async () => {
      mailer.configured = false;
      const response = await request(server())
        .post('/api/auth/password/forgot')
        .send({ email: 'nobody@example.com' })
        .expect(503);
      expect(response.body.message).toBe('Почта не настроена');
    });
  });
});
