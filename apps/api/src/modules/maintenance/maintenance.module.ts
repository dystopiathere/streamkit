import { Injectable, Logger, Module } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { RedisLock } from '../../common/redis/lock.service';
import { AuthModule } from '../auth/auth.module';
import { MaintenanceService } from './maintenance.service';

/** Срок хранения аудита. Должен совпадать с политикой обработки ПДн. */
const AUDIT_RETENTION_DAYS = 180;

/**
 * Срок хранения снимков метрик. Тоже заявлен в политике обработки ПДн.
 *
 * Девяносто дней — это максимальный диапазон графика (30 дней) с тройным
 * запасом на сравнение «месяц к месяцу». Держать дольше значит хранить данные
 * без цели, а это ровно то, что 152-ФЗ запрещает.
 */
const SNAPSHOT_RETENTION_DAYS = 90;

/** Срок хранения истории платежей — пять лет, как заявлено в политике. */
const PAYMENT_RETENTION_DAYS = 5 * 365;

/** Журнал согласий — три года после прекращения обработки, как в политике. */
const CONSENT_RETENTION_DAYS = 3 * 365;

/** Статистика посещений в Umami — 13 месяцев: год и месяц для сравнения год к году. */
const SITE_STATS_RETENTION_DAYS = 396;

/** Журнал согласий посетителей: год действия согласия и ещё два года как доказательство. */
const VISITOR_CONSENT_RETENTION_DAYS = 3 * 365;

/** Ключ взаимного исключения между репликами воркера. */
const MAINTENANCE_LOCK_KEY = 'streamkit:lock:maintenance:nightly';

/**
 * Расписание уборки. Вынесено в отдельный класс, чтобы `MaintenanceService`
 * оставался обычным сервисом без привязки к cron — его удобно вызывать из
 * тестов и руками.
 */
@Injectable()
export class MaintenanceScheduler {
  private readonly logger = new Logger(MaintenanceScheduler.name);

  constructor(
    private readonly maintenance: MaintenanceService,
    private readonly lock: RedisLock,
  ) {}

  /**
   * Ночью: операция блокирующая для таблицы, днём она конкурировала бы со стримами.
   *
   * Под блокировкой, потому что расписание живёт в КАЖДОЙ реплике воркера:
   * без неё две реплики в 04:00 удаляют одни и те же строки наперегонки.
   * Час TTL с запасом перекрывает уборку на большой таблице.
   */
  @Cron(CronExpression.EVERY_DAY_AT_4AM)
  async nightlyCleanup(): Promise<void> {
    try {
      await this.lock.withLock(MAINTENANCE_LOCK_KEY, 60 * 60 * 1000, async () => {
        await this.maintenance.purgeExpiredTokens();
        await this.maintenance.purgeOldAuditLogs(AUDIT_RETENTION_DAYS);
        await this.maintenance.purgeOldSnapshots(SNAPSHOT_RETENTION_DAYS);
        await this.maintenance.purgeOldGuestConsents(AUDIT_RETENTION_DAYS);
        await this.maintenance.purgeOldPayments(PAYMENT_RETENTION_DAYS);
        await this.maintenance.purgeExpiredConsents(CONSENT_RETENTION_DAYS);
        await this.maintenance.purgeOldVisitorConsents(VISITOR_CONSENT_RETENTION_DAYS);
        await this.maintenance.purgeOldSiteStats(SITE_STATS_RETENTION_DAYS);
        // Не уборка, а приведение к тарифу: у кого платный кончился, активной
        // остаётся одна площадка. Ничего не удаляется — см. enforcePlatformLimits.
        await this.maintenance.enforcePlatformLimits();
        // И то же для оформления: открытая в OBS сцена конфиг не перезапрашивает,
        // поэтому продвинутое оформление у истёкшего тарифа снимается рассылкой.
        await this.maintenance.refreshStyling();
      });
    } catch (error) {
      // Упавшая уборка не должна ронять воркер: живые коннекторы важнее.
      this.logger.error({ err: error }, 'Ночная уборка завершилась ошибкой');
    }
  }
}

@Module({
  imports: [AuthModule],
  providers: [MaintenanceService, MaintenanceScheduler],
  exports: [MaintenanceService],
})
export class MaintenanceModule {}
