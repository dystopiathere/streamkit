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
