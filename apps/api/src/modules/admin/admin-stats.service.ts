import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  ADMIN_STATS_RANGE_DAYS,
  type AdminStats,
  type AdminStatsPoint,
  type AdminStatsRange,
  adminStatsBucket,
  type Currency,
  type Money,
} from '@streamkit/contracts';
import type { Redis } from 'ioredis';
import { PrismaService } from '../../common/prisma/prisma.service';
import { REDIS_CLIENT } from '../../common/redis/redis.module';
import { AppConfig } from '../../config/app-config.service';
import { quotaKey } from '../analytics/quota.service';
import { DAY_MS, subscriptionStatus, toContractPeriod } from '../billing/billing-periods';
import { toContractProvider } from '../events/event.mappers';
import {
  ANALYTICS_PLATFORMS,
  toContractPlatform,
  toContractSyncState,
} from '../integrations/platform.mappers';
import { toContractWidgetType } from '../widgets/widget.mappers';

/**
 * Часовой пояс корзин.
 *
 * Аудитория и команда — в России, и «день» на графике должен начинаться в
 * полночь по Москве, а не в три часа ночи.
 */
const STATS_TIME_ZONE = 'Europe/Moscow';

/**
 * Месячная выручка подписки.
 *
 * Годовая цена делится на 12 целочисленно: остаток в копейках отбрасывается,
 * а не округляется через float.
 */
export function monthlyRecurringMinor(period: 'month' | 'year', amountMinor: number): number {
  return period === 'year' ? Math.floor(amountMinor / 12) : amountMinor;
}

interface PointRow {
  at: Date;
  // bigint: сумма выручки в копейках за неделю не обязана помещаться в int.
  value: bigint;
}

/**
 * Статистика платформы для админки.
 *
 * Только числа. События считаются количеством, без имён, сообщений и сумм
 * донатов: суммы донатов — деньги зрителей стримера, а не выручка платформы, и
 * сводки по ним платформа себе не обещала.
 */
@Injectable()
export class AdminStatsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  async stats(range: AdminStatsRange, now = new Date()): Promise<AdminStats> {
    const bucket = adminStatsBucket(range);
    const since = new Date(now.getTime() - ADMIN_STATS_RANGE_DAYS[range] * DAY_MS);

    const [
      users,
      subscriptions,
      widgets,
      liveOverlays,
      channels,
      youtubeQuota,
      eventsByProvider,
      registrations,
      logins,
      events,
      rooms,
      revenue,
    ] = await Promise.all([
      this.users(now),
      this.subscriptions(since, now),
      this.widgets(),
      this.prisma.overlayToken.count({
        where: { revokedAt: null, lastSeenAt: { gte: new Date(now.getTime() - DAY_MS) } },
      }),
      this.channels(),
      this.youtubeQuota(now),
      this.prisma.alertEvent.groupBy({
        by: ['provider'],
        where: { createdAt: { gte: since }, isTest: false },
        _count: { _all: true },
      }),
      this.series(
        Prisma.sql`SELECT "createdAt" AS ts, 1 AS v FROM "User" WHERE "createdAt" >= ${since}`,
        since,
        now,
        bucket,
      ),
      this.series(
        Prisma.sql`SELECT "createdAt" AS ts, 1 AS v FROM "AuditLog"
          WHERE "action" = 'auth.login.success' AND "createdAt" >= ${since}`,
        since,
        now,
        bucket,
      ),
      this.series(
        Prisma.sql`SELECT "createdAt" AS ts, 1 AS v FROM "AlertEvent"
          WHERE "createdAt" >= ${since} AND NOT "isTest"`,
        since,
        now,
        bucket,
      ),
      this.series(
        Prisma.sql`SELECT "createdAt" AS ts, 1 AS v FROM "Room" WHERE "createdAt" >= ${since}`,
        since,
        now,
        bucket,
      ),
      this.revenue(since, now, bucket),
    ]);

    return {
      range,
      bucket,
      generatedAt: now.toISOString(),
      users,
      subscriptions,
      widgets,
      liveOverlays,
      channels,
      youtubeQuota,
      eventsByProvider: eventsByProvider.map((row) => ({
        provider: toContractProvider(row.provider),
        count: row._count._all,
      })),
      series: { registrations, logins, events, rooms, revenue },
    };
  }

  private async users(now: Date): Promise<AdminStats['users']> {
    const activeSince = (days: number) => new Date(now.getTime() - days * DAY_MS);
    const [total, suspended, active7d, active30d] = await Promise.all([
      this.prisma.user.count({ where: { status: { not: 'ANONYMIZED' } } }),
      this.prisma.user.count({ where: { status: 'SUSPENDED' } }),
      this.activeUsers(activeSince(7)),
      this.activeUsers(activeSince(30)),
    ]);
    return { total, suspended, active7d, active30d };
  }

  /** Кто обновлял сессию дашборда: входы в админку активностью платформы не считаются. */
  private async activeUsers(since: Date): Promise<number> {
    const [row] = await this.prisma.$queryRaw<Array<{ n: number }>>`
      SELECT COUNT(DISTINCT "userId")::int AS n FROM "RefreshToken"
      WHERE "scope" = 'USER' AND "lastUsedAt" >= ${since}`;
    return row?.n ?? 0;
  }

  private async subscriptions(since: Date, now: Date): Promise<AdminStats['subscriptions']> {
    const [rows, renewalFailures] = await Promise.all([
      this.prisma.subscription.findMany({
        where: { currentPeriodEnd: { not: null }, user: { status: 'ACTIVE' } },
        select: {
          period: true,
          currentPeriodEnd: true,
          autoRenew: true,
          renewalAmountMinor: true,
          renewalCurrency: true,
        },
      }),
      this.prisma.payment.count({
        where: { kind: 'RENEWAL', status: 'CANCELED', createdAt: { gte: since } },
      }),
    ]);

    let activeMonth = 0;
    let activeYear = 0;
    let grace = 0;
    let endingWithoutRenewal = 0;
    const mrr = new Map<Currency, number>();

    for (const row of rows) {
      const status = subscriptionStatus(row, now);
      if (status === 'active') {
        if (row.period === 'YEAR') activeYear += 1;
        else activeMonth += 1;
        if (!row.autoRenew) endingWithoutRenewal += 1;
      } else if (status === 'grace') {
        grace += 1;
      }
      // Регулярная выручка — только то, что продлится само.
      if ((status === 'active' || status === 'grace') && row.autoRenew) {
        const currency = row.renewalCurrency as Currency;
        mrr.set(
          currency,
          (mrr.get(currency) ?? 0) +
            monthlyRecurringMinor(toContractPeriod(row.period), row.renewalAmountMinor),
        );
      }
    }

    return {
      activeMonth,
      activeYear,
      grace,
      endingWithoutRenewal,
      mrr: [...mrr].map(([currency, amountMinor]): Money => ({ currency, amountMinor })),
      renewalFailures,
    };
  }

  private async widgets(): Promise<AdminStats['widgets']> {
    const rows = await this.prisma.widget.groupBy({
      by: ['type', 'isEnabled'],
      _count: { _all: true },
    });
    const byType = new Map<string, { total: number; enabled: number }>();
    for (const row of rows) {
      const type = toContractWidgetType(row.type);
      const entry = byType.get(type) ?? { total: 0, enabled: 0 };
      entry.total += row._count._all;
      if (row.isEnabled) entry.enabled += row._count._all;
      byType.set(type, entry);
    }
    return [...byType].map(([type, counts]) => ({
      type: type as AdminStats['widgets'][number]['type'],
      ...counts,
    }));
  }

  private async channels(): Promise<AdminStats['channels']> {
    const rows = await this.prisma.channel.groupBy({
      by: ['platform', 'syncState'],
      where: { platform: { in: ANALYTICS_PLATFORMS } },
      _count: { _all: true },
    });
    return rows.map((row) => ({
      platform: toContractPlatform(row.platform),
      syncState: toContractSyncState(row.syncState),
      count: row._count._all,
    }));
  }

  private async youtubeQuota(now: Date): Promise<AdminStats['youtubeQuota']> {
    if (!this.config.oauthCredentials('youtube')) return null;
    const used = Number((await this.redis.get(quotaKey('youtube', now))) ?? 0);
    return { used, limit: this.config.youtubeDailyQuota };
  }

  /** Оплаты за вычетом возвратов по дате оплаты — отдельный ряд на валюту. */
  private async revenue(
    since: Date,
    now: Date,
    bucket: 'day' | 'week',
  ): Promise<AdminStats['series']['revenue']> {
    const currencies = await this.prisma.payment.findMany({
      where: { status: 'SUCCEEDED', paidAt: { gte: since } },
      distinct: ['currency'],
      select: { currency: true },
    });
    return Promise.all(
      currencies.map(async ({ currency }) => ({
        currency: currency as Currency,
        points: await this.series(
          Prisma.sql`SELECT "paidAt" AS ts, ("amountMinor" - "refundedAmountMinor") AS v
            FROM "Payment"
            WHERE "status" = 'SUCCEEDED' AND "paidAt" >= ${since} AND "currency" = ${currency}`,
          since,
          now,
          bucket,
        ),
      })),
    );
  }

  /**
   * Ряд по корзинам: сумма `v` за каждую, пустые корзины — нулём.
   *
   * Без `generate_series` дни без регистраций пропадали бы из ряда, и столбики
   * соседних дней вставали бы вплотную — неделя тишины выглядела бы как её
   * отсутствие.
   *
   * `source` — фрагмент SQL из этого файла, с параметрами через `Prisma.sql`;
   * пользовательский ввод сюда не попадает.
   */
  private async series(
    source: Prisma.Sql,
    since: Date,
    now: Date,
    bucket: 'day' | 'week',
  ): Promise<AdminStatsPoint[]> {
    const step = bucket === 'week' ? '1 week' : '1 day';
    const rows = await this.prisma.$queryRaw<PointRow[]>`
      WITH buckets AS (
        SELECT generate_series(
          date_trunc(${bucket}, ${since}::timestamptz AT TIME ZONE ${STATS_TIME_ZONE}),
          date_trunc(${bucket}, ${now}::timestamptz AT TIME ZONE ${STATS_TIME_ZONE}),
          ${step}::interval
        ) AS b
      ),
      data AS (${source})
      SELECT
        (buckets.b AT TIME ZONE ${STATS_TIME_ZONE}) AS at,
        COALESCE(SUM(data.v), 0)::bigint AS value
      FROM buckets
      LEFT JOIN data
        ON date_trunc(${bucket}, data.ts AT TIME ZONE 'UTC' AT TIME ZONE ${STATS_TIME_ZONE}) = buckets.b
      GROUP BY buckets.b
      ORDER BY buckets.b
    `;
    return rows.map((row) => ({ at: row.at.toISOString(), value: Number(row.value) }));
  }
}
