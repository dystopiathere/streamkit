import {
  guestIdentity,
  MAX_GUESTS_PER_ROOM,
  overlayIdentity,
  type RoomParticipant,
} from '@streamkit/contracts';
import { createHash } from 'node:crypto';
import { AccessToken, TokenVerifier } from 'livekit-server-sdk';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ROOM_GUEST_TERMS } from '../src/modules/privacy/legal-documents';
import {
  type PublishSource,
  ROOM_MEDIA_SERVER,
  type RoomMediaServer,
} from '../src/modules/rooms/livekit.service';
import { createHarness, registrationPayload, type TestHarness } from './harness';

/**
 * Медиасервер в памяти.
 *
 * LiveKit здесь не поднимается: интеграционный тест проверяет решения
 * платформы — кому выдать токен, с какими правами, кого можно удалить. Путь
 * через настоящий медиасервер с настоящим видео закрыт сквозным тестом.
 */
class FakeMediaServer implements RoomMediaServer {
  readonly rooms = new Map<string, RoomParticipant[]>();
  readonly muted: string[] = [];
  /** Кого выгнали — в порядке удаления. */
  readonly removed: string[] = [];
  readonly sources = new Map<string, PublishSource[]>();
  /** Участники, на которых медиасервер отвечает сбоем. */
  readonly failing = new Set<string>();

  private fail(identity: string): void {
    if (this.failing.has(identity)) throw new Error(`медиасервер недоступен для ${identity}`);
  }

  join(roomId: string, participant: Partial<RoomParticipant> & { identity: string }): void {
    const list = this.rooms.get(roomId) ?? [];
    const role = participant.identity.split(':')[0] as RoomParticipant['role'];
    list.push({
      role,
      name: 'Участник',
      joinedAt: new Date().toISOString(),
      tracks: [],
      ...participant,
    });
    this.rooms.set(roomId, list);
  }

  async listParticipants(roomId: string): Promise<RoomParticipant[]> {
    return [...(this.rooms.get(roomId) ?? [])];
  }

  async removeParticipant(roomId: string, identity: string): Promise<void> {
    this.fail(identity);
    this.removed.push(identity);
    this.rooms.set(
      roomId,
      (this.rooms.get(roomId) ?? []).filter((participant) => participant.identity !== identity),
    );
  }

  async muteTrack(_roomId: string, identity: string, trackSid: string): Promise<void> {
    this.fail(identity);
    this.muted.push(`${identity}/${trackSid}`);
  }

  async setPublishSources(
    _roomId: string,
    identity: string,
    sources: PublishSource[],
  ): Promise<void> {
    this.fail(identity);
    this.sources.set(identity, sources);
  }
}

const verifier = () =>
  new TokenVerifier(process.env.LIVEKIT_API_KEY!, process.env.LIVEKIT_API_SECRET!);

describe('Приватные комнаты (feature)', () => {
  let harness: TestHarness;
  const media = new FakeMediaServer();

  beforeAll(async () => {
    harness = await createHarness([], (builder) =>
      builder.overrideProvider(ROOM_MEDIA_SERVER).useValue(media),
    );
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await harness.reset();
    media.rooms.clear();
    media.muted.length = 0;
    media.removed.length = 0;
    media.sources.clear();
    media.failing.clear();
  });

  const server = () => harness.app.getHttpServer();

  async function streamer(): Promise<{ token: string; userId: string }> {
    const response = await request(server())
      .post('/api/auth/register')
      .send(registrationPayload({ displayName: 'Стример комнаты' }))
      .expect(201);
    return { token: response.body.accessToken as string, userId: response.body.user.id as string };
  }

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  async function createRoom(token: string, name = 'Подкаст'): Promise<string> {
    const response = await request(server())
      .post('/api/rooms')
      .set(auth(token))
      .send({ name })
      .expect(201);
    return response.body.id as string;
  }

  async function createInvite(
    token: string,
    roomId: string,
    label = 'Вася',
  ): Promise<{ id: string; raw: string; url: string }> {
    const response = await request(server())
      .post(`/api/rooms/${roomId}/invites`)
      .set(auth(token))
      .send({ label })
      .expect(201);
    const url = response.body.url as string;
    return { id: response.body.id as string, raw: url.split('#')[1]!, url };
  }

  function join(raw: string, body: Record<string, unknown> = {}) {
    return request(server())
      .post('/api/rooms/join')
      .send({ token: raw, displayName: 'Вася', acceptTerms: true, ...body });
  }

  async function guestsWidget(token: string, roomId: string): Promise<string> {
    const response = await request(server())
      .post('/api/widgets')
      .set(auth(token))
      .send({ name: 'Гости', type: 'guests', config: { roomId } })
      .expect(201);
    return response.body.id as string;
  }

  async function overlayToken(
    token: string,
    widgetId: string,
  ): Promise<{ id: string; raw: string }> {
    const response = await request(server())
      .post(`/api/widgets/${widgetId}/tokens`)
      .set(auth(token))
      .send({})
      .expect(201);
    const url = new URL(response.body.url as string);
    return { id: response.body.id as string, raw: url.searchParams.get('token')! };
  }

  /* ---------------------------------------------------------------- */

  it('чужая комната отвечает 404 на любое действие', async () => {
    const owner = await streamer();
    const stranger = await streamer();
    const roomId = await createRoom(owner.token);

    await request(server()).get(`/api/rooms/${roomId}`).set(auth(stranger.token)).expect(404);
    await request(server())
      .post(`/api/rooms/${roomId}/invites`)
      .set(auth(stranger.token))
      .send({ label: 'Взлом' })
      .expect(404);
    await request(server())
      .post(`/api/rooms/${roomId}/host-access`)
      .set(auth(stranger.token))
      .expect(404);
    await request(server()).delete(`/api/rooms/${roomId}`).set(auth(stranger.token)).expect(404);

    const list = await request(server()).get('/api/rooms').set(auth(stranger.token)).expect(200);
    expect(list.body).toEqual([]);
  });

  it('хранит только хэш приглашения, а ссылку отдаёт с токеном во фрагменте', async () => {
    const owner = await streamer();
    const roomId = await createRoom(owner.token);
    const invite = await createInvite(owner.token, roomId);

    // Фрагмент не уходит на сервер и не оседает в журналах прокси.
    expect(invite.url).toMatch(/\/join#[A-Za-z0-9_-]{40,}$/);
    const row = await harness.prisma.roomInvite.findUniqueOrThrow({ where: { id: invite.id } });
    expect(row.tokenHash).not.toContain(invite.raw);
    expect(JSON.stringify(row)).not.toContain(invite.raw);
  });

  it('впускает гостя по ссылке с правами гостя и записывает согласие без имени', async () => {
    const owner = await streamer();
    const roomId = await createRoom(owner.token, 'Вечерний эфир');
    const invite = await createInvite(owner.token, roomId);

    const response = await join(invite.raw, { displayName: '  Вася Пупкин  ' }).expect(200);
    expect(response.body.url).toBe('wss://livekit.test');
    expect(response.body.roomName).toBe('Вечерний эфир');
    // Ссылка «создайте свою комнату» у гостя ведёт на регистрацию с промокодом
    // стримера — тем же, что он видит у себя в «Приглашениях».
    const owned = await harness.prisma.user.findUniqueOrThrow({ where: { id: owner.userId } });
    expect(response.body.hostReferralCode).toBe(owned.referralCode);
    expect(response.body.hostReferralCode).toMatch(/^[A-Z0-9]{8}$/);

    const claims = await verifier().verify(response.body.token as string);
    expect(claims.sub).toMatch(new RegExp(`^guest:${invite.id}:`));
    expect(claims.name).toBe('Вася Пупкин');
    expect(claims.video).toMatchObject({
      room: `room-${roomId}`,
      roomJoin: true,
      canSubscribe: true,
      canPublishData: false,
      canPublishSources: ['camera', 'microphone'],
    });
    expect(claims.video?.hidden).toBeFalsy();
    expect(claims.video?.roomAdmin).toBeFalsy();

    const consents = await harness.prisma.guestConsent.findMany({ where: { inviteId: invite.id } });
    expect(consents).toHaveLength(1);
    expect(consents[0]!.documentVersion).toBe(ROOM_GUEST_TERMS.version);
    // Имя гостя в БД не пишется: оно живёт только в токене.
    expect(JSON.stringify(consents)).not.toContain('Вася');

    const row = await harness.prisma.roomInvite.findUniqueOrThrow({ where: { id: invite.id } });
    expect(row.lastUsedAt).not.toBeNull();
  });

  it('без согласия гость не входит', async () => {
    const owner = await streamer();
    const invite = await createInvite(owner.token, await createRoom(owner.token));

    await join(invite.raw, { acceptTerms: false }).expect(400);
    expect(await harness.prisma.guestConsent.count()).toBe(0);
  });

  it('отозванная ссылка неотличима от несуществующей', async () => {
    const owner = await streamer();
    const roomId = await createRoom(owner.token);
    const invite = await createInvite(owner.token, roomId);
    await request(server())
      .delete(`/api/rooms/${roomId}/invites/${invite.id}`)
      .set(auth(owner.token))
      .expect(204);

    const revoked = await join(invite.raw).expect(404);
    const missing = await join('несуществующий-токен').expect(404);
    expect(revoked.body).toEqual(missing.body);
  });

  it('не впускает гостя сверх лимита', async () => {
    const owner = await streamer();
    const roomId = await createRoom(owner.token);
    const invite = await createInvite(owner.token, roomId);
    const others: string[] = [];
    for (let index = 0; index < MAX_GUESTS_PER_ROOM - 1; index += 1) {
      const other = await createInvite(owner.token, roomId, `Гость ${index}`);
      others.push(other.id);
      media.join(roomId, { identity: guestIdentity(other.id, `g${index}`) });
    }
    // Вторая вкладка того же гостя — всё ещё одно место: мест занято семь.
    media.join(roomId, { identity: guestIdentity(others[0]!, 'second-tab') });
    const eighth = await createInvite(owner.token, roomId, 'Восьмой');
    await join(eighth.raw).expect(200);
    media.join(roomId, { identity: guestIdentity(eighth.id, 'tab') });
    // Оверлей и стример мест гостей не занимают.
    media.join(roomId, { identity: `host:${owner.userId}` });

    await join(invite.raw).expect(409);
  });

  it('отзыв ссылки выкидывает только гостей этой ссылки', async () => {
    const owner = await streamer();
    const roomId = await createRoom(owner.token);
    const vasya = await createInvite(owner.token, roomId, 'Вася');
    const petya = await createInvite(owner.token, roomId, 'Петя');
    media.join(roomId, { identity: guestIdentity(vasya.id, 'tab1') });
    media.join(roomId, { identity: guestIdentity(vasya.id, 'tab2') });
    media.join(roomId, { identity: guestIdentity(petya.id, 'tab1') });

    await request(server())
      .delete(`/api/rooms/${roomId}/invites/${vasya.id}`)
      .set(auth(owner.token))
      .expect(204);

    const left = await media.listParticipants(roomId);
    expect(left.map((participant) => participant.identity)).toEqual([
      guestIdentity(petya.id, 'tab1'),
    ]);
  });

  it('«удалить и отозвать» закрывает гостю повторный вход', async () => {
    const owner = await streamer();
    const roomId = await createRoom(owner.token);
    const invite = await createInvite(owner.token, roomId);
    const identity = guestIdentity(invite.id, 'tab1');
    media.join(roomId, { identity });

    await request(server())
      .post(`/api/rooms/${roomId}/participants/${encodeURIComponent(identity)}/remove?revoke=true`)
      .set(auth(owner.token))
      .expect(204);

    expect(await media.listParticipants(roomId)).toEqual([]);
    await join(invite.raw).expect(404);
  });

  it('просто «удалить» ссылку не отзывает', async () => {
    const owner = await streamer();
    const roomId = await createRoom(owner.token);
    const invite = await createInvite(owner.token, roomId);
    const identity = guestIdentity(invite.id, 'tab1');
    media.join(roomId, { identity });

    await request(server())
      .post(`/api/rooms/${roomId}/participants/${encodeURIComponent(identity)}/remove`)
      .set(auth(owner.token))
      .expect(204);

    expect(await media.listParticipants(roomId)).toEqual([]);
    await join(invite.raw).expect(200);
  });

  it('удалить или заглушить можно только гостя', async () => {
    const owner = await streamer();
    const roomId = await createRoom(owner.token);

    for (const identity of [`host:${owner.userId}`, overlayIdentity(owner.userId), 'кто-то']) {
      await request(server())
        .post(`/api/rooms/${roomId}/participants/${encodeURIComponent(identity)}/remove`)
        .set(auth(owner.token))
        .expect(400);
      for (const action of ['mute', 'unmute']) {
        await request(server())
          .post(`/api/rooms/${roomId}/participants/${encodeURIComponent(identity)}/${action}`)
          .set(auth(owner.token))
          .expect(400);
      }
    }
  });

  it('выключенный микрофон гость не включит сам — ни кнопкой, ни перезагрузкой', async () => {
    // Раньше «заглушить» ставило дорожке флаг, который гость снимал той же
    // кнопкой микрофона. Теперь у всех вкладок гостя отнимается ПРАВО на
    // микрофон, а запрет пишется на ссылку — новый токен выдаётся уже без него.
    const owner = await streamer();
    const roomId = await createRoom(owner.token);
    const invite = await createInvite(owner.token, roomId);
    const tab1 = guestIdentity(invite.id, 'tab1');
    const tab2 = guestIdentity(invite.id, 'tab2');
    const other = await createInvite(owner.token, roomId, 'Петя');
    const petya = guestIdentity(other.id, 'tab1');
    media.join(roomId, {
      identity: tab1,
      tracks: [
        { sid: 'TR_mic', kind: 'audio', muted: false },
        { sid: 'TR_cam', kind: 'video', muted: false },
        { sid: 'TR_old', kind: 'audio', muted: true },
      ],
    });
    media.join(roomId, { identity: tab2 });
    media.join(roomId, { identity: petya });

    await request(server())
      .post(`/api/rooms/${roomId}/participants/${encodeURIComponent(tab1)}/mute`)
      .set(auth(owner.token))
      .expect(204);

    // Звук гаснет сразу, права меняются у обеих вкладок и только у них.
    expect(media.muted).toEqual([`${tab1}/TR_mic`]);
    expect(media.sources.get(tab1)).toEqual(['camera']);
    expect(media.sources.get(tab2)).toEqual(['camera']);
    expect(media.sources.has(petya)).toBe(false);

    const invites = await request(server())
      .get(`/api/rooms/${roomId}/invites`)
      .set(auth(owner.token))
      .expect(200);
    expect(invites.body.find((row: { id: string }) => row.id === invite.id).micBlocked).toBe(true);

    // Перезагрузка вкладки: новый токен уже без микрофона.
    const rejoin = await join(invite.raw).expect(200);
    expect(rejoin.body.microphoneAllowed).toBe(false);
    const claims = await verifier().verify(rejoin.body.token as string);
    expect(claims.video?.canPublishSources).toEqual(['camera']);

    // Разрешение возвращает право, но включает микрофон гость сам.
    await request(server())
      .post(`/api/rooms/${roomId}/participants/${encodeURIComponent(tab1)}/unmute`)
      .set(auth(owner.token))
      .expect(204);
    expect(media.sources.get(tab2)).toEqual(['camera', 'microphone']);
    const allowed = await join(invite.raw).expect(200);
    expect(allowed.body.microphoneAllowed).toBe(true);
    expect(
      (await verifier().verify(allowed.body.token as string)).video?.canPublishSources,
    ).toEqual(['camera', 'microphone']);
  });

  it('список участников не показывает оверлеи', async () => {
    const owner = await streamer();
    const roomId = await createRoom(owner.token);
    media.join(roomId, { identity: `host:${owner.userId}` });
    media.join(roomId, { identity: overlayIdentity(owner.userId) });

    const response = await request(server())
      .get(`/api/rooms/${roomId}/participants`)
      .set(auth(owner.token))
      .expect(200);
    expect(response.body.map((participant: RoomParticipant) => participant.role)).toEqual(['host']);
  });

  it('стример входит видимым участником со своим именем', async () => {
    const owner = await streamer();
    const roomId = await createRoom(owner.token);

    const response = await request(server())
      .post(`/api/rooms/${roomId}/host-access`)
      .set(auth(owner.token))
      .expect(200);
    const claims = await verifier().verify(response.body.token as string);
    expect(claims.sub).toBe(`host:${owner.userId}`);
    expect(claims.name).toBe('Стример комнаты');
    expect(claims.video?.hidden).toBeFalsy();
  });

  /* ---------------------------------------------------------------- */
  /* Виджет и оверлей                                                   */
  /* ---------------------------------------------------------------- */

  it('виджет не принимает чужую комнату ни при создании, ни при правке', async () => {
    // Главный рубеж: иначе чужой идентификатор в своём виджете открывал бы
    // видео чужой приватной комнаты по собственной ссылке OBS.
    const owner = await streamer();
    const attacker = await streamer();
    const foreignRoom = await createRoom(owner.token);

    await request(server())
      .post('/api/widgets')
      .set(auth(attacker.token))
      .send({ name: 'Гости', type: 'guests', config: { roomId: foreignRoom } })
      .expect(404);

    const ownRoom = await createRoom(attacker.token);
    const widgetId = await guestsWidget(attacker.token, ownRoom);
    await request(server())
      .patch(`/api/widgets/${widgetId}`)
      .set(auth(attacker.token))
      .send({ config: { roomId: foreignRoom } })
      .expect(404);

    const widget = await harness.prisma.widget.findUniqueOrThrow({ where: { id: widgetId } });
    expect((widget.config as { roomId: string }).roomId).toBe(ownRoom);
  });

  it('оверлей получает невидимый доступ без права публикации', async () => {
    const owner = await streamer();
    const roomId = await createRoom(owner.token);
    const widgetId = await guestsWidget(owner.token, roomId);
    const obs = await overlayToken(owner.token, widgetId);

    const response = await request(server())
      .post('/api/overlay/room-access')
      .send({ token: obs.raw })
      .expect(200);

    const claims = await verifier().verify(response.body.token as string);
    expect(claims.sub).toBe(overlayIdentity(obs.id));
    expect(claims.video).toMatchObject({
      room: `room-${roomId}`,
      roomJoin: true,
      canSubscribe: true,
      canPublish: false,
      hidden: true,
    });
  });

  it('оверлей не получает доступ, когда получать нечего', async () => {
    const owner = await streamer();
    const roomId = await createRoom(owner.token);
    const access = (raw: string) =>
      request(server()).post('/api/overlay/room-access').send({ token: raw });

    // Виджет не того типа.
    const alerts = await request(server())
      .post('/api/widgets')
      .set(auth(owner.token))
      .send({ name: 'Алерты', type: 'alerts', config: {} })
      .expect(201);
    await access((await overlayToken(owner.token, alerts.body.id as string)).raw).expect(404);

    // Комната не выбрана.
    const empty = await guestsWidget(owner.token, '');
    await access((await overlayToken(owner.token, empty)).raw).expect(404);

    // Виджет выключен.
    const disabled = await guestsWidget(owner.token, roomId);
    const disabledToken = await overlayToken(owner.token, disabled);
    await request(server())
      .patch(`/api/widgets/${disabled}`)
      .set(auth(owner.token))
      .send({ isEnabled: false })
      .expect(200);
    await access(disabledToken.raw).expect(404);

    // Комнату удалили, а виджет всё ещё на неё ссылается.
    const orphan = await guestsWidget(owner.token, roomId);
    const orphanToken = await overlayToken(owner.token, orphan);
    await request(server()).delete(`/api/rooms/${roomId}`).set(auth(owner.token)).expect(204);
    await access(orphanToken.raw).expect(404);

    await access('мусор').expect(404);
  });

  it('удаление комнаты выкидывает людей и гасит ссылки', async () => {
    const owner = await streamer();
    const roomId = await createRoom(owner.token);
    const invite = await createInvite(owner.token, roomId);
    media.join(roomId, { identity: `host:${owner.userId}` });
    media.join(roomId, { identity: guestIdentity(invite.id, 'tab1') });

    await request(server()).delete(`/api/rooms/${roomId}`).set(auth(owner.token)).expect(204);

    expect(await media.listParticipants(roomId)).toEqual([]);
    await join(invite.raw).expect(404);
  });

  it('выгрузка данных включает комнаты без хэшей приглашений', async () => {
    const owner = await streamer();
    const roomId = await createRoom(owner.token);
    await createInvite(owner.token, roomId, 'Вася');

    const response = await request(server())
      .get('/api/privacy/export')
      .set(auth(owner.token))
      .expect(200);
    expect(response.body.rooms).toHaveLength(1);
    expect(response.body.rooms[0].invites[0].label).toBe('Вася');
    expect(JSON.stringify(response.body.rooms)).not.toContain('tokenHash');
  });

  /* ---------------------------------------------------------------- */
  /* Вебхук LiveKit: проверка вошедших                                  */
  /* ---------------------------------------------------------------- */

  /** Вебхук, подписанный так же, как его подписывает LiveKit. */
  async function webhook(roomId: string, identity: string, event = 'participant_joined') {
    const body = JSON.stringify({
      event,
      room: { name: `room-${roomId}` },
      participant: { identity },
    });
    const token = new AccessToken(process.env.LIVEKIT_API_KEY!, process.env.LIVEKIT_API_SECRET!);
    token.sha256 = createHash('sha256').update(body).digest('base64');
    // Supertest-запрос — thenable, и из async-функции вернулся бы уже ответ, без
    // .expect. Поэтому статус проверяется здесь.
    const response = await request(server())
      .post('/api/livekit/webhook')
      .set('Content-Type', 'application/webhook+json')
      .set('Authorization', await token.toJwt())
      .send(body);
    expect(response.status).toBe(200);
    return response;
  }

  it('выгоняет гостя, вошедшего старым токеном по отозванной ссылке', async () => {
    // Отозвать выданный токен LiveKit нельзя: revokeTokenTs в LiveKit 1.13 не
    // действует. Удалённый гость, сохранивший токен, входил обратно — теперь его
    // выгоняет проверка по вебхуку.
    const owner = await streamer();
    const roomId = await createRoom(owner.token);
    const invite = await createInvite(owner.token, roomId);
    await request(server())
      .delete(`/api/rooms/${roomId}/invites/${invite.id}`)
      .set(auth(owner.token))
      .expect(204);

    const identity = guestIdentity(invite.id, 'stale');
    media.join(roomId, { identity });
    const response = await webhook(roomId, identity);

    expect(response.body.status).toBe('removed');
    expect(await media.listParticipants(roomId)).toEqual([]);
  });

  it('гостю с выключенным микрофоном урезает права и при входе старым токеном', async () => {
    const owner = await streamer();
    const roomId = await createRoom(owner.token);
    const invite = await createInvite(owner.token, roomId);
    const first = guestIdentity(invite.id, 'tab1');
    media.join(roomId, { identity: first });
    await request(server())
      .post(`/api/rooms/${roomId}/participants/${encodeURIComponent(first)}/mute`)
      .set(auth(owner.token))
      .expect(204);

    const stale = guestIdentity(invite.id, 'stale');
    media.join(roomId, { identity: stale });
    const response = await webhook(roomId, stale);

    expect(response.body.status).toBe('restricted');
    expect(media.sources.get(stale)).toEqual(['camera']);
  });

  it('пропускает законных участников и не трогает чужие события', async () => {
    const owner = await streamer();
    const roomId = await createRoom(owner.token);
    const invite = await createInvite(owner.token, roomId);
    const widgetId = await guestsWidget(owner.token, roomId);
    const obs = await overlayToken(owner.token, widgetId);

    expect((await webhook(roomId, guestIdentity(invite.id, 'tab1'))).body.status).toBe('allowed');
    expect((await webhook(roomId, `host:${owner.userId}`)).body.status).toBe('allowed');
    expect((await webhook(roomId, overlayIdentity(obs.id))).body.status).toBe('allowed');
    expect(
      (await webhook(roomId, guestIdentity(invite.id, 'tab1'), 'track_published')).body.status,
    ).toBe('ignored');
    expect(media.removed).toEqual([]);
  });

  it('выгоняет чужого стримера, отозванный оверлей и неизвестную идентичность', async () => {
    const owner = await streamer();
    const stranger = await streamer();
    const roomId = await createRoom(owner.token);
    const widgetId = await guestsWidget(owner.token, roomId);
    const obs = await overlayToken(owner.token, widgetId);
    await request(server())
      .delete(`/api/widgets/${widgetId}/tokens/${obs.id}`)
      .set(auth(owner.token))
      .expect(204);

    for (const identity of [`host:${stranger.userId}`, overlayIdentity(obs.id), 'кто-то']) {
      expect((await webhook(roomId, identity)).body.status).toBe('removed');
    }
  });

  it('отвергает вебхук без подписи или с подписью другого тела', async () => {
    const owner = await streamer();
    const roomId = await createRoom(owner.token);
    const body = JSON.stringify({
      event: 'participant_joined',
      room: { name: `room-${roomId}` },
      participant: { identity: 'кто-то' },
    });

    await request(server())
      .post('/api/livekit/webhook')
      .set('Content-Type', 'application/webhook+json')
      .send(body)
      .expect(401);

    const token = new AccessToken(process.env.LIVEKIT_API_KEY!, process.env.LIVEKIT_API_SECRET!);
    token.sha256 = createHash('sha256').update('другое тело').digest('base64');
    await request(server())
      .post('/api/livekit/webhook')
      .set('Content-Type', 'application/webhook+json')
      .set('Authorization', await token.toJwt())
      .send(body)
      .expect(401);
    expect(media.removed).toEqual([]);
  });
  /* ---------------------------------------------------------------- */
  /* Правки по обзору этапа                                             */
  /* ---------------------------------------------------------------- */

  it('отзыв ссылки OBS выгоняет уже подключённый оверлей из комнаты', async () => {
    // Сокет оверлея гасился шиной, а подключение к LiveKit оставалось: держатель
    // утёкшей ссылки, забравший токен LiveKit, смотрел гостей и после отзыва.
    const owner = await streamer();
    const roomId = await createRoom(owner.token);
    const widgetId = await guestsWidget(owner.token, roomId);
    const obs = await overlayToken(owner.token, widgetId);
    media.join(roomId, { identity: overlayIdentity(obs.id) });

    await request(server())
      .delete(`/api/widgets/${widgetId}/tokens/${obs.id}`)
      .set(auth(owner.token))
      .expect(204);

    expect(media.removed).toEqual([overlayIdentity(obs.id)]);
  });

  it('выключение, смена комнаты и удаление виджета выгоняют его оверлеи', async () => {
    const owner = await streamer();
    const first = await createRoom(owner.token, 'Первая');
    const second = await createRoom(owner.token, 'Вторая');

    const disabled = await guestsWidget(owner.token, first);
    const disabledObs = await overlayToken(owner.token, disabled);
    await request(server())
      .patch(`/api/widgets/${disabled}`)
      .set(auth(owner.token))
      .send({ isEnabled: false })
      .expect(200);
    expect(media.removed).toEqual([overlayIdentity(disabledObs.id)]);

    const moved = await guestsWidget(owner.token, first);
    const movedObs = await overlayToken(owner.token, moved);
    // Правка без смены комнаты никого не трогает.
    await request(server())
      .patch(`/api/widgets/${moved}`)
      .set(auth(owner.token))
      .send({ config: { gap: 16 } })
      .expect(200);
    expect(media.removed).toHaveLength(1);
    await request(server())
      .patch(`/api/widgets/${moved}`)
      .set(auth(owner.token))
      .send({ config: { roomId: second } })
      .expect(200);
    expect(media.removed.at(-1)).toBe(overlayIdentity(movedObs.id));

    const deleted = await guestsWidget(owner.token, first);
    const deletedObs = await overlayToken(owner.token, deleted);
    await request(server()).delete(`/api/widgets/${deleted}`).set(auth(owner.token)).expect(204);
    expect(media.removed.at(-1)).toBe(overlayIdentity(deletedObs.id));
  });

  it('сбой проверки входа — ошибка, чтобы LiveKit повторил вебхук', async () => {
    // Раньше отвечали 200 в любом случае, и отозванный гость, вошедший в секунду
    // сбоя, оставался в комнате: LiveKit повторяет только неудачные вебхуки.
    const owner = await streamer();
    const roomId = await createRoom(owner.token);
    const invite = await createInvite(owner.token, roomId);
    await request(server())
      .delete(`/api/rooms/${roomId}/invites/${invite.id}`)
      .set(auth(owner.token))
      .expect(204);
    const identity = guestIdentity(invite.id, 'stale');
    media.join(roomId, { identity });
    media.failing.add(identity);

    const body = JSON.stringify({
      event: 'participant_joined',
      room: { name: `room-${roomId}` },
      participant: { identity },
    });
    const token = new AccessToken(process.env.LIVEKIT_API_KEY!, process.env.LIVEKIT_API_SECRET!);
    token.sha256 = createHash('sha256').update(body).digest('base64');
    await request(server())
      .post('/api/livekit/webhook')
      .set('Content-Type', 'application/webhook+json')
      .set('Authorization', await token.toJwt())
      .send(body)
      .expect(503);

    // Повтор после восстановления выгоняет.
    media.failing.clear();
    expect((await webhook(roomId, identity)).body.status).toBe('removed');
  });

  it('запрет микрофона доходит до всех вкладок, даже если одна из них сбоит', async () => {
    const owner = await streamer();
    const roomId = await createRoom(owner.token);
    const invite = await createInvite(owner.token, roomId);
    const gone = guestIdentity(invite.id, 'gone');
    const live = guestIdentity(invite.id, 'live');
    media.join(roomId, { identity: gone });
    media.join(roomId, { identity: live });
    media.failing.add(gone);

    await request(server())
      .post(`/api/rooms/${roomId}/participants/${encodeURIComponent(live)}/mute`)
      .set(auth(owner.token))
      .expect(500);

    expect(media.sources.get(live)).toEqual(['camera']);
  });

  it('гость, перезагрузивший вкладку в полной комнате, возвращается на своё место', async () => {
    const owner = await streamer();
    const roomId = await createRoom(owner.token);
    const invite = await createInvite(owner.token, roomId);
    // Прежняя вкладка этого гостя ещё числится в комнате.
    media.join(roomId, { identity: guestIdentity(invite.id, 'old-tab') });
    for (let index = 1; index < MAX_GUESTS_PER_ROOM; index += 1) {
      const other = await createInvite(owner.token, roomId, `Гость ${index}`);
      media.join(roomId, { identity: guestIdentity(other.id, 'tab') });
    }

    await join(invite.raw).expect(200);
    // А новому человеку места нет.
    const stranger = await createInvite(owner.token, roomId, 'Новенький');
    await join(stranger.raw).expect(409);
  });
});
