import { Injectable, NotFoundException } from '@nestjs/common';
import type { Channel as PrismaChannel } from '@prisma/client';
import {
  type AnalyticsPoint,
  type AnalyticsRange,
  type AnalyticsSeries,
  type Channel,
  type ChannelStats,
  type ChannelSummary,
  type DonationTotal,
  rangeBucket,
  rangeToMs,
} from '@streamkit/contracts';
import type { AuditContext } from '../../common/audit/audit.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { PlatformConnectionService } from '../integrations/platform-connection.service';
import {
  ANALYTICS_PLATFORMS,
  toContractChannel,
  toContractPlatform,
} from '../integrations/platform.mappers';

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
    return rows.map(toContractChannel);
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
      channel: toContractChannel(channel),
      range,
      current: latest ? toContractStats(latest) : null,
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
  async series(userId: string, channelId: string, range: AnalyticsRange): Promise<AnalyticsSeries> {
    await this.requireOwned(userId, channelId);

    const bucket = rangeBucket(range);
    const since = new Date(Date.now() - rangeToMs(range));

    const rows = await this.prisma.$queryRaw<SeriesRow[]>`
      SELECT
        date_trunc(${bucket}, "capturedAt") AS at,
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

function toContractStats(row: {
  capturedAt: Date;
  isLive: boolean;
  viewers: number | null;
  followers: number | null;
  subscribers: number | null;
  totalViews: bigint | null;
  title: string | null;
  category: string | null;
}): ChannelStats {
  return {
    capturedAt: row.capturedAt.toISOString(),
    isLive: row.isLive,
    viewers: row.viewers,
    followers: row.followers,
    subscribers: row.subscribers,
    totalViews: toNumber(row.totalViews),
    title: row.title,
    category: row.category,
  };
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
