import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  type AdminUserDetail,
  type AdminUserListQuery,
  type AdminUserRow,
  GRACE_DAYS,
  type Page,
  type SubscriptionView,
} from '@streamkit/contracts';
import { AuditService, type AuditContext } from '../../common/audit/audit.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TokenService } from '../auth/token.service';
import { DAY_MS, subscriptionStatus } from '../billing/billing-periods';
import { BillingService, toPaymentView } from '../billing/billing.service';
import { toContractProvider } from '../events/event.mappers';
import {
  ANALYTICS_PLATFORMS,
  toContractPlatform,
  toContractSyncState,
} from '../integrations/platform.mappers';
import { toContractWidgetType } from '../widgets/widget.mappers';
import {
  escapeLike,
  iso,
  pageArgs,
  toContractRole,
  toContractStatus,
  toPage,
  toPrismaRole,
  toPrismaStatus,
} from './admin.mappers';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Пользователи в админке: список и карточка.
 *
 * В карточке нет ни одного поля событий, кроме их числа: имена и сообщения
 * донатеров — данные стримера, платформа их для себя не читает.
 */
@Injectable()
export class AdminUsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokenService,
    private readonly billing: BillingService,
    private readonly audit: AuditService,
  ) {}

  async list(query: AdminUserListQuery, now = new Date()): Promise<Page<AdminUserRow>> {
    const rows = await this.prisma.user.findMany({
      where: this.listFilter(query, now),
      ...pageArgs(query.limit, query.cursor),
      include: {
        subscription: { select: { currentPeriodEnd: true, autoRenew: true } },
        _count: { select: { widgets: true } },
        refreshTokens: {
          where: { scope: 'USER' },
          orderBy: { lastUsedAt: 'desc' },
          take: 1,
          select: { lastUsedAt: true },
        },
      },
    });

    const { rows: page, nextCursor } = toPage(rows, query.limit);
    return {
      items: page.map((row) => ({
        id: row.id,
        email: row.email,
        displayName: row.displayName,
        role: toContractRole(row.role),
        status: toContractStatus(row.status),
        isTotpEnabled: row.isTotpEnabled,
        createdAt: row.createdAt.toISOString(),
        lastSeenAt: iso(row.refreshTokens[0]?.lastUsedAt),
        subscriptionStatus: subscriptionStatus(row.subscription, now),
        widgetCount: row._count.widgets,
      })),
      nextCursor,
    };
  }

  /** Карточка пользователя. Просмотр пишется в журнал: это доступ к чужим данным. */
  async detail(userId: string, context: AuditContext): Promise<AdminUserDetail> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        consents: { orderBy: { grantedAt: 'desc' } },
        widgets: {
          orderBy: { createdAt: 'asc' },
          include: { tokens: { orderBy: { createdAt: 'desc' } } },
        },
        rooms: {
          orderBy: { createdAt: 'asc' },
          include: { _count: { select: { invites: { where: { revokedAt: null } } } } },
        },
        channels: {
          where: { platform: { in: ANALYTICS_PLATFORMS } },
          orderBy: { createdAt: 'asc' },
        },
        donationSources: { orderBy: { createdAt: 'asc' } },
        payments: { orderBy: { createdAt: 'desc' }, take: 50 },
        _count: { select: { alertEvents: true } },
      },
    });
    if (!user) throw new NotFoundException('Пользователь не найден');

    await this.audit.record('admin.user.viewed', userId, context);

    const [sessions, subscription] = await Promise.all([
      this.tokens.listAllSessions(userId),
      this.billing.subscription(userId),
    ]);

    return {
      user: {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        role: toContractRole(user.role),
        status: toContractStatus(user.status),
        isTotpEnabled: user.isTotpEnabled,
        createdAt: user.createdAt.toISOString(),
        lastSeenAt:
          sessions
            .filter((session) => session.scope === 'user')
            .map((session) => session.lastUsedAt)
            .sort()
            .at(-1) ?? null,
        anonymizedAt: iso(user.anonymizedAt),
      },
      sessions,
      consents: user.consents.map((consent) => ({
        document: consent.document,
        documentVersion: consent.documentVersion,
        grantedAt: consent.grantedAt.toISOString(),
        revokedAt: iso(consent.revokedAt),
      })),
      subscription,
      payments: user.payments.map(toPaymentView),
      widgets: user.widgets.map((widget) => {
        const active = widget.tokens.filter((token) => !token.revokedAt);
        return {
          id: widget.id,
          type: toContractWidgetType(widget.type),
          name: widget.name,
          isEnabled: widget.isEnabled,
          createdAt: widget.createdAt.toISOString(),
          activeTokenCount: active.length,
          lastSeenAt: latest(active.map((token) => token.lastSeenAt)),
          tokens: widget.tokens.map((token) => ({
            id: token.id,
            label: token.label,
            createdAt: token.createdAt.toISOString(),
            lastSeenAt: iso(token.lastSeenAt),
            revokedAt: iso(token.revokedAt),
          })),
        };
      }),
      rooms: user.rooms.map((room) => ({
        id: room.id,
        name: room.name,
        createdAt: room.createdAt.toISOString(),
        activeInviteCount: room._count.invites,
      })),
      channels: user.channels.map((channel) => ({
        id: channel.id,
        platform: toContractPlatform(channel.platform),
        login: channel.login,
        displayName: channel.displayName,
        isEnabled: channel.isEnabled,
        syncState: toContractSyncState(channel.syncState),
        syncError: channel.syncError,
        syncAttempts: channel.syncAttempts,
        lastSyncedAt: iso(channel.lastSyncedAt),
        nextAttemptAt: iso(channel.nextAttemptAt),
      })),
      donationSources: user.donationSources.map((source) => ({
        provider: toContractProvider(source.provider),
        isEnabled: source.isEnabled,
        disabledReason: source.disabledReason,
        lastEventAt: iso(source.lastEventAt),
      })),
      eventCount: user._count.alertEvents,
    };
  }

  /** Бесплатные дни — только живому аккаунту: заблокированному они ничего не дают. */
  async extendSubscription(
    userId: string,
    days: number,
    context: AuditContext,
  ): Promise<SubscriptionView> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { status: true },
    });
    if (!user) throw new NotFoundException('Пользователь не найден');
    if (user.status !== 'ACTIVE') throw new ConflictException('Аккаунт не активен');
    return this.billing.extend(userId, days, context);
  }

  private listFilter(query: AdminUserListQuery, now: Date): Prisma.UserWhereInput {
    const and: Prisma.UserWhereInput[] = [];

    if (query.q) {
      const q = query.q;
      const pattern = escapeLike(q);
      and.push({
        OR: [
          { email: { contains: pattern, mode: 'insensitive' } },
          { displayName: { contains: pattern, mode: 'insensitive' } },
          ...(UUID_PATTERN.test(q) ? [{ id: q }] : []),
        ],
      });
    }
    if (query.status) and.push({ status: toPrismaStatus(query.status) });
    if (query.role) and.push({ role: toPrismaRole(query.role) });

    // Те же границы, что у `subscriptionStatus`, но в запросе: фильтровать
    // страницу после выборки значило бы отдавать неполные страницы.
    const graceStart = new Date(now.getTime() - GRACE_DAYS * DAY_MS);
    switch (query.subscription) {
      case 'active':
        and.push({ subscription: { currentPeriodEnd: { gt: now } } });
        break;
      case 'grace':
        and.push({
          subscription: { autoRenew: true, currentPeriodEnd: { lte: now, gt: graceStart } },
        });
        break;
      case 'expired':
        and.push({
          subscription: {
            currentPeriodEnd: { lte: now },
            OR: [{ autoRenew: false }, { currentPeriodEnd: { lte: graceStart } }],
          },
        });
        break;
      case 'none':
        and.push({
          OR: [{ subscription: { is: null } }, { subscription: { currentPeriodEnd: null } }],
        });
        break;
      default:
        break;
    }

    return and.length > 0 ? { AND: and } : {};
  }
}

function latest(dates: Array<Date | null>): string | null {
  const times = dates.filter((date): date is Date => date !== null).map((date) => date.getTime());
  return times.length > 0 ? new Date(Math.max(...times)).toISOString() : null;
}
