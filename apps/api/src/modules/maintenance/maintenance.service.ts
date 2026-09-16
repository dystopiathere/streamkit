import { Injectable, Logger } from '@nestjs/common';
import { Client } from 'pg';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AppConfig } from '../../config/app-config.service';
import { TokenService } from '../auth/token.service';

/** Таблицы событий Umami 3 с колонкой created_at. Сессии — отдельно, см. ниже. */
const SITE_STATS_EVENT_TABLES = [
  'website_event',
  'event_data',
  'session_data',
  'revenue',
  'session_replay',
  'heatmap_event',
] as const;

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
    private readonly config: AppConfig,
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

  /**
   * Журнал согласий, срок хранения которого истёк: три года после прекращения
   * обработки, как заявлено в политике. Прекращение — это удаление учётной
   * записи (для всех её согласий) или отзыв конкретного согласия.
   */
  async purgeExpiredConsents(retentionDays: number): Promise<number> {
    const threshold = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
    const result = await this.prisma.consent.deleteMany({
      where: {
        OR: [
          { user: { status: 'ANONYMIZED', anonymizedAt: { lt: threshold } } },
          { revokedAt: { lt: threshold } },
        ],
      },
    });

    if (result.count > 0) {
      this.logger.log({ count: result.count, retentionDays }, 'Удалены истёкшие записи согласий');
    }
    return result.count;
  }

  /**
   * Согласия анонимных посетителей на статистику. Баннер переспрашивает
   * посетителя через год, запись журнала живёт дольше — как доказательство
   * согласия на случай вопросов о прошлой статистике.
   */
  async purgeOldVisitorConsents(retentionDays: number): Promise<number> {
    const threshold = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
    const result = await this.prisma.visitorConsent.deleteMany({
      where: { grantedAt: { lt: threshold } },
    });

    if (result.count > 0) {
      this.logger.log(
        { count: result.count, retentionDays },
        'Удалены старые согласия посетителей',
      );
    }
    return result.count;
  }

  /**
   * Статистика посещений в базе Umami старше срока хранения.
   *
   * У Umami удаления старых данных нет вовсе, а срок заявлен в политике. Таблицы
   * называются так, как их создаёт Umami 3; таблица, которой в этой версии нет,
   * пропускается — иначе обновление Umami роняло бы всю ночную уборку. Сессия
   * удаляется, только когда у неё не осталось событий: без неё отчёты Umami
   * показывали бы события без браузера и страны.
   */
  async purgeOldSiteStats(retentionDays: number): Promise<number> {
    const url = this.config.umamiDatabaseUrl;
    if (!url) return 0;

    const threshold = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
    const client = new Client({ connectionString: url });
    await client.connect();
    let total = 0;
    try {
      for (const table of SITE_STATS_EVENT_TABLES) {
        const exists = await client.query<{ name: string | null }>(
          'SELECT to_regclass($1)::text AS name',
          [table],
        );
        if (!exists.rows[0]?.name) continue;
        // Имя таблицы — из константы выше, а не из ввода: параметром его не передать.
        const result = await client.query(`DELETE FROM "${table}" WHERE created_at < $1`, [
          threshold,
        ]);
        total += result.rowCount ?? 0;
      }
      const sessions = await client.query(
        `DELETE FROM "session" s WHERE s.created_at < $1
           AND NOT EXISTS (SELECT 1 FROM "website_event" e WHERE e.session_id = s.session_id)`,
        [threshold],
      );
      total += sessions.rowCount ?? 0;
    } finally {
      await client.end();
    }

    if (total > 0) {
      this.logger.log({ count: total, retentionDays }, 'Удалена старая статистика посещений');
    }
    return total;
  }

  /**
   * История платежей старше срока хранения.
   *
   * Платежи переживают удаление аккаунта: это учёт выручки и основание для
   * разбора споров о списании. Но и они хранятся не вечно — срок заявлен в
   * политике конфиденциальности, и незакрытые платежи уборка не трогает.
   */
  async purgeOldPayments(retentionDays: number): Promise<number> {
    const threshold = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
    const result = await this.prisma.payment.deleteMany({
      where: { createdAt: { lt: threshold }, status: { not: 'PENDING' } },
    });

    if (result.count > 0) {
      this.logger.log({ count: result.count, retentionDays }, 'Удалены старые платежи');
    }
    return result.count;
  }

  /**
   * Согласия гостей приватных комнат старше срока хранения аудита.
   *
   * Это доказательство согласия, и живёт оно столько же, сколько журнал
   * безопасности: срок заявлен в политике обработки ПДн, и хранить отпечатки
   * запросов посторонних людей дольше обещанного нельзя.
   */
  async purgeOldGuestConsents(retentionDays: number): Promise<number> {
    const threshold = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
    const result = await this.prisma.guestConsent.deleteMany({
      where: { grantedAt: { lt: threshold } },
    });

    if (result.count > 0) {
      this.logger.log({ count: result.count, retentionDays }, 'Удалены старые согласия гостей');
    }
    return result.count;
  }
}
