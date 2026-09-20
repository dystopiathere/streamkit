import {
  Injectable,
  Logger,
  Module,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { RealtimeBus, type BusMessage } from '../../common/bus/realtime-bus.service';
import { RedisLock } from '../../common/redis/lock.service';
import { IntegrationsModule } from '../integrations/integrations.module';
import { AnalyticsPoller, LIVE_INTERVAL_MS } from './analytics-poller.service';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsService } from './analytics.service';
import { QuotaService } from './quota.service';

/** Ключ взаимного исключения между репликами воркера. */
const POLL_LOCK_KEY = 'streamkit:lock:analytics:poll';

/**
 * Через сколько опросить площадку после её сообщения о начале эфира, и сколько
 * раз повторить.
 *
 * Не мгновенно: `stream.online` приходит раньше, чем эфир виден в Helix
 * `/streams`, и немедленный запрос вернул бы «не в эфире» — снимок с этим
 * ответом отложил бы следующую попытку на обычные пятнадцать минут, то есть
 * ровно на то опоздание, от которого событие и спасает. Вторая попытка — на
 * случай, когда площадка запаздывает сильнее.
 */
const STREAM_ONLINE_POLL_DELAYS_MS = [3_000, 20_000];

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
 * Опрос по сигналу площадки о начале и конце эфира.
 *
 * Живёт рядом с расписанием и только в воркере: сигнал приходит из коннектора
 * EventSub, который тоже работает там. Отдельный класс, а не метод
 * планировщика, — у него своя блокировка: тик опроса держит свою на минуту, и
 * событие эфира не должно её ждать.
 */
@Injectable()
export class StreamStateListener implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(StreamStateListener.name);
  private unsubscribe: (() => Promise<void>) | null = null;
  /** Незавершённые опросы — чтобы остановка процесса их дождалась. */
  private readonly running = new Set<Promise<void>>();

  constructor(
    private readonly poller: AnalyticsPoller,
    private readonly bus: RealtimeBus,
    private readonly lock: RedisLock,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    this.unsubscribe = await this.bus.subscribe((message) => this.handle(message));
  }

  async onApplicationShutdown(): Promise<void> {
    await this.unsubscribe?.();
    this.unsubscribe = null;
    await Promise.allSettled([...this.running]);
  }

  private handle(message: BusMessage): void {
    if (message.kind !== 'channel-live') return;
    const task = this.poll(message).finally(() => this.running.delete(task));
    this.running.add(task);
  }

  private async poll(message: BusMessage & { kind: 'channel-live' }): Promise<void> {
    const key = `streamkit:lock:analytics:live:${message.userId}:${message.platform}`;
    try {
      // Блокировка — на весь разбор с паузами: иначе две реплики воркера
      // потратили бы по два запроса к площадке на одно и то же событие.
      await this.lock.withLock(key, 60_000, async () => {
        for (const delay of STREAM_ONLINE_POLL_DELAYS_MS) {
          await sleep(delay);
          const { isLive } = await this.poller.pollUser(message.userId, message.platform);
          // Конец эфира площадка не задерживает — одной попытки достаточно.
          if (!message.isLive || isLive) return;
        }
      });
    } catch (error) {
      this.logger.warn(
        { err: error, platform: message.platform },
        'Опрос по сигналу о начале эфира не выполнен',
      );
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
  providers: [AnalyticsScheduler, StreamStateListener],
})
export class AnalyticsSchedulerModule {}
