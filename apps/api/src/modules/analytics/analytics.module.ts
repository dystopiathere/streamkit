import { Injectable, Logger, Module } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { RedisLock } from '../../common/redis/lock.service';
import { IntegrationsModule } from '../integrations/integrations.module';
import { AnalyticsPoller, LIVE_INTERVAL_MS } from './analytics-poller.service';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsService } from './analytics.service';
import { QuotaService } from './quota.service';

/** Ключ взаимного исключения между репликами воркера. */
const POLL_LOCK_KEY = 'streamkit:lock:analytics:poll';

/**
 * Расписание опроса. Вынесено из сервиса, чтобы `AnalyticsPoller` оставался
 * обычным сервисом без привязки к cron — его удобно дёргать из тестов и руками.
 */
@Injectable()
export class AnalyticsScheduler {
  private readonly logger = new Logger(AnalyticsScheduler.name);

  constructor(
    private readonly poller: AnalyticsPoller,
    private readonly lock: RedisLock,
  ) {}

  /**
   * Тик под блокировкой.
   *
   * Расписание живёт в КАЖДОЙ реплике воркера, а квота YouTube — общая на весь
   * проект. Без блокировки две реплики просто удваивают расход и приближают
   * исчерпание квоты вдвое, ничего не выигрывая: данные те же самые.
   *
   * TTL чуть меньше интервала: если тик завис, следующий должен получить право
   * работать, а не ждать вечно.
   */
  @Interval(LIVE_INTERVAL_MS)
  async tick(): Promise<void> {
    try {
      await this.lock.withLock(POLL_LOCK_KEY, LIVE_INTERVAL_MS - 5_000, async () => {
        const polled = await this.poller.pollDue();
        if (polled > 0) {
          this.logger.debug({ polled }, 'Метрики каналов обновлены');
        }
      });
    } catch (error) {
      // Упавший опрос не должен ронять воркер: живые коннекторы донатов важнее.
      this.logger.error({ err: error }, 'Тик опроса аналитики завершился ошибкой');
    }
  }
}

/**
 * Аналитика площадок.
 *
 * Контроллер живёт в API, опрос — в воркере, поэтому модуль импортируется
 * обоими, а планировщик регистрируется отдельно: `ScheduleModule` поднят только
 * в воркере, и в API `@Interval` просто не запустится.
 */
@Module({
  imports: [IntegrationsModule],
  controllers: [AnalyticsController],
  providers: [AnalyticsService, AnalyticsPoller, QuotaService],
  exports: [AnalyticsService, AnalyticsPoller],
})
export class AnalyticsModule {}

/** То же самое плюс расписание. Подключается только воркером. */
@Module({
  imports: [AnalyticsModule],
  providers: [AnalyticsScheduler],
})
export class AnalyticsSchedulerModule {}
