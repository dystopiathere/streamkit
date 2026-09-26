import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Room as PrismaRoom } from '@prisma/client';
import {
  type CreatedRoomInvite,
  type GuestJoinInput,
  type GuestJoinResult,
  guestIdentity,
  hostIdentity,
  MAX_GUESTS_PER_ROOM,
  overlayIdentity,
  parseParticipantIdentity,
  type Room,
  type RoomAccess,
  type RoomInviteView,
  type RoomParticipant,
} from '@streamkit/contracts';
import { AuditService, type AuditContext } from '../../common/audit/audit.service';
import { CryptoService } from '../../common/crypto/crypto.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AppConfig } from '../../config/app-config.service';
import { ROOM_GUEST_TERMS } from '../privacy/legal-documents';
import { BillingService, SubscriptionRequiredException } from '../billing/billing.service';
import { ReferralsService } from '../billing/referrals.service';
import { WidgetsService } from '../widgets/widgets.service';
import {
  LiveKitTokens,
  ROOM_MEDIA_SERVER,
  roomIdFromLivekitName,
  type RoomMediaServer,
} from './livekit.service';

/**
 * Приватные комнаты: владение, приглашения и выдача доступа.
 *
 * Медиа сюда не заходит вовсе — только решение, кому и с какими правами выдать
 * короткий токен LiveKit. Поэтому вся безопасность комнат живёт в этом файле:
 * чужая комната — 404, отозванная ссылка неотличима от несуществующей, гостя
 * можно удалить только гостя.
 */
@Injectable()
export class RoomsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly audit: AuditService,
    private readonly config: AppConfig,
    private readonly tokens: LiveKitTokens,
    private readonly widgets: WidgetsService,
    private readonly billing: BillingService,
    private readonly referrals: ReferralsService,
    @Inject(ROOM_MEDIA_SERVER) private readonly media: RoomMediaServer,
  ) {}

  async list(userId: string): Promise<Room[]> {
    const rows = await this.prisma.room.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map(toRoom);
  }

  async get(userId: string, roomId: string): Promise<Room> {
    return toRoom(await this.requireOwned(userId, roomId));
  }

  async create(userId: string, name: string, context: AuditContext = {}): Promise<Room> {
    await this.billing.requireRoomsAccess(userId);
    const row = await this.prisma.room.create({ data: { userId, name } });
    await this.audit.record('room.created', userId, { ...context, metadata: { roomId: row.id } });
    return toRoom(row);
  }

  /**
   * Удаление комнаты выкидывает всех, кто в ней сейчас.
   *
   * Запись в БД удаляется первой: пока идёт обход участников, новые токены по
   * приглашениям этой комнаты уже не выдаются, а вошедшего по старому токену
   * выгонит проверка по вебхуку — комнаты для него уже нет.
   */
  async remove(userId: string, roomId: string, context: AuditContext = {}): Promise<void> {
    await this.requireOwned(userId, roomId);
    await this.prisma.room.delete({ where: { id: roomId } });
    await this.audit.record('room.deleted', userId, { ...context, metadata: { roomId } });

    const participants = await this.media.listParticipants(roomId).catch(() => []);
    await Promise.all(
      participants
        .filter((participant) => participant.role !== 'overlay')
        .map((participant) =>
          this.media.removeParticipant(roomId, participant.identity).catch(() => undefined),
        ),
    );
  }

  /* ---------------------------------------------------------------- */
  /* Приглашения                                                        */
  /* ---------------------------------------------------------------- */

  async listInvites(userId: string, roomId: string): Promise<RoomInviteView[]> {
    await this.requireOwned(userId, roomId);
    const rows = await this.prisma.roomInvite.findMany({
      where: { roomId, revokedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((row) => ({
      id: row.id,
      label: row.label,
      createdAt: row.createdAt.toISOString(),
      lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
      revokedAt: null,
      micBlocked: row.micBlockedAt !== null,
    }));
  }

  /**
   * Ссылка возвращается ОДИН раз: в БД лежит только хэш.
   *
   * Токен — во фрагменте адреса (`#`), а не в пути или query. Фрагмент браузер
   * не отправляет на сервер, и ссылка не оседает в журналах nginx и прокси.
   */
  async createInvite(
    userId: string,
    roomId: string,
    label: string,
    context: AuditContext = {},
  ): Promise<CreatedRoomInvite> {
    await this.requireOwned(userId, roomId);

    const raw = this.crypto.generateToken(32);
    const created = await this.prisma.roomInvite.create({
      data: { roomId, label, tokenHash: this.crypto.hashToken(raw) },
      select: { id: true },
    });
    await this.audit.record('room.invite.created', userId, {
      ...context,
      metadata: { roomId, inviteId: created.id },
    });

    const base = this.config.webBaseUrl.replace(/\/+$/, '');
    return { id: created.id, url: `${base}/join#${raw}` };
  }

  /** Отзыв ссылки выкидывает из комнаты и тех, кто уже вошёл по ней. */
  async revokeInvite(
    userId: string,
    roomId: string,
    inviteId: string,
    context: AuditContext = {},
  ): Promise<void> {
    await this.requireOwned(userId, roomId);
    const updated = await this.prisma.roomInvite.updateMany({
      where: { id: inviteId, roomId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (updated.count === 0) throw new NotFoundException('Приглашение не найдено');

    await this.audit.record('room.invite.revoked', userId, {
      ...context,
      metadata: { roomId, inviteId },
    });
    await this.removeGuestsOfInvite(roomId, inviteId);
  }

  /* ---------------------------------------------------------------- */
  /* Доступ                                                             */
  /* ---------------------------------------------------------------- */

  async hostAccess(userId: string, roomId: string): Promise<RoomAccess> {
    await this.requireOwned(userId, roomId);
    await this.billing.requireRoomsAccess(userId);
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { displayName: true },
    });
    return this.tokens.issue(roomId, {
      role: 'host',
      identity: hostIdentity(userId),
      name: user.displayName,
    });
  }

  /**
   * Вход гостя по ссылке.
   *
   * Отозванное и несуществующее приглашение отвечают одинаково: по разнице
   * ответов ссылки перебирались бы. Проверка заполненности — по живому списку
   * участников, а не по счётчику в БД: гость, закрывший вкладку, из комнаты уже
   * вышел, а в нашей базе об этом ничего нет. Гонка двух одновременных входов
   * на последнее место даёт на одного гостя больше — это не повод держать
   * блокировку на время запроса к медиасерверу.
   */
  async guestJoin(input: GuestJoinInput, context: AuditContext = {}): Promise<GuestJoinResult> {
    const invite = await this.prisma.roomInvite.findUnique({
      where: { tokenHash: this.crypto.hashToken(input.token) },
      include: { room: true },
    });
    if (!invite || invite.revokedAt) throw new NotFoundException('Приглашение недействительно');
    // Проверяется до записи согласия: гостю, которого всё равно не впустят,
    // соглашаться не на что. Ответ 402 гость видит как «комната стримера сейчас
    // недоступна» — почему именно, ему знать незачем.
    if (!(await this.billing.roomsAccess(invite.room.userId))) {
      throw new SubscriptionRequiredException();
    }

    const participants = await this.media.listParticipants(invite.roomId);
    // Место занимает ссылка, а не вкладка, и своя ссылка входящему места не
    // отнимает. Гость, перезагрузивший вкладку, ещё числится в комнате прежней
    // идентичностью, пока LiveKit не заметит уход, — и в полной комнате получал
    // «нет мест» на собственное место. Вкладок одной ссылки больше одной не
    // бывает надолго, а общий потолок участников держит сам LiveKit.
    const seats = new Set(
      participants
        .filter((participant) => participant.role === 'guest')
        .map((participant) => parseParticipantIdentity(participant.identity)?.id)
        .filter((inviteId) => inviteId !== invite.id),
    );
    if (seats.size >= MAX_GUESTS_PER_ROOM) {
      throw new ConflictException('В комнате нет свободных мест');
    }

    // Согласие пишется ДО выдачи доступа: изображение и голос начнут
    // передаваться в ту же секунду, как гость подключится.
    await this.prisma.guestConsent.create({
      data: {
        inviteId: invite.id,
        documentVersion: ROOM_GUEST_TERMS.version,
        ipHash: context.ipHash ?? null,
        userAgent: context.userAgent ?? null,
      },
    });
    await this.prisma.roomInvite.update({
      where: { id: invite.id },
      data: { lastUsedAt: new Date() },
    });
    await this.audit.record('room.guest.joined', invite.room.userId, {
      ...context,
      metadata: { roomId: invite.roomId, inviteId: invite.id },
    });

    const access = await this.tokens.issue(invite.roomId, {
      role: 'guest',
      identity: guestIdentity(invite.id, this.crypto.generateToken(9)),
      name: input.displayName,
      microphone: invite.micBlockedAt === null,
    });
    return {
      ...access,
      roomName: invite.room.name,
      microphoneAllowed: invite.micBlockedAt === null,
      // Ссылка «создайте свою комнату» у гостя ведёт на регистрацию с
      // промокодом стримера. Не вышло выдать код — гость увидит ссылку без
      // него, а вход в комнату от этого не зависит.
      hostReferralCode: await this.referrals.ensureCode(invite.room.userId).catch(() => null),
    };
  }

  /**
   * Доступ для браузер-сорса OBS: невидимый подписчик комнаты.
   *
   * Владелец комнаты сверяется с владельцем виджета ЕЩЁ РАЗ, хотя сохранение
   * виджета это уже проверило. Комнату могли удалить и завести заново, виджет
   * могли переписать в обход сервиса, а цена ошибки здесь — видео чужой
   * приватной комнаты на публичной странице.
   */
  async overlayAccess(rawOverlayToken: string): Promise<RoomAccess> {
    const resolved = await this.widgets.resolveOverlayToken(rawOverlayToken);
    if (!resolved || !resolved.isEnabled || resolved.widget.type !== 'guests') {
      throw new NotFoundException('Нет доступа');
    }

    const roomId = resolved.widget.config.roomId;
    if (!roomId) throw new NotFoundException('Нет доступа');
    const room = await this.prisma.room.findFirst({
      where: { id: roomId, userId: resolved.userId },
      select: { id: true },
    });
    // Истёкший тариф — тот же 404, что и любой недоступный доступ: оверлей
    // открыт по публичной ссылке, и рассказывать ей о тарифе владельца незачем.
    if (!room || !(await this.billing.roomsAccess(resolved.userId))) {
      throw new NotFoundException('Нет доступа');
    }

    await this.widgets.touchOverlayToken(resolved.tokenId);
    return this.tokens.issue(room.id, {
      role: 'overlay',
      identity: overlayIdentity(resolved.tokenId),
    });
  }

  /* ---------------------------------------------------------------- */
  /* Участники                                                          */
  /* ---------------------------------------------------------------- */

  async participants(userId: string, roomId: string): Promise<RoomParticipant[]> {
    await this.requireOwned(userId, roomId);
    const participants = await this.media.listParticipants(roomId);
    // Оверлеи стримеру не показываем: это его собственные браузер-сорсы.
    return participants.filter((participant) => participant.role !== 'overlay');
  }

  /**
   * Удалить гостя из комнаты. С `revoke` — ещё и отозвать его ссылку, иначе он
   * просто откроет её снова.
   */
  async removeGuest(
    userId: string,
    roomId: string,
    identity: string,
    revoke: boolean,
    context: AuditContext = {},
  ): Promise<void> {
    await this.requireOwned(userId, roomId);
    const inviteId = this.requireGuestIdentity(identity);

    if (revoke) {
      await this.prisma.roomInvite.updateMany({
        where: { id: inviteId, roomId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await this.removeGuestsOfInvite(roomId, inviteId);
    } else {
      await this.media.removeParticipant(roomId, identity);
    }

    await this.audit.record('room.guest.removed', userId, {
      ...context,
      metadata: { roomId, inviteId, revoked: revoke },
    });
  }

  /**
   * Выключить гостю микрофон — так, чтобы он не включил его обратно сам.
   *
   * Раньше здесь было только `mutePublishedTrack`: флаг «заглушено» на дорожке,
   * который гость снимает той же кнопкой микрофона. Теперь у гостя отнимается
   * ПРАВО публиковать микрофон. Запрет пишется на приглашение: новый токен после
   * перезагрузки вкладки выдаётся уже без микрофона, а права сразу меняются у
   * всех вкладок, открытых по этой ссылке.
   */
  async blockMicrophone(userId: string, roomId: string, identity: string): Promise<void> {
    await this.setMicrophoneBlocked(userId, roomId, identity, true);
  }

  /** Вернуть право на микрофон. Включает его гость сам — насильно звук не открываем. */
  async allowMicrophone(userId: string, roomId: string, identity: string): Promise<void> {
    await this.setMicrophoneBlocked(userId, roomId, identity, false);
  }

  private async setMicrophoneBlocked(
    userId: string,
    roomId: string,
    identity: string,
    blocked: boolean,
  ): Promise<void> {
    await this.requireOwned(userId, roomId);
    const inviteId = this.requireGuestIdentity(identity);

    const updated = await this.prisma.roomInvite.updateMany({
      where: { id: inviteId, roomId },
      data: { micBlockedAt: blocked ? new Date() : null },
    });
    if (updated.count === 0) throw new NotFoundException('Гость не найден');

    const tabs = (await this.media.listParticipants(roomId)).filter(
      (participant) =>
        participant.role === 'guest' &&
        parseParticipantIdentity(participant.identity)?.id === inviteId,
    );
    // Вкладки обрабатываются независимо: сбой на одной не должен оставить
    // микрофон остальным. Раньше цикл обрывался на первой же ошибке — чаще всего
    // на вкладке, которую гость только что перезагрузил.
    const results = await Promise.allSettled(
      tabs.map(async (tab) => {
        if (blocked) {
          // Сначала тишина, потом права: смена прав доходит до клиента не
          // мгновенно, а звук в эфире должен пропасть сразу после нажатия.
          for (const track of tab.tracks.filter(
            (candidate) => candidate.kind === 'audio' && !candidate.muted,
          )) {
            await this.media.muteTrack(roomId, tab.identity, track.sid);
          }
        }
        await this.media.setPublishSources(
          roomId,
          tab.identity,
          blocked ? ['camera'] : ['camera', 'microphone'],
        );
      }),
    );
    const failed = results.find((result) => result.status === 'rejected');
    if (failed) throw failed.reason;
  }

  /**
   * Проверка каждого вошедшего — по вебхуку LiveKit `participant_joined`.
   *
   * Токен LiveKit подписан секретом сервера, и отозвать выданный токен нельзя.
   * Опция `revokeTokenTs` у удаления участника в LiveKit 1.13 не действует —
   * это проверено на сигнальном соединении: удалённый участник входил обратно
   * тем же токеном и в секундах, и в миллисекундах, и со значением по умолчанию.
   * Поэтому о каждом входе LiveKit сообщает нам, а мы сверяем вошедшего с тем,
   * что в базе СЕЙЧАС, и выгоняем того, чей доступ уже отозван.
   *
   * Отсюда же закрыт второй обход: гость, которому стример выключил микрофон,
   * вошёл бы старым токеном с правом на микрофон. Права ему урезаются здесь же.
   *
   * @returns что сделано — для журнала и тестов.
   */
  async enforceJoin(
    roomName: string,
    identity: string,
  ): Promise<'allowed' | 'removed' | 'restricted' | 'ignored'> {
    const roomId = roomIdFromLivekitName(roomName);
    if (!roomId) return 'ignored';

    const remove = async (): Promise<'removed'> => {
      await this.media.removeParticipant(roomId, identity);
      return 'removed';
    };

    const parsed = parseParticipantIdentity(identity);
    const room = await this.prisma.room.findUnique({
      where: { id: roomId },
      select: { userId: true },
    });
    // Токен с неизвестной идентичностью мы не выпускали, а комнаты уже нет.
    if (!parsed || !room) return remove();
    // Токен, выданный до конца оплаченного периода, живёт ещё пять минут.
    // Вошедшего по нему после конца выгоняем так же, как отозванного.
    if (!(await this.billing.roomsAccess(room.userId))) return remove();

    switch (parsed.role) {
      case 'host':
        return parsed.id === room.userId ? 'allowed' : remove();

      case 'guest': {
        const invite = await this.prisma.roomInvite.findFirst({
          where: { id: parsed.id, roomId },
          select: { revokedAt: true, micBlockedAt: true },
        });
        if (!invite || invite.revokedAt) return remove();
        if (invite.micBlockedAt) {
          await this.media.setPublishSources(roomId, identity, ['camera']);
          return 'restricted';
        }
        return 'allowed';
      }

      case 'overlay': {
        const token = await this.prisma.overlayToken.findUnique({
          where: { id: parsed.id },
          include: { widget: true },
        });
        const widget = token?.widget;
        const valid =
          token &&
          !token.revokedAt &&
          widget?.type === 'GUESTS' &&
          widget.isEnabled &&
          widget.userId === room.userId &&
          (widget.config as { roomId?: string }).roomId === roomId;
        return valid ? 'allowed' : remove();
      }
    }
  }

  /* ---------------------------------------------------------------- */

  /**
   * Действия над участниками — только над гостями.
   *
   * Стримера из собственной комнаты удалять незачем, а оверлей — это его же
   * браузер-сорс: «удалить» его означало бы молча погасить гостей в эфире.
   */
  private requireGuestIdentity(identity: string): string {
    const parsed = parseParticipantIdentity(identity);
    if (parsed?.role !== 'guest') throw new BadRequestException('Удалять можно только гостей');
    return parsed.id;
  }

  private async removeGuestsOfInvite(roomId: string, inviteId: string): Promise<void> {
    const participants = await this.media.listParticipants(roomId).catch(() => []);
    await Promise.all(
      participants
        .filter((participant) => parseParticipantIdentity(participant.identity)?.id === inviteId)
        .filter((participant) => participant.role === 'guest')
        .map((participant) => this.media.removeParticipant(roomId, participant.identity)),
    );
  }

  /** Чужая комната — 404, а не 403: по коду ответа перебирались бы идентификаторы. */
  private async requireOwned(userId: string, roomId: string): Promise<PrismaRoom> {
    const room = await this.prisma.room.findFirst({ where: { id: roomId, userId } });
    if (!room) throw new NotFoundException('Комната не найдена');
    return room;
  }
}

function toRoom(row: PrismaRoom): Room {
  return { id: row.id, name: row.name, createdAt: row.createdAt.toISOString() };
}
