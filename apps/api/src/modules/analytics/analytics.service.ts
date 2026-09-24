import { Injectable, NotFoundException } from '@nestjs/common';
import type { Channel as PrismaChannel } from '@prisma/client';
import {
  type AnalyticsOverview,
  type AnalyticsPoint,
  type AnalyticsRange,
  type AnalyticsSeries,
  type Channel,
  type ChannelStats,
  type ChannelSummary,
  type DonationTotal,
  overviewBucket,
  type Platform,
  rangeBucket,
  rangeToMs,
} from '@streamkit/contracts';
import type { AuditContext } from '../../common/audit/audit.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { toContractEventType } from '../events/event.mappers';
import { findPrimaryCurrency } from '../events/primary-currency';
import { PlatformConnectionService } from '../integrations/platform-connection.service';
import {
  ANALYTICS_PLATFORMS,
  toContractChannel,
  toContractPlatform,
} from '../integrations/platform.mappers';
import {
  audienceCounter,
  buildOverview,
  type ChannelAudienceBucket,
  type ChannelSession,
  type MinuteSum,
  STREAM_BREAK_MS,
} from './overview-builder';

/**
 * Максимальный промежуток между снимками, который засчитывается во время эфира.
 *
 * В эфире опрос идёт раз в минуту, поэтому нормальный промежуток — около 60
 * секунд. Всё, что больше пяти минут, означает не длинный эфир, а перерыв в
 * опросе: воркер перезапускали, квота кончалась, сеть отваливалась. Считать
 * такой провал эфиром — приписать стримеру часы, которых не было.
 */
const MAX_LIVE_GAP_SECONDS = 300;

interface SeriesRow {
  at: Date;
  viewers: number | null;
  followers: number | null;
  subscribers: number | null;
  live_share: number | null;
}

interface SessionRow {
  channel_id: string;
  platform: string;
  started_at: Date;
  ended_at: Date;
  peak_viewers: number | null;
  avg_viewers: number | null;
  followers_first: number | null;
  followers_last: number | null;
  subscribers_first: number | null;
  subscribers_last: number | null;
}

interface AudienceRow {
  channel_id: string;
  platform: string;
  at: Date;
  followers_first: number | null;
  followers_last: number | null;
  subscribers_first: number | null;
  subscribers_last: number | null;
}

interface MinuteRow {
  at: Date;
  amount: bigint | null;
  count: number;
}

interface HeatRow {
  weekday: number;
  hour: number;
  amount: bigint;
  count: number;
}

interface LiveStatsRow {
  peak_viewers: number | null;
  live_seconds: number | null;
}

@Injectable()
export class AnalyticsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly connections: PlatformConnectionService,
  ) {}

  async listChannels(userId: string): Promise<Channel[]> {
    const rows = await this.prisma.channel.findMany({
      where: { userId, platform: { in: ANALYTICS_PLATFORMS } },
      orderBy: { createdAt: 'asc' },
    });
    const scopes = await this.grantedScopes(userId);
    return rows.map((row) => toContractChannel(row, scopes.get(row.platform)));
  }

  async summary(userId: string, channelId: string, range: AnalyticsRange): Promise<ChannelSummary> {
    const channel = await this.requireOwned(userId, channelId);
    const since = new Date(Date.now() - rangeToMs(range));

    const [latest, earliest, liveStats] = await Promise.all([
      this.prisma.analyticsSnapshot.findFirst({
        where: { channelId },
        orderBy: { capturedAt: 'desc' },
      }),
      this.prisma.analyticsSnapshot.findFirst({
        where: { channelId, capturedAt: { gte: since } },
        orderBy: { capturedAt: 'asc' },
      }),
      this.liveStats(channelId, since),
    ]);

    return {
      channel: toContractChannel(channel, (await this.grantedScopes(userId)).get(channel.platform)),
      range,
      // Начало эфира живёт на канале, а не в снимке: истории оно не нужно, и
      // относится оно только к последнему снимку, если канал сейчас в эфире.
      current: latest ? toContractStats(latest, latest.isLive ? channel.liveSince : null) : null,
      deltas: {
        // Дельта считается только когда известны ОБА конца. Подставлять ноль за
        // неизвестное начало значит нарисовать рост с нуля там, где его не было.
        followers: delta(earliest?.followers, latest?.followers),
        subscribers: delta(earliest?.subscribers, latest?.subscribers),
        totalViews: delta(toNumber(earliest?.totalViews), toNumber(latest?.totalViews)),
      },
      peakViewers: liveStats.peak_viewers ?? null,
      liveHours: Math.round(((liveStats.live_seconds ?? 0) / 3600) * 10) / 10,
    };
  }

  /**
   * Ряд для графика.
   *
   * Прореживание делает СУБД, а не приложение: тридцать дней минутных снимков —
   * это под сорок тысяч строк, которые иначе пришлось бы вытащить в память
   * целиком, чтобы отдать тридцать точек.
   */
  async series(
    userId: string,
    channelId: string,
    range: AnalyticsRange,
    timeZone: string,
  ): Promise<AnalyticsSeries> {
    await this.requireOwned(userId, channelId);

    const bucket = rangeBucket(range);
    const since = new Date(Date.now() - rangeToMs(range));

    // Двойное `AT TIME ZONE` — не описка. `capturedAt` хранится как timestamp
    // без зоны и содержит UTC: первое приведение объявляет это явно, второе
    // переводит в местное настенное время, по которому и режутся корзины.
    // Последнее приведение возвращает границу корзины обратно в момент времени,
    // чтобы наружу уехал корректный ISO, а не местное время под видом UTC.
    const rows = await this.prisma.$queryRaw<SeriesRow[]>`
      SELECT
        date_trunc(${bucket}, "capturedAt" AT TIME ZONE 'UTC' AT TIME ZONE ${timeZone})
          AT TIME ZONE ${timeZone} AS at,
        AVG("viewers")::float8 AS viewers,
        MAX("followers")::int AS followers,
        MAX("subscribers")::int AS subscribers,
        AVG(CASE WHEN "isLive" THEN 1.0 ELSE 0.0 END)::float8 AS live_share
      FROM "AnalyticsSnapshot"
      WHERE "channelId" = ${channelId}::uuid AND "capturedAt" >= ${since}
      GROUP BY 1
      ORDER BY 1
    `;

    return {
      channelId,
      range,
      bucket,
      points: rows.map(toPoint),
    };
  }

  /**
   * Донаты за период — по пользователю, а не по каналу.
   *
   * Донат приходит из DonationAlerts или собственного вебхука, которые про
   * канал площадки ничего не знают. Разложить сумму по каналам означало бы
   * выдумать связь, которой в данных нет.
   */
  async donations(userId: string, range: AnalyticsRange): Promise<DonationTotal[]> {
    const since = new Date(Date.now() - rangeToMs(range));

    const grouped = await this.prisma.alertEvent.groupBy({
      by: ['currency'],
      where: {
        userId,
        isTest: false,
        createdAt: { gte: since },
        amountMinor: { not: null },
        currency: { not: null },
      },
      _sum: { amountMinor: true },
      _count: { _all: true },
    });

    return grouped
      .filter((row) => row.currency !== null)
      .map((row) => ({
        currency: row.currency as DonationTotal['currency'],
        amountMinor: row._sum.amountMinor ?? 0,
        count: row._count._all,
      }))
      .sort((a, b) => b.amountMinor - a.amountMinor);
  }

  /**
   * Сводка по эфирам и донатам: корзины времени, эфиры, тепловая карта.
   *
   * Каждый запрос считает агрегат в СУБД, а в память приходят минуты и
   * отрезки, а не строки событий: за девяносто дней у крупного канала это
   * десятки тысяч донатов. Склейка эфиров разных площадок и раскладка по
   * корзинам — в `buildOverview`, без базы.
   *
   * Границы корзин режет PostgreSQL в зоне браузера — тем же `date_trunc`, что
   * и ряды графиков, — поэтому сутки на графике донатов и сутки на графике
   * зрителей одни и те же, включая переход на летнее время.
   */
  async overview(
    userId: string,
    range: AnalyticsRange,
    timeZone: string,
  ): Promise<AnalyticsOverview> {
    const bucket = overviewBucket(range);
    const now = new Date();
    const since = new Date(now.getTime() - rangeToMs(range));
    const currency = await findPrimaryCurrency(this.prisma, userId);

    const [boundaries, donations, events, sessions, audience, heat, eventCounts, donationTotals] =
      await Promise.all([
        this.prisma.$queryRaw<{ at: Date }[]>`
          SELECT gs AT TIME ZONE ${timeZone} AS at
          FROM generate_series(
            date_trunc(${bucket}, ${since}::timestamptz AT TIME ZONE ${timeZone}),
            date_trunc(${bucket}, ${now}::timestamptz AT TIME ZONE ${timeZone}),
            ('1 ' || ${bucket})::interval
          ) gs
          ORDER BY 1
        `,
        this.prisma.$queryRaw<MinuteRow[]>`
          SELECT date_trunc('minute', "createdAt") AS at,
            SUM("amountMinor")::bigint AS amount, COUNT(*)::int AS count
          FROM "AlertEvent"
          WHERE "userId" = ${userId}::uuid AND "isTest" = false AND "createdAt" >= ${since}
            AND "amountMinor" IS NOT NULL AND "currency" = ${currency}
          GROUP BY 1
        `,
        this.prisma.$queryRaw<MinuteRow[]>`
          SELECT date_trunc('minute', "createdAt") AS at, NULL::bigint AS amount,
            COUNT(*)::int AS count
          FROM "AlertEvent"
          WHERE "userId" = ${userId}::uuid AND "isTest" = false AND "createdAt" >= ${since}
            AND "amountMinor" IS NULL
          GROUP BY 1
        `,
        this.channelSessions(userId, since),
        this.audienceBuckets(userId, since, bucket, timeZone),
        this.prisma.$queryRaw<HeatRow[]>`
          SELECT EXTRACT(ISODOW FROM local)::int AS weekday, EXTRACT(HOUR FROM local)::int AS hour,
            SUM("amountMinor")::bigint AS amount, COUNT(*)::int AS count
          FROM (
            SELECT "createdAt" AT TIME ZONE 'UTC' AT TIME ZONE ${timeZone} AS local, "amountMinor"
            FROM "AlertEvent"
            WHERE "userId" = ${userId}::uuid AND "isTest" = false AND "createdAt" >= ${since}
              AND "amountMinor" IS NOT NULL AND "currency" = ${currency}
          ) donations
          GROUP BY 1, 2
        `,
        this.prisma.alertEvent.groupBy({
          by: ['type'],
          where: { userId, isTest: false, createdAt: { gte: since } },
          _count: { _all: true },
        }),
        this.donations(userId, range),
      ]);

    const toMinutes = (rows: MinuteRow[]): MinuteSum[] =>
      rows.map((row) => ({ at: row.at, amountMinor: Number(row.amount ?? 0), count: row.count }));

    const built = buildOverview({
      boundaries: boundaries.map((row) => row.at),
      now,
      donations: toMinutes(donations),
      events: toMinutes(events),
      sessions,
      audience,
    });

    return {
      range,
      bucket,
      currency,
      donationTotals,
      ...built,
      eventCounts: eventCounts
        .map((row) => ({ type: toContractEventType(row.type), count: row._count._all }))
        .sort((a, b) => b.count - a.count),
      heatmap: heat.map((row) => ({
        weekday: row.weekday,
        hour: row.hour,
        amountMinor: Number(row.amount),
        count: row.count,
      })),
    };
  }

  /**
   * Непрерывные эфиры каждого канала — «острова» снимков в эфире.
   *
   * Новый остров начинается, когда до предыдущего снимка в эфире больше
   * `STREAM_BREAK_MS`: снимки вне эфира между ними не считаются, иначе обрыв
   * трансляции на пять минут делил бы вечер на два эфира. Счётчики аудитории —
   * первое и последнее известное значение острова.
   */
  private async channelSessions(userId: string, since: Date): Promise<ChannelSession[]> {
    const breakSeconds = STREAM_BREAK_MS / 1000;
    const rows = await this.prisma.$queryRaw<SessionRow[]>`
      WITH live AS (
        SELECT a."channelId", c."platform"::text AS platform, a."capturedAt", a."viewers",
          a."followers", a."subscribers",
          LAG(a."capturedAt") OVER (PARTITION BY a."channelId" ORDER BY a."capturedAt") AS prev_at
        FROM "AnalyticsSnapshot" a
        JOIN "Channel" c ON c."id" = a."channelId"
        WHERE c."userId" = ${userId}::uuid AND a."isLive" AND a."capturedAt" >= ${since}
          AND c."platform" IN ('TWITCH', 'YOUTUBE')
      ), runs AS (
        SELECT *, SUM(
          CASE WHEN prev_at IS NOT NULL
            AND EXTRACT(EPOCH FROM ("capturedAt" - prev_at)) <= ${breakSeconds} THEN 0 ELSE 1 END
        ) OVER (PARTITION BY "channelId" ORDER BY "capturedAt") AS run
        FROM live
      )
      SELECT "channelId" AS channel_id, platform,
        MIN("capturedAt") AS started_at, MAX("capturedAt") AS ended_at,
        MAX("viewers")::int AS peak_viewers, AVG("viewers")::float8 AS avg_viewers,
        (ARRAY_AGG("followers" ORDER BY "capturedAt") FILTER (WHERE "followers" IS NOT NULL))[1] AS followers_first,
        (ARRAY_AGG("followers" ORDER BY "capturedAt" DESC) FILTER (WHERE "followers" IS NOT NULL))[1] AS followers_last,
        (ARRAY_AGG("subscribers" ORDER BY "capturedAt") FILTER (WHERE "subscribers" IS NOT NULL))[1] AS subscribers_first,
        (ARRAY_AGG("subscribers" ORDER BY "capturedAt" DESC) FILTER (WHERE "subscribers" IS NOT NULL))[1] AS subscribers_last
      FROM runs
      GROUP BY "channelId", platform, run
    `;

    return rows.map((row) => {
      const platform = toPlatform(row.platform);
      const followers = audienceCounter(platform) === 'followers';
      return {
        channelId: row.channel_id,
        platform,
        startedAt: row.started_at,
        endedAt: row.ended_at,
        peakViewers: row.peak_viewers,
        avgViewers: row.avg_viewers,
        audienceFirst: followers ? row.followers_first : row.subscribers_first,
        audienceLast: followers ? row.followers_last : row.subscribers_last,
      };
    });
  }

  /** Счётчик аудитории каждого канала в начале и в конце каждой корзины. */
  private async audienceBuckets(
    userId: string,
    since: Date,
    bucket: 'hour' | 'day',
    timeZone: string,
  ): Promise<ChannelAudienceBucket[]> {
    const rows = await this.prisma.$queryRaw<AudienceRow[]>`
      SELECT a."channelId" AS channel_id, c."platform"::text AS platform,
        date_trunc(${bucket}, a."capturedAt" AT TIME ZONE 'UTC' AT TIME ZONE ${timeZone})
          AT TIME ZONE ${timeZone} AS at,
        (ARRAY_AGG(a."followers" ORDER BY a."capturedAt") FILTER (WHERE a."followers" IS NOT NULL))[1] AS followers_first,
        (ARRAY_AGG(a."followers" ORDER BY a."capturedAt" DESC) FILTER (WHERE a."followers" IS NOT NULL))[1] AS followers_last,
        (ARRAY_AGG(a."subscribers" ORDER BY a."capturedAt") FILTER (WHERE a."subscribers" IS NOT NULL))[1] AS subscribers_first,
        (ARRAY_AGG(a."subscribers" ORDER BY a."capturedAt" DESC) FILTER (WHERE a."subscribers" IS NOT NULL))[1] AS subscribers_last
      FROM "AnalyticsSnapshot" a
      JOIN "Channel" c ON c."id" = a."channelId"
      WHERE c."userId" = ${userId}::uuid AND a."capturedAt" >= ${since}
        AND c."platform" IN ('TWITCH', 'YOUTUBE')
      GROUP BY 1, 2, 3
    `;

    return rows.map((row) => {
      const followers = audienceCounter(toPlatform(row.platform)) === 'followers';
      return {
        channelId: row.channel_id,
        at: row.at,
        first: followers ? row.followers_first : row.subscribers_first,
        last: followers ? row.followers_last : row.subscribers_last,
      };
    });
  }

  /**
   * Включение и выключение площадки — через сервис подключений: там же лежит
   * правило «активной может быть одна» и рассылка каналов чата.
   */
  async setChannelEnabled(
    userId: string,
    channelId: string,
    isEnabled: boolean,
    context: AuditContext = {},
  ): Promise<void> {
    await this.connections.setEnabled(userId, channelId, isEnabled, context);
  }

  /** Отключение площадки вместе со снимками (каскадом по внешнему ключу). */
  async disconnect(userId: string, channelId: string, context: AuditContext = {}): Promise<void> {
    const channel = await this.requireOwned(userId, channelId);
    await this.connections.disconnect(userId, toContractPlatform(channel.platform), context);
  }

  /**
   * Пиковые зрители и время в эфире одним проходом.
   *
   * Окно `LAG` нужно потому, что длительность эфира в снимках не записана —
   * записаны только отдельные моменты. Складываем промежутки между соседними
   * снимками, у которых оба конца «в эфире», и обрезаем аномально большие: они
   * означают перерыв в опросе, а не долгий стрим.
   */
  private async liveStats(channelId: string, since: Date): Promise<LiveStatsRow> {
    const rows = await this.prisma.$queryRaw<LiveStatsRow[]>`
      SELECT
        MAX("viewers")::int AS peak_viewers,
        COALESCE(SUM(
          CASE
            WHEN "isLive" AND "prevLive" THEN LEAST(
              EXTRACT(EPOCH FROM ("capturedAt" - "prevAt")),
              ${MAX_LIVE_GAP_SECONDS}::numeric
            )
            ELSE 0
          END
        ), 0)::float8 AS live_seconds
      FROM (
        SELECT
          "capturedAt",
          "isLive",
          "viewers",
          LAG("capturedAt") OVER (ORDER BY "capturedAt") AS "prevAt",
          LAG("isLive") OVER (ORDER BY "capturedAt") AS "prevLive"
        FROM "AnalyticsSnapshot"
        WHERE "channelId" = ${channelId}::uuid AND "capturedAt" >= ${since}
      ) windowed
    `;

    return rows[0] ?? { peak_viewers: null, live_seconds: 0 };
  }

  /** Какие права выдала каждая площадка — по учётным данным пользователя. */
  private async grantedScopes(userId: string): Promise<Map<string, string[]>> {
    const credentials = await this.prisma.integrationCredential.findMany({
      where: { userId, provider: { in: ['twitch', 'youtube'] } },
      select: { provider: true, scopes: true },
    });
    return new Map(credentials.map((row) => [row.provider.toUpperCase(), row.scopes]));
  }

  /**
   * Владение проверяется в каждом методе. Чужой канал отдаёт 404, а не 403:
   * иначе по коду ответа можно перебирать существующие идентификаторы.
   */
  private async requireOwned(userId: string, channelId: string): Promise<PrismaChannel> {
    const channel = await this.prisma.channel.findFirst({
      where: { id: channelId, userId, platform: { in: ANALYTICS_PLATFORMS } },
    });
    if (!channel) {
      throw new NotFoundException('Канал не найден');
    }
    return channel;
  }
}

function toContractStats(
  row: {
    capturedAt: Date;
    isLive: boolean;
    viewers: number | null;
    followers: number | null;
    subscribers: number | null;
    totalViews: bigint | null;
    title: string | null;
    category: string | null;
  },
  liveSince: Date | null = null,
): ChannelStats {
  return {
    capturedAt: row.capturedAt.toISOString(),
    isLive: row.isLive,
    viewers: row.viewers,
    followers: row.followers,
    subscribers: row.subscribers,
    totalViews: toNumber(row.totalViews),
    title: row.title,
    category: row.category,
    liveSince: liveSince?.toISOString() ?? null,
  };
}

function toPlatform(value: string): Platform {
  return value === 'YOUTUBE' ? 'youtube' : 'twitch';
}

function toPoint(row: SeriesRow): AnalyticsPoint {
  return {
    at: row.at.toISOString(),
    viewers: row.viewers === null ? null : Math.round(row.viewers * 10) / 10,
    followers: row.followers,
    subscribers: row.subscribers,
    liveShare: row.live_share ?? 0,
  };
}

/**
 * Просмотры хранятся как BigInt: у крупного канала они не влезают в Int32.
 * Для JSON их всё равно приходится сузить до number — до 2^53 это точно, а
 * столько просмотров нет ни у одного канала на планете.
 */
function toNumber(value: bigint | null | undefined): number | null {
  return value === null || value === undefined ? null : Number(value);
}

function delta(from: number | null | undefined, to: number | null | undefined): number | null {
  if (from === null || from === undefined || to === null || to === undefined) return null;
  return to - from;
}
