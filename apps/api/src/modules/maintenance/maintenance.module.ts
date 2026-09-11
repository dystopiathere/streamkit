import { Injectable, Logger, Module } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { AuthModule } from '../auth/auth.module';
import { MaintenanceService } from './maintenance.service';

/** Срок хранения аудита. Должен совпадать с политикой обработки ПДн. */
const AUDIT_RETENTION_DAYS = 180;

/**
 * Расписание уборки. Вынесено в отдельный класс, чтобы `MaintenanceService`
 * оставался обычным сервисом без привязки к cron — его удобно вызывать из
 * тестов и руками.
 */
@Injectable()
export class MaintenanceScheduler {
  private readonly logger = new Logger(MaintenanceScheduler.name);

  constructor(private readonly maintenance: MaintenanceService) {}

  // Ночью: операция блокирующая для таблицы, днём она конкурировала бы со стримами.
  @Cron(CronExpression.EVERY_DAY_AT_4AM)
  async nightlyCleanup(): Promise<void> {
    try {
      await this.maintenance.purgeExpiredTokens();
      await this.maintenance.purgeOldAuditLogs(AUDIT_RETENTION_DAYS);
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
