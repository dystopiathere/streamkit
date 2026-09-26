import type { RoomParticipant } from '@streamkit/contracts';
import { generateSecret, generateSync } from 'otplib';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type BusMessage, RealtimeBus } from '../src/common/bus/realtime-bus.service';
import { CryptoService } from '../src/common/crypto/crypto.service';
import { ROOM_MEDIA_SERVER, type RoomMediaServer } from '../src/modules/rooms/livekit.service';
import { WidgetsService } from '../src/modules/widgets/widgets.service';
import { createHarness, extractCookie, registrationPayload, type TestHarness } from './harness';

const DAY_MS = 24 * 60 * 60 * 1000;
const PASSWORD = registrationPayload().password as string;

/** Медиасервер в памяти: проверяется, кого платформа выгоняет, а не само видео. */
class FakeMediaServer implements RoomMediaServer {
  readonly rooms = new Map<string, RoomParticipant[]>();
  readonly removed: string[] = [];

  join(roomId: string, identity: string): void {
    const list = this.rooms.get(roomId) ?? [];
    list.push({
      identity,
      role: identity.split(':')[0] as RoomParticipant['role'],
      name: 'Участник',
      joinedAt: new Date().toISOString(),
      tracks: [],
    });
    this.rooms.set(roomId, list);
  }

  async listParticipants(roomId: string): Promise<RoomParticipant[]> {
    return [...(this.rooms.get(roomId) ?? [])];
  }

  async removeParticipant(roomId: string, identity: string): Promise<void> {
    this.removed.push(identity);
    this.rooms.set(
      roomId,
      (this.rooms.get(roomId) ?? []).filter((participant) => participant.identity !== identity),
    );
  }

  async muteTrack(): Promise<void> {}
  async setPublishSources(): Promise<void> {}
}

describe('Админка (feature)', () => {
  let harness: TestHarness;
  const media = new FakeMediaServer();
  const messages: BusMessage[] = [];
  let unsubscribe: () => Promise<void>;

  beforeAll(async () => {
    harness = await createHarness([], (builder) =>
      builder.overrideProvider(ROOM_MEDIA_SERVER).useValue(media),
    );
    unsubscribe = await harness.app.get(RealtimeBus).subscribe((message) => {
      messages.push(message);
    });
  });

  afterAll(async () => {
    await unsubscribe();
    await harness.close();
  });

  beforeEach(async () => {
    await harness.reset();
    media.rooms.clear();
    media.removed.length = 0;
    messages.length = 0;
  });

  const server = () => harness.app.getHttpServer();
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  async function streamer(): Promise<{
    token: string;
    userId: string;
    email: string;
    cookie: string;
  }> {
    const payload = registrationPayload();
    const response = await request(server()).post('/api/auth/register').send(payload).expect(201);
    return {
      token: response.body.accessToken as string,
      userId: response.body.user.id as string,
      email: payload.email,
      cookie: extractCookie(response.headers['set-cookie'] as unknown as string[], 'sk_refresh')!,
    };
  }

  /** Сотрудник с ролью и включённым вторым фактором. */
  async function staffAccount(role: 'SUPPORT' | 'ADMIN' | 'USER', totp = true) {
    const account = await streamer();
    const secret = generateSecret();
    await harness.prisma.user.update({
      where: { id: account.userId },
      data: {
        role,
        isTotpEnabled: totp,
        totpSecretEncrypted: totp ? harness.app.get(CryptoService).encrypt(secret) : null,
      },
    });
    return { ...account, secret };
  }

  function adminLogin(email: string, secret: string) {
    return request(server())
      .post('/api/admin/auth/login')
      .send({ email, password: PASSWORD, totpCode: generateSync({ secret }) });
  }

  async function staff(role: 'SUPPORT' | 'ADMIN' = 'ADMIN') {
    const account = await staffAccount(role);
    const response = await adminLogin(account.email, account.secret).expect(200);
    return {
      ...account,
      adminToken: response.body.accessToken as string,
      adminCookie: extractCookie(
        response.headers['set-cookie'] as unknown as string[],
        'sk_admin_refresh',
      )!,
    };
  }

  async function overlayLink(
    token: string,
  ): Promise<{ widgetId: string; tokenId: string; raw: string }> {
    const widget = await request(server())
      .post('/api/widgets')
      .set(auth(token))
      .send({ name: 'Алерты', type: 'alerts', config: {} })
      .expect(201);
    const link = await request(server())
      .post(`/api/widgets/${widget.body.id}/tokens`)
      .set(auth(token))
      .send({ label: 'OBS' })
      .expect(201);
    const raw = new URL(link.body.url as string).searchParams.get('token')!;
    return { widgetId: widget.body.id as string, tokenId: link.body.id as string, raw };
  }

  async function until(check: () => boolean): Promise<void> {
    for (let attempt = 0; attempt < 50; attempt += 1) {
      if (check()) return;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error('Условие не выполнилось');
  }

  /* ---------------------------------------------------------------- */
  /* Вход и токены                                                      */
  /* ---------------------------------------------------------------- */

  describe('вход', () => {
    it('стример не входит, даже с верным паролем и кодом, — тем же ответом, что и неверный пароль', async () => {
      const user = await staffAccount('USER');
      const denied = await adminLogin(user.email, user.secret).expect(401);
      const wrong = await request(server())
        .post('/api/admin/auth/login')
        .send({ email: user.email, password: 'не-тот-пароль-123', totpCode: '000000' })
        .expect(401);
      expect(denied.body.message).toBe(wrong.body.message);
    });

    it('сотрудник без второго фактора не входит и узнаёт, что делать', async () => {
      const account = await staffAccount('SUPPORT', false);
      const response = await request(server())
        .post('/api/admin/auth/login')
        .send({ email: account.email, password: PASSWORD, totpCode: '123456' })
        .expect(403);
      expect(response.body.message).toMatch(/двухфакторн/i);
    });

    it('сотрудник с кодом входит и получает свою cookie на своём пути', async () => {
      const account = await staffAccount('SUPPORT');
      const response = await adminLogin(account.email, account.secret).expect(200);

      expect(response.body.user).toMatchObject({ id: account.userId, role: 'support' });
      const cookie = (response.headers['set-cookie'] as unknown as string[]).find((value) =>
        value.startsWith('sk_admin_refresh='),
      );
      expect(cookie).toContain('Path=/api/admin/auth');
      expect(cookie).toContain('SameSite=Strict');
    });

    it('один код не открывает вторую сессию', async () => {
      const account = await staffAccount('ADMIN');
      const code = generateSync({ secret: account.secret });
      const body = { email: account.email, password: PASSWORD, totpCode: code };
      await request(server()).post('/api/admin/auth/login').send(body).expect(200);
      await request(server()).post('/api/admin/auth/login').send(body).expect(401);
    });

    it('токен дашборда не открывает админку, админский — дашборд', async () => {
      const admin = await staff();
      await request(server()).get('/api/admin/users').set(auth(admin.token)).expect(401);
      await request(server()).get('/api/widgets').set(auth(admin.adminToken)).expect(401);
      await request(server()).get('/api/admin/users').set(auth(admin.adminToken)).expect(200);
    });

    it('refresh-cookie дашборда не обновляет админскую сессию, и наоборот', async () => {
      const admin = await staff();
      await request(server())
        .post('/api/admin/auth/refresh')
        .set('Cookie', `sk_admin_refresh=${admin.cookie}`)
        .expect(401);
      await request(server())
        .post('/api/auth/refresh')
        .set('Cookie', `sk_refresh=${admin.adminCookie}`)
        .expect(401);

      const refreshed = await request(server())
        .post('/api/admin/auth/refresh')
        .set('Cookie', `sk_admin_refresh=${admin.adminCookie}`)
        .expect(200);
      expect(refreshed.body.user.role).toBe('admin');
    });

    it('снятая роль закрывает админку сразу, при ещё живом токене', async () => {
      const admin = await staff();
      await harness.prisma.user.update({ where: { id: admin.userId }, data: { role: 'USER' } });

      await request(server()).get('/api/admin/users').set(auth(admin.adminToken)).expect(401);
      await request(server())
        .post('/api/admin/auth/refresh')
        .set('Cookie', `sk_admin_refresh=${admin.adminCookie}`)
        .expect(401);
    });

    it('второй фактор, выключенный в дашборде, закрывает и открытую сессию админки', async () => {
      const admin = await staff();
      await request(server())
        .post('/api/auth/totp/disable')
        .set(auth(admin.token))
        // Код входа в админку уже израсходован — берём код следующего шага,
        // который допуск часов принимает уже сейчас.
        .send({
          password: PASSWORD,
          code: generateSync({ secret: admin.secret, epoch: Math.floor(Date.now() / 1000) + 30 }),
        })
        .expect(204);

      await request(server()).get('/api/admin/users').set(auth(admin.adminToken)).expect(401);
      await request(server())
        .post('/api/admin/auth/refresh')
        .set('Cookie', `sk_admin_refresh=${admin.adminCookie}`)
        .expect(401);
    });

    it('код, которым вошли в дашборд, не открывает админку', async () => {
      const account = await staffAccount('ADMIN');
      const totpCode = generateSync({ secret: account.secret });
      await request(server())
        .post('/api/auth/login')
        .send({ email: account.email, password: PASSWORD, totpCode })
        .expect(200);

      await request(server())
        .post('/api/admin/auth/login')
        .send({ email: account.email, password: PASSWORD, totpCode })
        .expect(401);
    });
  });

  /* ---------------------------------------------------------------- */
  /* Права ролей                                                        */
  /* ---------------------------------------------------------------- */

  describe('роли', () => {
    it('поддержка смотрит, но не блокирует, не выдаёт роли и не читает журнал', async () => {
      const support = await staff('SUPPORT');
      const target = await streamer();
      const as = (req: request.Test) => req.set(auth(support.adminToken));

      await as(request(server()).get('/api/admin/users')).expect(200);
      await as(request(server()).get(`/api/admin/users/${target.userId}`)).expect(200);
      await as(request(server()).get('/api/admin/stats')).expect(200);

      await as(request(server()).post(`/api/admin/users/${target.userId}/suspend`))
        .send({ reason: 'спам' })
        .expect(403);
      await as(request(server()).patch(`/api/admin/users/${target.userId}/role`))
        .send({ role: 'admin' })
        .expect(403);
      await as(request(server()).post(`/api/admin/users/${target.userId}/anonymize`))
        .send({ confirmEmail: target.email })
        .expect(403);
      await as(request(server()).get('/api/admin/audit')).expect(403);
    });

    it('поддержка гасит сессии и второй фактор стримерам, но не сотрудникам', async () => {
      const support = await staff('SUPPORT');
      const admin = await staff();
      const target = await streamer();
      const as = (req: request.Test) => req.set(auth(support.adminToken));

      await as(request(server()).post(`/api/admin/users/${admin.userId}/totp/reset`)).expect(403);
      await as(request(server()).post(`/api/admin/users/${admin.userId}/sessions/revoke`))
        .send({})
        .expect(403);
      // Админ остался в админке: ни сессия, ни второй фактор не тронуты.
      await request(server()).get('/api/admin/users').set(auth(admin.adminToken)).expect(200);

      await as(request(server()).post(`/api/admin/users/${target.userId}/sessions/revoke`))
        .send({})
        .expect(204);
    });

    it('админ выдаёт роль другому, но не меняет свою', async () => {
      const admin = await staff();
      const target = await streamer();

      await request(server())
        .patch(`/api/admin/users/${target.userId}/role`)
        .set(auth(admin.adminToken))
        .send({ role: 'support' })
        .expect(204);
      await request(server())
        .patch(`/api/admin/users/${admin.userId}/role`)
        .set(auth(admin.adminToken))
        .send({ role: 'user' })
        .expect(400);

      const log = await harness.prisma.auditLog.findFirstOrThrow({
        where: { action: 'admin.role.changed', userId: target.userId },
      });
      expect(log.actorId).toBe(admin.userId);
      expect(log.metadata).toEqual({ from: 'user', to: 'support' });
    });

    it('неизвестный пользователь — 404', async () => {
      const admin = await staff();
      await request(server())
        .get('/api/admin/users/00000000-0000-4000-8000-000000000000')
        .set(auth(admin.adminToken))
        .expect(404);
    });
  });

  /* ---------------------------------------------------------------- */
  /* Блокировка                                                         */
  /* ---------------------------------------------------------------- */

  describe('блокировка', () => {
    it('гасит токен, сессию, ссылки OBS и комнаты сразу', async () => {
      const admin = await staff();
      const target = await streamer();
      const link = await overlayLink(target.token);
      const room = await request(server())
        .post('/api/rooms')
        .set(auth(target.token))
        .send({ name: 'Подкаст' })
        .expect(201);
      const invite = await request(server())
        .post(`/api/rooms/${room.body.id}/invites`)
        .set(auth(target.token))
        .send({ label: 'Гость' })
        .expect(201);
      media.join(room.body.id as string, `host:${target.userId}`);

      await request(server())
        .post(`/api/admin/users/${target.userId}/suspend`)
        .set(auth(admin.adminToken))
        .send({ reason: 'нарушение п. 6 соглашения' })
        .expect(204);

      // Выданный до блокировки access-токен больше не работает.
      await request(server()).get('/api/widgets').set(auth(target.token)).expect(401);
      await request(server())
        .post('/api/auth/refresh')
        .set('Cookie', `sk_refresh=${target.cookie}`)
        .expect(401);
      await request(server())
        .post('/api/auth/login')
        .send({ email: target.email, password: PASSWORD })
        .expect(401);

      expect(await harness.app.get(WidgetsService).resolveOverlayToken(link.raw)).toBeNull();
      await until(() =>
        messages.some(
          (message) =>
            message.kind === 'overlay-revoked' &&
            message.tokenId === link.tokenId &&
            message.reason === 'owner-suspended',
        ),
      );
      expect(messages).toContainEqual({ kind: 'user-suspended', userId: target.userId });
      expect(media.removed).toContain(`host:${target.userId}`);

      const raw = (invite.body.url as string).split('#')[1];
      await request(server())
        .post('/api/rooms/join')
        .send({ token: raw, displayName: 'Вася', acceptTerms: true })
        .expect(402);

      const log = await harness.prisma.auditLog.findFirstOrThrow({
        where: { action: 'admin.user.suspended' },
      });
      expect(log).toMatchObject({ userId: target.userId, actorId: admin.userId });
      expect(log.metadata).toEqual({ reason: 'нарушение п. 6 соглашения' });
    });

    it('разблокировка возвращает вход и ссылки, но не сессии', async () => {
      const admin = await staff();
      const target = await streamer();
      const link = await overlayLink(target.token);
      const as = (req: request.Test) => req.set(auth(admin.adminToken));

      await as(request(server()).post(`/api/admin/users/${target.userId}/suspend`))
        .send({ reason: 'проверка' })
        .expect(204);
      await as(request(server()).post(`/api/admin/users/${target.userId}/restore`)).expect(204);

      await request(server())
        .post('/api/auth/refresh')
        .set('Cookie', `sk_refresh=${target.cookie}`)
        .expect(401);
      const login = await request(server())
        .post('/api/auth/login')
        .send({ email: target.email, password: PASSWORD })
        .expect(200);
      await request(server()).get('/api/widgets').set(auth(login.body.accessToken)).expect(200);
      expect(await harness.app.get(WidgetsService).resolveOverlayToken(link.raw)).not.toBeNull();
    });

    it('себя заблокировать нельзя', async () => {
      const admin = await staff();
      await request(server())
        .post(`/api/admin/users/${admin.userId}/suspend`)
        .set(auth(admin.adminToken))
        .send({ reason: 'ошибка' })
        .expect(400);
    });

    it('без причины не блокирует', async () => {
      const admin = await staff();
      const target = await streamer();
      await request(server())
        .post(`/api/admin/users/${target.userId}/suspend`)
        .set(auth(admin.adminToken))
        .send({ reason: '   ' })
        .expect(400);
    });
  });

  /* ---------------------------------------------------------------- */
  /* Объекты                                                            */
  /* ---------------------------------------------------------------- */

  describe('ссылки и приглашения', () => {
    it('отзыв ссылки поддержкой обрывает оверлей и пишет автора в журнал', async () => {
      const support = await staff('SUPPORT');
      const target = await streamer();
      const link = await overlayLink(target.token);

      await request(server())
        .delete(`/api/admin/widgets/${link.widgetId}/tokens/${link.tokenId}`)
        .set(auth(support.adminToken))
        .expect(204);

      expect(await harness.app.get(WidgetsService).resolveOverlayToken(link.raw)).toBeNull();
      await until(() =>
        messages.some(
          (message) =>
            message.kind === 'overlay-revoked' &&
            message.tokenId === link.tokenId &&
            message.reason === 'token-revoked',
        ),
      );
      const log = await harness.prisma.auditLog.findFirstOrThrow({
        where: { action: 'overlay.token.revoked' },
      });
      expect(log).toMatchObject({ userId: target.userId, actorId: support.userId });
    });

    it('«отозвать все» гасит все живые ссылки виджета', async () => {
      const support = await staff('SUPPORT');
      const target = await streamer();
      const link = await overlayLink(target.token);
      await request(server())
        .post(`/api/widgets/${link.widgetId}/tokens`)
        .set(auth(target.token))
        .send({ label: 'Второй компьютер' })
        .expect(201);

      const response = await request(server())
        .post(`/api/admin/widgets/${link.widgetId}/tokens/revoke-all`)
        .set(auth(support.adminToken))
        .expect(200);

      expect(response.body).toEqual({ revoked: 2 });
      expect(
        await harness.prisma.overlayToken.count({
          where: { widgetId: link.widgetId, revokedAt: null },
        }),
      ).toBe(0);
    });

    it('выключение виджета из админки видно владельцу', async () => {
      const support = await staff('SUPPORT');
      const target = await streamer();
      const link = await overlayLink(target.token);

      await request(server())
        .patch(`/api/admin/widgets/${link.widgetId}`)
        .set(auth(support.adminToken))
        .send({ isEnabled: false })
        .expect(204);

      const widget = await request(server())
        .get(`/api/widgets/${link.widgetId}`)
        .set(auth(target.token))
        .expect(200);
      expect(widget.body.isEnabled).toBe(false);
      expect(
        await harness.prisma.auditLog.count({ where: { action: 'admin.widget.disabled' } }),
      ).toBe(1);
    });

    it('отзыв приглашения из админки', async () => {
      const support = await staff('SUPPORT');
      const target = await streamer();
      const room = await request(server())
        .post('/api/rooms')
        .set(auth(target.token))
        .send({ name: 'Подкаст' })
        .expect(201);
      const invite = await request(server())
        .post(`/api/rooms/${room.body.id}/invites`)
        .set(auth(target.token))
        .send({ label: 'для Васи Пупкина' })
        .expect(201);

      const list = await request(server())
        .get(`/api/admin/rooms/${room.body.id}/invites`)
        .set(auth(support.adminToken))
        .expect(200);
      expect(list.body).toHaveLength(1);
      // Пометка — имя гостя, данные по поручению стримера: сотруднику не видна.
      expect(JSON.stringify(list.body)).not.toContain('Пупкин');

      await request(server())
        .delete(`/api/admin/rooms/${room.body.id}/invites/${invite.body.id}`)
        .set(auth(support.adminToken))
        .expect(204);
      const row = await harness.prisma.roomInvite.findUniqueOrThrow({
        where: { id: invite.body.id as string },
      });
      expect(row.revokedAt).not.toBeNull();
    });
  });

  describe('обезличивание', () => {
    it('требует почту аккаунта и обрывает открытые оверлеи', async () => {
      const admin = await staff();
      const target = await streamer();
      const link = await overlayLink(target.token);
      await request(server()).post('/api/events/test').set(auth(target.token)).expect(201);
      const as = (req: request.Test) => req.set(auth(admin.adminToken));

      await as(request(server()).post(`/api/admin/users/${target.userId}/anonymize`))
        .send({ confirmEmail: 'other@example.com' })
        .expect(400);
      await as(request(server()).post(`/api/admin/users/${target.userId}/anonymize`))
        .send({ confirmEmail: target.email })
        .expect(204);

      const user = await harness.prisma.user.findUniqueOrThrow({ where: { id: target.userId } });
      expect(user.status).toBe('ANONYMIZED');
      const event = await harness.prisma.alertEvent.findFirstOrThrow({
        where: { userId: target.userId },
      });
      expect(event.username).toBe('Аноним');
      await until(() =>
        messages.some(
          (message) => message.kind === 'overlay-revoked' && message.tokenId === link.tokenId,
        ),
      );
      await request(server()).get('/api/widgets').set(auth(target.token)).expect(401);
    });
  });

  /* ---------------------------------------------------------------- */
  /* Данные                                                             */
  /* ---------------------------------------------------------------- */

  describe('данные', () => {
    it('карточка и статистика не содержат имён и сообщений донатеров', async () => {
      const admin = await staff();
      const target = await streamer();
      await request(server()).post('/api/events/test').set(auth(target.token)).expect(201);
      await harness.prisma.alertEvent.updateMany({ data: { isTest: false } });

      const detail = await request(server())
        .get(`/api/admin/users/${target.userId}`)
        .set(auth(admin.adminToken))
        .expect(200);
      const stats = await request(server())
        .get('/api/admin/stats')
        .set(auth(admin.adminToken))
        .expect(200);

      expect(detail.body.eventCount).toBe(1);
      for (const body of [detail.body, stats.body]) {
        const json = JSON.stringify(body);
        expect(json).not.toContain('Тестовый зритель');
        expect(json).not.toContain('Проверка оповещения');
      }
    });

    it('карточка показывает, подтверждена ли почта, и журнал писем — без адреса и текста', async () => {
      const admin = await staff();
      const target = await streamer();
      await harness.prisma.mailLog.createMany({
        data: [
          { userId: target.userId, kind: 'EMAIL_VERIFICATION', status: 'SENT' },
          { userId: target.userId, kind: 'NEW_DEVICE', status: 'SKIPPED_UNVERIFIED' },
        ],
      });

      const before = await request(server())
        .get(`/api/admin/users/${target.userId}`)
        .set(auth(admin.adminToken))
        .expect(200);
      expect(before.body.user).toMatchObject({ emailVerified: false, emailVerifiedAt: null });
      expect(
        before.body.mails.map((mail: { kind: string; status: string }) => [mail.kind, mail.status]),
      ).toEqual(
        expect.arrayContaining([
          ['email_verification', 'sent'],
          ['new_device', 'skipped_unverified'],
        ]),
      );

      await harness.prisma.user.update({
        where: { id: target.userId },
        data: { emailVerifiedAt: new Date() },
      });
      const list = await request(server())
        .get('/api/admin/users')
        .query({ q: target.email })
        .set(auth(admin.adminToken))
        .expect(200);
      expect(list.body.items[0].emailVerified).toBe(true);
    });

    it('просмотр карточки пишется в журнал с автором', async () => {
      const support = await staff('SUPPORT');
      const target = await streamer();
      await request(server())
        .get(`/api/admin/users/${target.userId}`)
        .set(auth(support.adminToken))
        .expect(200);

      const log = await harness.prisma.auditLog.findFirstOrThrow({
        where: { action: 'admin.user.viewed' },
      });
      expect(log).toMatchObject({ userId: target.userId, actorId: support.userId });
    });

    it('поиск, фильтры и курсор списка пользователей', async () => {
      const admin = await staff();
      const found = await streamer();
      await harness.prisma.user.update({
        where: { id: found.userId },
        data: { displayName: 'Искомый_стример' },
      });
      await streamer();
      await streamer();
      const as = (path: string) =>
        request(server()).get(path).set(auth(admin.adminToken)).expect(200);

      const byName = await as(`/api/admin/users?q=${encodeURIComponent('мый_ст')}`);
      expect(byName.body.items.map((row: { id: string }) => row.id)).toEqual([found.userId]);
      // «_» — символ, а не шаблон: без экранирования нашлись бы все.
      const underscore = await as(`/api/admin/users?q=_`);
      expect(underscore.body.items).toHaveLength(1);

      const admins = await as('/api/admin/users?role=admin');
      expect(admins.body.items.map((row: { id: string }) => row.id)).toEqual([admin.userId]);

      const first = await as('/api/admin/users?limit=2');
      expect(first.body.items).toHaveLength(2);
      const second = await as(`/api/admin/users?limit=2&cursor=${first.body.nextCursor}`);
      expect(second.body.items).toHaveLength(2);
      expect(second.body.nextCursor).toBeNull();
      const ids = [...first.body.items, ...second.body.items].map((row: { id: string }) => row.id);
      expect(new Set(ids).size).toBe(4);
    });

    it('статистика: регистрации, регулярная выручка и выручка за вычетом возвратов', async () => {
      const admin = await staff();
      const payer = await streamer();
      const subscription = await harness.prisma.subscription.create({
        data: {
          userId: payer.userId,
          period: 'YEAR',
          currentPeriodEnd: new Date(Date.now() + 300 * DAY_MS),
          autoRenew: true,
          renewalAmountMinor: 490_000,
          renewalCurrency: 'RUB',
        },
      });
      await harness.prisma.payment.create({
        data: {
          userId: payer.userId,
          subscriptionId: subscription.id,
          kind: 'INITIAL',
          period: 'YEAR',
          amountMinor: 490_000,
          currency: 'RUB',
          status: 'SUCCEEDED',
          paidAt: new Date(),
          refundedAmountMinor: 90_000,
        },
      });

      const stats = await request(server())
        .get('/api/admin/stats?range=30d')
        .set(auth(admin.adminToken))
        .expect(200);

      const total = (points: Array<{ value: number }>) =>
        points.reduce((sum, point) => sum + point.value, 0);
      expect(stats.body.bucket).toBe('day');
      expect(stats.body.series.registrations.length).toBeGreaterThanOrEqual(30);
      expect(total(stats.body.series.registrations)).toBe(2);
      expect(stats.body.users).toMatchObject({ total: 2, suspended: 0 });
      expect(stats.body.subscriptions).toMatchObject({
        activeYear: 1,
        activeMonth: 0,
        mrr: [{ currency: 'RUB', amountMinor: 40_833 }],
      });
      expect(stats.body.series.revenue).toEqual([{ currency: 'RUB', points: expect.any(Array) }]);
      expect(total(stats.body.series.revenue[0].points)).toBe(400_000);

      const year = await request(server())
        .get('/api/admin/stats?range=365d')
        .set(auth(admin.adminToken))
        .expect(200);
      expect(year.body.bucket).toBe('week');
    });

    it('бесплатные дни из админки дарят выбранный тариф и пишут причину', async () => {
      const admin = await staff();
      const target = await streamer();

      const response = await request(server())
        .post(`/api/admin/users/${target.userId}/subscription/extend`)
        .set(auth(admin.adminToken))
        .send({ days: 14, plan: 'multistream', reason: 'компенсация сбоя' })
        .expect(201);

      // Тариф подарка выбирает сотрудник. Что он открывает, проверяет тест
      // подписки: здесь оплата не настроена, и открыто всё.
      expect(response.body).toMatchObject({
        status: 'active',
        plan: 'multistream',
        autoRenew: false,
      });
      const log = await harness.prisma.auditLog.findFirstOrThrow({
        where: { action: 'admin.subscription.extended' },
      });
      expect(log).toMatchObject({ userId: target.userId, actorId: admin.userId });
      expect(log.metadata).toEqual({ reason: 'компенсация сбоя', days: 14, plan: 'multistream' });
    });

    it('снятие подарочных дней возвращает срок и пишет автора', async () => {
      const admin = await staff();
      const target = await streamer();
      await request(server())
        .post(`/api/admin/users/${target.userId}/subscription/extend`)
        .set(auth(admin.adminToken))
        .send({ days: 14, reason: 'компенсация сбоя' })
        .expect(201);

      const response = await request(server())
        .post(`/api/admin/users/${target.userId}/subscription/revoke-gift`)
        .set(auth(admin.adminToken))
        .send({ days: 30, reason: 'выдано по ошибке' })
        .expect(201);

      // Срок вернулся туда, где был до подарка: подписки у стримера не было,
      // значит период кончился.
      expect(response.body).toMatchObject({ giftedDays: 0, status: 'expired' });
      const log = await harness.prisma.auditLog.findFirstOrThrow({
        where: { action: 'admin.subscription.gift_revoked' },
      });
      expect(log).toMatchObject({ userId: target.userId, actorId: admin.userId });
      // Просили тридцать, подарено было четырнадцать — в журнале снятое, а не
      // запрошенное.
      expect(log.metadata).toMatchObject({ days: 14, requestedDays: 30 });
    });

    it('обнуление истории донатов из админки удаляет события и пишет причину', async () => {
      const admin = await staff();
      const target = await streamer();
      await harness.prisma.alertEvent.create({
        data: {
          userId: target.userId,
          type: 'DONATION',
          provider: 'WEBHOOK',
          externalId: 'donation-1',
          username: 'Щедрый',
          message: 'спасибо',
          amountMinor: 50_000,
          currency: 'RUB',
          occurredAt: new Date(),
        },
      });

      await request(server())
        .post(`/api/admin/users/${target.userId}/donations/reset`)
        .set(auth(admin.adminToken))
        .send({ reason: 'просьба владельца письмом' })
        .expect(204);

      expect(await harness.prisma.alertEvent.count({ where: { userId: target.userId } })).toBe(0);
      const log = await harness.prisma.auditLog.findFirstOrThrow({
        where: { action: 'events.history.reset' },
      });
      // Ни имени донатера, ни суммы: в журнал идёт только объём и причина.
      expect(log.metadata).toEqual({ reason: 'просьба владельца письмом', removedEvents: 1 });
      expect(log).toMatchObject({ userId: target.userId, actorId: admin.userId });
    });

    it('журнал фильтруется по префиксу действия', async () => {
      const admin = await staff();
      const target = await streamer();
      await request(server())
        .get(`/api/admin/users/${target.userId}`)
        .set(auth(admin.adminToken))
        .expect(200);

      const response = await request(server())
        .get('/api/admin/audit?action=admin.')
        .set(auth(admin.adminToken))
        .expect(200);
      const actions = response.body.items.map((row: { action: string }) => row.action);
      expect(actions).toContain('admin.user.viewed');
      expect(actions.every((action: string) => action.startsWith('admin.'))).toBe(true);
      expect(response.body.items[0].actorEmail).toBe(admin.email);
    });
  });
});
