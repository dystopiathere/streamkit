import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TokenService } from '../auth/token.service';

/**
 * Регулярная уборка. Запускается в worker-процессе, а не в API: фоновая
 * нагрузка не должна конкурировать за пул соединений с живыми запросами.
 */
@Injectable()
export class MaintenanceService {
  private readonly logger = new Logger(MaintenanceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokenService,
  ) {}

  /**
   * Протухшие refresh-токены. Держать их бессмысленно: проверка срока всё равно
   * идёт по `expiresAt`, а таблица растёт линейно по числу входов.
   */
  async purgeExpiredTokens(): Promise<number> {
    const count = await this.tokens.purgeExpired();
    if (count > 0) {
      this.logger.log({ count }, 'Удалены истёкшие refresh-токены');
    }
    return count;
  }

  /**
   * Аудит-лог старше срока хранения.
   *
   * Срок должен совпадать с тем, что заявлен в политике обработки ПДн: хранить
   * дольше обещанного — прямое нарушение, а удалять раньше — лишиться данных для
   * разбора инцидентов.
   */
  async purgeOldAuditLogs(retentionDays: number): Promise<number> {
    const threshold = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
    const result = await this.prisma.auditLog.deleteMany({
      where: { createdAt: { lt: threshold } },
    });

    if (result.count > 0) {
      this.logger.log({ count: result.count, retentionDays }, 'Удалены старые записи аудита');
    }
    return result.count;
  }

  /**
   * Снимки метрик старше срока хранения.
   *
   * Без уборки таблица растёт линейно и без потолка: канал в эфире даёт снимок
   * в минуту, то есть 1440 строк в сутки, и каждый запрос ряда за месяц
   * сканирует всё, что накопилось. Срок, как и у аудита, обязан совпадать с
   * заявленным в политике обработки ПДн.
   */
  async purgeOldSnapshots(retentionDays: number): Promise<number> {
    const threshold = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
    const result = await this.prisma.analyticsSnapshot.deleteMany({
      where: { capturedAt: { lt: threshold } },
    });

    if (result.count > 0) {
      this.logger.log({ count: result.count, retentionDays }, 'Удалены старые снимки метрик');
    }
    return result.count;
  }
}
