import { Injectable, Logger } from '@nestjs/common';
import type { Channel as PrismaChannel, ChannelSyncState } from '@prisma/client';
import type { ChannelStats } from '@streamkit/contracts';
import { RealtimeBus } from '../../common/bus/realtime-bus.service';
import {
  PlatformAuthError,
  PlatformQuotaError,
  PlatformRateLimitError,
} from '../../common/http/platform-errors';
import { PrismaService } from '../../common/prisma/prisma.service';
import { PlatformRegistry } from '../integrations/platform-registry.service';
import { PlatformTokenService } from '../integrations/platform-token.service';
import { ANALYTICS_PLATFORMS, toContractPlatform } from '../integrations/platform.mappers';
import { QuotaService } from './quota.service';

/** Как часто опрашивается канал в эфире. Зрители меняются поминутно. */
export const LIVE_INTERVAL_MS = 60_000;

/**
 * Как часто опрашивается канал вне эфира.
 *
 * Пятнадцать минут — не про «медленно меняются подписчики», а про квоту:
 * минутный опрос круглые сутки стоил бы 4320 единиц YouTube на один канал при
 * суточном лимите 10 000 НА ВЕСЬ ПРОЕКТ. Пятнадцать минут дают 288 единиц —
 * примерно тридцать каналов на инсталляцию.
 */
export const IDLE_INTERVAL_MS = 15 * 60_000;

/** Сколько каналов опрашиваем за один тик, чтобы не упереться в лимит частоты. */
const BATCH_SIZE = 20;

/** Потолок паузы после неудачи. Дальше растить смысла нет: час и так много. */
const MAX_RETRY_MINUTES = 60;

export interface PollCandidate {
  lastSyncedAt: Date | null;
  nextAttemptAt: Date | null;
  syncState: ChannelSyncState;
  wasLive: boolean;
}

/**
 * Пауза после неудачной попытки: 1, 2, 4, 8... минут до часа.
 *
 * Без неё сбойный канал повторялся каждую минуту вместо положенных пятнадцати:
 * `lastSyncedAt` при ошибке намеренно не двигается, а каденция считалась именно
 * по нему. Двадцати таких каналов хватало, чтобы занять весь `BATCH_SIZE` и
 * остановить сбор метрик у исправных.
 */
export function retryDelayMs(attempts: number): number {
  const minutes = Math.min(2 ** Math.max(0, attempts - 1), MAX_RETRY_MINUTES);
  return minutes * 60_000;
}

/**
 * Пора ли опрашивать канал.
 *
 * Чистая функция: вся логика каденции проверяется тестом без БД, без сети и
 * без часов.
 */
export function isDue(channel: PollCandidate, now: number): boolean {
  // Протухший доступ не лечится повтором: пока пользователь не переподключит
  // площадку, каждый запрос будет стоить нам 401 и ничего больше.
  if (channel.syncState === 'AUTH_EXPIRED') return false;

  // Пауза после неудачи — отдельное поле, а не производная от lastSyncedAt:
  // «когда метрики удалось собрать» и «когда пробовать снова» перестают
  // совпадать ровно в тот момент, когда сбор перестал получаться.
  if (channel.nextAttemptAt && now < channel.nextAttemptAt.getTime()) return false;

  if (!channel.lastSyncedAt) return true;

  const interval = channel.wasLive ? LIVE_INTERVAL_MS : IDLE_INTERVAL_MS;
  return now - channel.lastSyncedAt.getTime() >= interval;
}

/** Ближайшая полночь по UTC — когда Google обнуляет суточную квоту проекта. */
export function nextQuotaReset(now: Date): Date {
  const reset = new Date(now);
  reset.setUTCHours(24, 0, 0, 0);
  return reset;
}

/**
 * Сбор метрик подключённых каналов.
 *
 * Обычный сервис без привязки к расписанию — cron живёт в
 * `AnalyticsScheduler`. Разделение то же, что у `MaintenanceService`: так опрос
 * можно дёрнуть из теста и руками, не дожидаясь тика.
 */
@Injectable()
export class AnalyticsPoller {
  private readonly logger = new Logger(AnalyticsPoller.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: PlatformRegistry,
    private readonly tokens: PlatformTokenService,
    private readonly quota: QuotaService,
    private readonly bus: RealtimeBus,
  ) {}

  /** Один проход опроса. @returns сколько каналов удалось обновить. */
  async pollDue(now: Date = new Date()): Promise<number> {
    const candidates = await this.prisma.channel.findMany({
      where: {
        isEnabled: true,
        platform: { in: ANALYTICS_PLATFORMS },
        syncState: { not: 'AUTH_EXPIRED' },
        // Каналы на паузе после неудачи отсекаются ЗАПРОСОМ, а не фильтром в
        // памяти: иначе они продолжали бы занимать места в выборке из двадцати
        // и вытеснять из неё исправные.
        OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
      },
      // Давно не обновлявшиеся идут первыми: при нехватке бюджета отстающие не
      // должны голодать в пользу тех, кого только что опросили.
      orderBy: { lastSyncedAt: { sort: 'asc', nulls: 'first' } },
      take: BATCH_SIZE,
    });

    let polled = 0;
    for (const channel of candidates) {
      const wasLive = await this.wasLive(channel.id);
      if (!isDue({ ...channel, wasLive }, now.getTime())) continue;

      if (await this.pollChannel(channel)) polled += 1;
    }

    return polled;
  }

  private async pollChannel(channel: PrismaChannel): Promise<boolean> {
    const platform = toContractPlatform(channel.platform);
    const provider = this.registry.find(platform);
    if (!provider) {
      // Площадку выключили в конфигурации, а канал остался подключённым.
      // Это не ошибка пользователя — молча пропускаем.
      return false;
    }

    // Бюджет резервируется ДО запроса: списание после означало бы, что
    // превышение обнаруживается уже потраченным.
    if (!(await this.quota.reserve(platform, provider.statsQuotaCost))) {
      // Ждать до обнуления квоты, а не минуту: до полуночи по UTC ни одна
      // попытка не может получиться, а каждая стоит запроса в Redis и записи в БД.
      await this.markState(channel.id, 'RATE_LIMITED', 'Суточная квота площадки исчерпана', {
        nextAttemptAt: nextQuotaReset(new Date()),
      });
      return false;
    }

    try {
      const accessToken = await this.tokens.getAccessToken(channel.userId, platform);
      const stats = await provider.fetchStats(accessToken, {
        externalId: channel.externalId,
        login: channel.login,
        displayName: channel.displayName,
        avatarUrl: channel.avatarUrl,
      });

      await this.persist(channel, stats);
      return true;
    } catch (error) {
      await this.handleFailure(channel, error);
      return false;
    }
  }

  private async persist(channel: PrismaChannel, stats: ChannelStats): Promise<void> {
    const capturedAt = new Date(stats.capturedAt);

    await this.prisma.$transaction([
      this.prisma.analyticsSnapshot.create({
        data: {
          channelId: channel.id,
          capturedAt,
          isLive: stats.isLive,
          viewers: stats.viewers,
          followers: stats.followers,
          subscribers: stats.subscribers,
          totalViews: stats.totalViews === null ? null : BigInt(stats.totalViews),
          title: stats.title,
          category: stats.category,
        },
      }),
      this.prisma.channel.update({
        where: { id: channel.id },
        data: {
          lastSyncedAt: capturedAt,
          syncState: 'OK',
          syncError: null,
          // Удача обнуляет историю неудач: иначе канал, починившийся после
          // недельного простоя, так и остался бы с часовой паузой.
          syncAttempts: 0,
          nextAttemptAt: null,
        },
      }),
    ]);

    // Дашборд узнаёт о свежих метриках из шины, а не опросом API: иначе
    // открытая вкладка «Аналитика» сама генерировала бы поток запросов.
    await this.bus
      .publish({
        kind: 'analytics',
        userId: channel.userId,
        channelId: channel.id,
        stats,
      })
      .catch((error: unknown) =>
        this.logger.warn(
          { err: error, channelId: channel.id },
          'Метрики записаны, но не доставлены',
        ),
      );
  }

  /**
   * Реакция на отказ зависит от того, что делать дальше, а не от кода ответа.
   *
   * Мёртвый токен — тупик до действия пользователя, и опрос обязан прекратиться:
   * иначе канал будет вечно долбить площадку запросами, которые не могут
   * получиться. Лимит частоты пройдёт сам. Остальное — «попробуем в следующий раз».
   */
  private async handleFailure(channel: PrismaChannel, error: unknown): Promise<void> {
    // Квота проверяется ПЕРВОЙ: Google сообщает о ней кодом 403, тем же, что и
    // об отозванном доступе. Раньше эта ветка не отличалась от мёртвого токена,
    // и штатное исчерпание бюджета выключало сбор метрик у всех каналов сразу,
    // навсегда, с требованием переподключить площадку.
    if (error instanceof PlatformQuotaError) {
      if (error.isDaily) {
        // Площадка знает лучше нашего счётчика: наш резерв — оценка, и часть
        // запросов (подключение, обновление токена) мимо него вообще проходит.
        await this.quota.exhaust(toContractPlatform(channel.platform));
      }
      await this.markState(channel.id, 'RATE_LIMITED', 'Квота площадки исчерпана', {
        nextAttemptAt: error.isDaily ? nextQuotaReset(new Date()) : undefined,
      });
      this.logger.warn(
        { channelId: channel.id, reason: error.reason },
        'Площадка отказала по квоте, опрос отложен',
      );
      return;
    }

    if (error instanceof PlatformAuthError) {
      await this.markState(channel.id, 'AUTH_EXPIRED', 'Площадка отвергла доступ');
      this.logger.warn({ channelId: channel.id }, 'Доступ к площадке истёк, опрос остановлен');
      return;
    }

    if (error instanceof PlatformRateLimitError) {
      await this.markState(channel.id, 'RATE_LIMITED', 'Площадка просит снизить частоту', {
        nextAttemptAt: new Date(Date.now() + error.retryAfterMs),
      });
      return;
    }

    await this.markState(channel.id, 'ERROR', errorMessage(error));
    this.logger.error({ err: error, channelId: channel.id }, 'Не удалось собрать метрики');
  }

  /**
   * Запись неудачи.
   *
   * `lastSyncedAt` НЕ трогаем: он означает «когда метрики удалось собрать»,
   * и обновить его при ошибке значило бы соврать в интерфейсе про свежесть
   * данных. Пауза до следующей попытки живёт в отдельном `nextAttemptAt`.
   */
  private async markState(
    channelId: string,
    syncState: ChannelSyncState,
    syncError: string | null,
    options: { nextAttemptAt?: Date } = {},
  ): Promise<void> {
    const updated = await this.prisma.channel
      .update({
        where: { id: channelId },
        data: { syncState, syncError, syncAttempts: { increment: 1 } },
        select: { syncAttempts: true },
      })
      .catch(() => null);
    if (!updated) return;

    // Явную дату (квота до полуночи, `Retry-After` площадки) не перетираем:
    // площадка сказала точнее, чем может предположить наша формула.
    const nextAttemptAt =
      options.nextAttemptAt ?? new Date(Date.now() + retryDelayMs(updated.syncAttempts));

    await this.prisma.channel
      .update({ where: { id: channelId }, data: { nextAttemptAt } })
      .catch(() => undefined);
  }

  /** Был ли канал в эфире на прошлом снимке — от этого зависит частота опроса. */
  private async wasLive(channelId: string): Promise<boolean> {
    const last = await this.prisma.analyticsSnapshot.findFirst({
      where: { channelId },
      orderBy: { capturedAt: 'desc' },
      select: { isLive: true },
    });
    return last?.isLive ?? false;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 500) : 'Неизвестная ошибка';
}
