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
import { WidgetsService } from '../widgets/widgets.service';
import { LiveKitTokens, ROOM_MEDIA_SERVER, type RoomMediaServer } from './livekit.service';

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
    const row = await this.prisma.room.create({ data: { userId, name } });
    await this.audit.record('room.created', userId, { ...context, metadata: { roomId: row.id } });
    return toRoom(row);
  }

  /**
   * Удаление комнаты выкидывает всех, кто в ней сейчас.
   *
   * Запись в БД удаляется первой: пока идёт обход участников, новые токены по
   * приглашениям этой комнаты уже не выдаются. Выданные раньше доживут максимум
   * до срока токена — это окно входа, а не длина сессии.
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

    const participants = await this.media.listParticipants(invite.roomId);
    const guests = participants.filter((participant) => participant.role === 'guest');
    if (guests.length >= MAX_GUESTS_PER_ROOM) {
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
    });
    return { ...access, roomName: invite.room.name };
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
    if (!room) throw new NotFoundException('Нет доступа');

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

  async muteGuest(userId: string, roomId: string, identity: string): Promise<void> {
    await this.requireOwned(userId, roomId);
    this.requireGuestIdentity(identity);

    const participant = (await this.media.listParticipants(roomId)).find(
      (candidate) => candidate.identity === identity,
    );
    const audio = participant?.tracks.filter((track) => track.kind === 'audio' && !track.muted);
    for (const track of audio ?? []) {
      await this.media.muteTrack(roomId, identity, track.sid);
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
