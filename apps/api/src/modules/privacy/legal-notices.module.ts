import { Injectable, Logger, Module } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { RedisLock } from '../../common/redis/lock.service';
import { LegalUpdateNoticesService } from './legal-update-notices.service';

const LEGAL_NOTICES_LOCK_KEY = 'streamkit:lock:legal-notices';

/**
 * Рассылка о новых редакциях — в воркере, каждые десять минут, под
 * блокировкой: расписание живёт в каждой реплике. Такт отправляет не больше
 * сотни писем, поэтому рассылка по всей базе растягивается на несколько тактов,
 * а не ложится одним залпом на почтовый сервис.
 */
@Injectable()
export class LegalNoticesScheduler {
  private readonly logger = new Logger(LegalNoticesScheduler.name);

  constructor(
    private readonly notices: LegalUpdateNoticesService,
    private readonly lock: RedisLock,
  ) {}

  @Cron(CronExpression.EVERY_10_MINUTES)
  async tick(): Promise<void> {
    try {
      await this.lock.withLock(LEGAL_NOTICES_LOCK_KEY, 9 * 60 * 1000, () =>
        this.notices.sendPending(),
      );
    } catch (error) {
      this.logger.error(
        { err: error },
        'Рассылка о новых редакциях документов завершилась ошибкой',
      );
    }
  }
}

@Module({
  providers: [LegalUpdateNoticesService, LegalNoticesScheduler],
  exports: [LegalUpdateNoticesService],
})
export class LegalNoticesModule {}
