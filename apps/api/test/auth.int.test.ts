import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { REFRESH_COOKIE_NAME } from '../src/modules/auth/refresh-cookie';
import { createHarness, extractCookie, registrationPayload, type TestHarness } from './harness';

/** Строка Set-Cookie с refresh-токеном: рядом приходит и метка браузера `sk_device`. */
function refreshCookieOf(response: { headers: Record<string, unknown> }): string {
  const cookies = response.headers['set-cookie'] as string[];
  return cookies.find((cookie) => cookie.startsWith(`${REFRESH_COOKIE_NAME}=`))!;
}

describe('Аутентификация (feature)', () => {
  let harness: TestHarness;

  beforeAll(async () => {
    harness = await createHarness();
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await harness.reset();
  });

  const server = () => harness.app.getHttpServer();

  it('регистрирует пользователя и ставит refresh-cookie', async () => {
    const response = await request(server())
      .post('/api/auth/register')
      .send(registrationPayload())
      .expect(201);

    expect(response.body.accessToken).toBeTruthy();
    expect(response.body.user.email).toContain('@example.com');

    const setCookie = response.headers['set-cookie'] as unknown as string[];
    const cookie = setCookie.find((item) => item.startsWith(REFRESH_COOKIE_NAME));

    expect(cookie).toBeDefined();
    // httpOnly обязателен: без него токен читается из JS и утекает при XSS.
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
    // Путь узкий — cookie не уходит на остальные эндпоинты.
    expect(cookie).toContain('Path=/api/auth');
  });

  it('не возвращает refresh-токен в теле ответа', async () => {
    const response = await request(server())
      .post('/api/auth/register')
      .send(registrationPayload())
      .expect(201);

    expect(JSON.stringify(response.body)).not.toContain('sk_refresh');
    expect(response.body.refreshToken).toBeUndefined();
  });

  it('не отдаёт наружу хэш пароля', async () => {
    const response = await request(server())
      .post('/api/auth/register')
      .send(registrationPayload())
      .expect(201);

    expect(JSON.stringify(response.body)).not.toContain('argon2');
    expect(response.body.user.passwordHash).toBeUndefined();
  });

  it('записывает согласия с версиями документов', async () => {
    const payload = registrationPayload();
    await request(server()).post('/api/auth/register').send(payload).expect(201);

    const consents = await harness.prisma.consent.findMany({
      where: { user: { email: payload.email } },
    });

    expect(consents).toHaveLength(3);
    expect(consents.every((consent) => consent.documentVersion.length > 0)).toBe(true);
  });

  it('отклоняет регистрацию без принятия документов', async () => {
    await request(server())
      .post('/api/auth/register')
      .send(registrationPayload({ acceptDocuments: false }))
      .expect(400);
  });

  it('отклоняет короткий пароль', async () => {
    await request(server())
      .post('/api/auth/register')
      .send(registrationPayload({ password: 'короткий' }))
      .expect(400);
  });

  it('не позволяет зарегистрировать один email дважды', async () => {
    const payload = registrationPayload();
    await request(server()).post('/api/auth/register').send(payload).expect(201);
    await request(server()).post('/api/auth/register').send(payload).expect(409);
  });

  it('пускает с верным паролем', async () => {
    const payload = registrationPayload();
    await request(server()).post('/api/auth/register').send(payload).expect(201);

    const response = await request(server())
      .post('/api/auth/login')
      .send({ email: payload.email, password: payload.password })
      .expect(200);

    expect(response.body.accessToken).toBeTruthy();
  });

  it('отвечает одинаково на неверный пароль и несуществующий email', async () => {
    const payload = registrationPayload();
    await request(server()).post('/api/auth/register').send(payload).expect(201);

    const wrongPassword = await request(server())
      .post('/api/auth/login')
      .send({ email: payload.email, password: 'совершенно-другой-пароль' })
      .expect(401);

    const unknownEmail = await request(server())
      .post('/api/auth/login')
      .send({ email: 'no-such-user@example.com', password: 'совершенно-другой-пароль' })
      .expect(401);

    // Разные тексты ошибок превратили бы логин в проверку существования аккаунта.
    expect(wrongPassword.body.message).toBe(unknownEmail.body.message);
  });

  it('обменивает refresh-cookie на новую пару токенов', async () => {
    const registration = await request(server())
      .post('/api/auth/register')
      .send(registrationPayload())
      .expect(201);

    const cookie = refreshCookieOf(registration);

    const refreshed = await request(server())
      .post('/api/auth/refresh')
      .set('Cookie', cookie)
      .expect(200);

    expect(refreshed.body.accessToken).toBeTruthy();

    const newCookie = extractCookie(
      refreshed.headers['set-cookie'] as unknown as string[],
      REFRESH_COOKIE_NAME,
    );
    expect(newCookie).not.toBe(extractCookie([cookie], REFRESH_COOKIE_NAME));
  });

  it('при повторном использовании старого refresh гасит всю сессию', async () => {
    const registration = await request(server())
      .post('/api/auth/register')
      .send(registrationPayload())
      .expect(201);

    const firstCookie = refreshCookieOf(registration);

    const refreshed = await request(server())
      .post('/api/auth/refresh')
      .set('Cookie', firstCookie)
      .expect(200);

    const secondCookie = refreshCookieOf(refreshed);

    // Украденная копия старого токена
    await request(server()).post('/api/auth/refresh').set('Cookie', firstCookie).expect(401);

    // …после чего перестаёт работать и «законный» новый токен: мы не знаем,
    // у кого из двоих настоящая сессия, поэтому гасим семейство целиком.
    await request(server()).post('/api/auth/refresh').set('Cookie', secondCookie).expect(401);

    const events = await harness.prisma.auditLog.findMany({
      where: { action: 'auth.refresh.reuse_detected' },
    });
    expect(events.length).toBeGreaterThan(0);
  });

  it('закрывает защищённые ручки без токена', async () => {
    await request(server()).get('/api/auth/me').expect(401);
    await request(server()).get('/api/widgets').expect(401);
    await request(server()).get('/api/privacy/consents').expect(401);
  });

  it('отвергает подделанный access-токен', async () => {
    await request(server())
      .get('/api/auth/me')
      .set('Authorization', 'Bearer eyJhbGciOiJIUzI1NiJ9.e30.forged-signature-value')
      .expect(401);
  });

  it('после выхода refresh-cookie больше не работает', async () => {
    const registration = await request(server())
      .post('/api/auth/register')
      .send(registrationPayload())
      .expect(201);

    const cookie = refreshCookieOf(registration);

    await request(server()).post('/api/auth/logout').set('Cookie', cookie).expect(204);
    await request(server()).post('/api/auth/refresh').set('Cookie', cookie).expect(401);
  });

  it('удаление несуществующей сессии отдаёт 404, а не 401', async () => {
    const registration = await request(harness.app.getHttpServer())
      .post('/api/auth/register')
      .send(registrationPayload())
      .expect(201);
    const token = registration.body.accessToken as string;

    // 401 клиент трактует как протухший access-токен: пойдёт обновляться,
    // получит 401 снова и разлогинит пользователя. То есть попытка завершить
    // уже завершённую с другого устройства сессию выкидывала из аккаунта.
    await request(harness.app.getHttpServer())
      .delete('/api/auth/sessions/00000000-0000-4000-8000-000000000000')
      .set({ Authorization: `Bearer ${token}` })
      .expect(404);
  });

  it('чужую сессию завершить нельзя, и она выглядит как несуществующая', async () => {
    const mine = await request(harness.app.getHttpServer())
      .post('/api/auth/register')
      .send(registrationPayload())
      .expect(201);
    const other = await request(harness.app.getHttpServer())
      .post('/api/auth/register')
      .send(registrationPayload())
      .expect(201);

    const otherSessions = await request(harness.app.getHttpServer())
      .get('/api/auth/sessions')
      .set({ Authorization: `Bearer ${other.body.accessToken as string}` })
      .expect(200);
    const foreignFamilyId = otherSessions.body[0].id as string;

    await request(harness.app.getHttpServer())
      .delete(`/api/auth/sessions/${foreignFamilyId}`)
      .set({ Authorization: `Bearer ${mine.body.accessToken as string}` })
      .expect(404);

    // И она действительно осталась живой.
    const stillThere = await request(harness.app.getHttpServer())
      .get('/api/auth/sessions')
      .set({ Authorization: `Bearer ${other.body.accessToken as string}` })
      .expect(200);
    expect(stillThere.body).toHaveLength(1);
  });
});
