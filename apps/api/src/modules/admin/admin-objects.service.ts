import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  type AdminAuditEntry,
  type AdminAuditQuery,
  type AdminChannel,
  type AdminChannelListQuery,
  type AdminInvite,
  type AdminOverlayToken,
  type AdminPayment,
  type AdminPaymentListQuery,
  type AdminRoom,
  type AdminRoomListQuery,
  type AdminWidget,
  type AdminWidgetListQuery,
  type Page,
  type PaymentView,
} from '@streamkit/contracts';
import { AuditService, type AuditContext } from '../../common/audit/audit.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { BillingService, toPaymentView } from '../billing/billing.service';
import {
  ANALYTICS_PLATFORMS,
  toContractPlatform,
  toContractSyncState,
  toPrismaPlatform,
  toPrismaSyncState,
} from '../integrations/platform.mappers';
import { RoomsService } from '../rooms/rooms.service';
import { toContractWidgetType, toPrismaWidgetType } from '../widgets/widget.mappers';
import { WidgetsService } from '../widgets/widgets.service';
import { iso, pageArgs, toPage } from './admin.mappers';

const PAYMENT_STATUS_TO_PRISMA = {
  pending: 'PENDING',
  succeeded: 'SUCCEEDED',
  canceled: 'CANCELED',
} as const;

/**
 * Виджеты, ссылки, комнаты, площадки, платежи и журнал — списки и действия.
 *
 * Изменения идут через сервисы владельца от его имени: отзыв ссылки из
 * админки обязан так же оборвать сокет оверлея и выгнать его из комнаты, как
 * отзыв из дашборда. Второй путь к той же записи рано или поздно забыл бы шаг.
 */
@Injectable()
export class AdminObjectsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly widgets: WidgetsService,
    private readonly rooms: RoomsService,
    private readonly billing: BillingService,
    private readonly audit: AuditService,
  ) {}

  /* ---------------------------------------------------------------- */
  /* Виджеты и ссылки OBS                                               */
  /* ---------------------------------------------------------------- */

  async listWidgets(query: AdminWidgetListQuery): Promise<Page<AdminWidget>> {
    const rows = await this.prisma.widget.findMany({
      where: {
        ...(query.userId ? { userId: query.userId } : {}),
        ...(query.type ? { type: toPrismaWidgetType(query.type) } : {}),
        ...(query.enabled ? { isEnabled: query.enabled === 'true' } : {}),
      },
      ...pageArgs(query.limit, query.cursor),
      include: {
        user: { select: { email: true } },
        tokens: { where: { revokedAt: null }, select: { lastSeenAt: true } },
      },
    });
    const { rows: page, nextCursor } = toPage(rows, query.limit);
    return {
      items: page.map((row) => ({
        id: row.id,
        userId: row.userId,
        ownerEmail: row.user.email,
        type: toContractWidgetType(row.type),
        name: row.name,
        isEnabled: row.isEnabled,
        createdAt: row.createdAt.toISOString(),
        activeTokenCount: row.tokens.length,
        lastSeenAt: latestIso(row.tokens.map((token) => token.lastSeenAt)),
      })),
      nextCursor,
    };
  }

  async setWidgetEnabled(
    widgetId: string,
    isEnabled: boolean,
    context: AuditContext,
  ): Promise<void> {
    const ownerId = await this.widgetOwner(widgetId);
    await this.widgets.update(ownerId, widgetId, { isEnabled });
    await this.audit.record(isEnabled ? 'admin.widget.enabled' : 'admin.widget.disabled', ownerId, {
      ...context,
      metadata: { widgetId },
    });
  }

  async listTokens(widgetId: string): Promise<AdminOverlayToken[]> {
    await this.widgetOwner(widgetId);
    const rows = await this.prisma.overlayToken.findMany({
      where: { widgetId },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((row) => ({
      id: row.id,
      label: row.label,
      createdAt: row.createdAt.toISOString(),
      lastSeenAt: iso(row.lastSeenAt),
      revokedAt: iso(row.revokedAt),
    }));
  }

  async revokeToken(widgetId: string, tokenId: string, context: AuditContext): Promise<void> {
    const ownerId = await this.widgetOwner(widgetId);
    await this.widgets.revokeOverlayToken(ownerId, widgetId, tokenId, context);
  }

  async revokeAllTokens(widgetId: string, context: AuditContext): Promise<number> {
    const ownerId = await this.widgetOwner(widgetId);
    const tokens = await this.prisma.overlayToken.findMany({
      where: { widgetId, revokedAt: null },
      select: { id: true },
    });
    for (const token of tokens) {
      await this.widgets
        .revokeOverlayToken(ownerId, widgetId, token.id, context)
        // Отозвана параллельно — цель достигнута.
        .catch((error: unknown) => {
          if (!(error instanceof NotFoundException)) throw error;
        });
    }
    return tokens.length;
  }

  private async widgetOwner(widgetId: string): Promise<string> {
    const widget = await this.prisma.widget.findUnique({
      where: { id: widgetId },
      select: { userId: true },
    });
    if (!widget) throw new NotFoundException('Виджет не найден');
    return widget.userId;
  }

  /* ---------------------------------------------------------------- */
  /* Комнаты                                                            */
  /* ---------------------------------------------------------------- */

  async listRooms(query: AdminRoomListQuery): Promise<Page<AdminRoom>> {
    const rows = await this.prisma.room.findMany({
      where: query.userId ? { userId: query.userId } : {},
      ...pageArgs(query.limit, query.cursor),
      include: {
        user: { select: { email: true } },
        _count: { select: { invites: { where: { revokedAt: null } } } },
      },
    });
    const { rows: page, nextCursor } = toPage(rows, query.limit);
    return {
      items: page.map((row) => ({
        id: row.id,
        userId: row.userId,
        ownerEmail: row.user.email,
        name: row.name,
        createdAt: row.createdAt.toISOString(),
        activeInviteCount: row._count.invites,
      })),
      nextCursor,
    };
  }

  /**
   * Приглашения комнаты. Подпись приглашения задаёт стример — это его пометка
   * («для Васи»), а не имя гостя: гость представляется при входе, и его имя не
   * хранится нигде.
   */
  async listInvites(roomId: string): Promise<AdminInvite[]> {
    await this.roomOwner(roomId);
    const rows = await this.prisma.roomInvite.findMany({
      where: { roomId },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((row) => ({
      id: row.id,
      label: row.label,
      createdAt: row.createdAt.toISOString(),
      lastUsedAt: iso(row.lastUsedAt),
      revokedAt: iso(row.revokedAt),
    }));
  }

  async revokeInvite(roomId: string, inviteId: string, context: AuditContext): Promise<void> {
    const ownerId = await this.roomOwner(roomId);
    await this.rooms.revokeInvite(ownerId, roomId, inviteId, context);
  }

  async removeRoom(roomId: string, context: AuditContext): Promise<void> {
    const ownerId = await this.roomOwner(roomId);
    await this.rooms.remove(ownerId, roomId, context);
  }

  private async roomOwner(roomId: string): Promise<string> {
    const room = await this.prisma.room.findUnique({
      where: { id: roomId },
      select: { userId: true },
    });
    if (!room) throw new NotFoundException('Комната не найдена');
    return room.userId;
  }

  /* ---------------------------------------------------------------- */
  /* Площадки                                                           */
  /* ---------------------------------------------------------------- */

  async listChannels(query: AdminChannelListQuery): Promise<Page<AdminChannel>> {
    const rows = await this.prisma.channel.findMany({
      where: {
        platform: query.platform ? toPrismaPlatform(query.platform) : { in: ANALYTICS_PLATFORMS },
        ...(query.userId ? { userId: query.userId } : {}),
        ...(query.syncState ? { syncState: toPrismaSyncState(query.syncState) } : {}),
      },
      ...pageArgs(query.limit, query.cursor),
      include: { user: { select: { email: true } } },
    });
    const { rows: page, nextCursor } = toPage(rows, query.limit);
    return {
      items: page.map((row) => ({
        id: row.id,
        userId: row.userId,
        ownerEmail: row.user.email,
        platform: toContractPlatform(row.platform),
        login: row.login,
        displayName: row.displayName,
        isEnabled: row.isEnabled,
        syncState: toContractSyncState(row.syncState),
        syncError: row.syncError,
        syncAttempts: row.syncAttempts,
        lastSyncedAt: iso(row.lastSyncedAt),
        nextAttemptAt: iso(row.nextAttemptAt),
      })),
      nextCursor,
    };
  }

  /**
   * Опросить канал на ближайшем такте.
   *
   * Счётчик неудач обнуляется, пауза снимается. Канал с отозванным доступом
   * так не оживить — там нужен новый вход стримера, и опрос снова упрётся в
   * тот же отказ.
   */
  async resyncChannel(channelId: string, context: AuditContext): Promise<void> {
    const channel = await this.prisma.channel.findUnique({ where: { id: channelId } });
    if (!channel) throw new NotFoundException('Канал не найден');
    if (channel.syncState === 'AUTH_EXPIRED') {
      throw new ConflictException('Доступ к каналу отозван: стример должен подключить его заново');
    }
    await this.prisma.channel.update({
      where: { id: channelId },
      data: { nextAttemptAt: null, syncAttempts: 0 },
    });
    await this.audit.record('admin.channel.resync', channel.userId, {
      ...context,
      metadata: { channelId },
    });
  }

  /* ---------------------------------------------------------------- */
  /* Платежи                                                            */
  /* ---------------------------------------------------------------- */

  async listPayments(query: AdminPaymentListQuery): Promise<Page<AdminPayment>> {
    const rows = await this.prisma.payment.findMany({
      where: {
        ...(query.userId ? { userId: query.userId } : {}),
        ...(query.status ? { status: PAYMENT_STATUS_TO_PRISMA[query.status] } : {}),
      },
      ...pageArgs(query.limit, query.cursor),
      include: { user: { select: { email: true } } },
    });
    const { rows: page, nextCursor } = toPage(rows, query.limit);
    return {
      items: page.map((row) => ({
        ...toPaymentView(row),
        userId: row.userId,
        ownerEmail: row.user.email,
        cancellationReason: row.cancellationReason,
      })),
      nextCursor,
    };
  }

  /** Переспросить незакрытый платёж у ЮKassa — когда уведомление не дошло. */
  async syncPayment(paymentId: string, context: AuditContext): Promise<PaymentView> {
    const row = await this.prisma.payment.findUnique({ where: { id: paymentId } });
    if (!row) throw new NotFoundException('Платёж не найден');
    if (row.status !== 'PENDING') {
      throw new ConflictException('Платёж уже закрыт');
    }
    if (!row.providerPaymentId) {
      throw new BadRequestException('ЮKassa ещё не выдала идентификатор платежа');
    }
    await this.billing.syncPayment(row);
    await this.audit.record('admin.payment.synced', row.userId, {
      ...context,
      metadata: { paymentId },
    });
    const updated = await this.prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
    return toPaymentView(updated);
  }

  /* ---------------------------------------------------------------- */
  /* Журнал                                                             */
  /* ---------------------------------------------------------------- */

  async listAudit(query: AdminAuditQuery): Promise<Page<AdminAuditEntry>> {
    const where: Prisma.AuditLogWhereInput = {
      ...(query.action ? { action: { startsWith: query.action } } : {}),
      ...(query.userId ? { userId: query.userId } : {}),
      ...(query.actorId ? { actorId: query.actorId } : {}),
      ...(query.from || query.to
        ? {
            createdAt: {
              ...(query.from ? { gte: new Date(query.from) } : {}),
              ...(query.to ? { lt: new Date(query.to) } : {}),
            },
          }
        : {}),
    };
    const rows = await this.prisma.auditLog.findMany({
      where,
      ...pageArgs(query.limit, query.cursor),
      include: {
        user: { select: { email: true } },
        actor: { select: { email: true } },
      },
    });
    const { rows: page, nextCursor } = toPage(rows, query.limit);
    return {
      items: page.map((row) => ({
        id: row.id,
        action: row.action,
        userId: row.userId,
        userEmail: row.user?.email ?? null,
        actorId: row.actorId,
        actorEmail: row.actor?.email ?? null,
        metadata: isRecord(row.metadata) ? row.metadata : null,
        createdAt: row.createdAt.toISOString(),
      })),
      nextCursor,
    };
  }
}

function latestIso(dates: Array<Date | null>): string | null {
  const times = dates.filter((date): date is Date => date !== null).map((date) => date.getTime());
  return times.length > 0 ? new Date(Math.max(...times)).toISOString() : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
