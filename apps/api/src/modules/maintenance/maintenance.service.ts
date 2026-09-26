import { Injectable, Logger } from '@nestjs/common';
import {
  applyPlanToConfig,
  configSchemaFor,
  GRACE_DAYS,
  PLAN_FEATURES,
} from '@streamkit/contracts';
import { Client } from 'pg';
import { AuditService } from '../../common/audit/audit.service';
import { type BusMessage, RealtimeBus } from '../../common/bus/realtime-bus.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AppConfig } from '../../config/app-config.service';
import { TokenService } from '../auth/token.service';
import { DAY_MS, effectivePlan } from '../billing/billing-periods';
import { toContractWidgetType } from '../widgets/widget.mappers';

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
/** Сколько ночей уборки может пропустить рассылка базового оформления. */
const REFRESH_STYLING_SLACK_DAYS = 7;

@Injectable()
export class MaintenanceService {
  private readonly logger = new Logger(MaintenanceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokenService,
    private readonly config: AppConfig,
    private readonly audit: AuditService,
    private readonly bus: RealtimeBus,
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
   * Ссылки восстановления пароля: истёкшие и использованные уже ничего не
   * открывают, а строка хранит, кто и когда просил сменить пароль, — это
   * записано в аудите, второй копии не нужно.
   */
  async purgeExpiredPasswordResets(): Promise<number> {
    const result = await this.prisma.passwordResetToken.deleteMany({
      where: { OR: [{ expiresAt: { lte: new Date() } }, { usedAt: { not: null } }] },
    });
    if (result.count > 0) {
      this.logger.log({ count: result.count }, 'Удалены отработавшие ссылки восстановления пароля');
    }
    return result.count;
  }

  /** Ссылки подтверждения почты: истёкшие и использованные. */
  async purgeExpiredEmailVerifications(): Promise<number> {
    // Использованную держим сутки: повторное открытие той же ссылки отвечает
    // «почта подтверждена», а не «ссылка недействительна».
    const usedBefore = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const result = await this.prisma.emailVerificationToken.deleteMany({
      where: { OR: [{ expiresAt: { lte: new Date() } }, { usedAt: { lt: usedBefore } }] },
    });
    if (result.count > 0) {
      this.logger.log({ count: result.count }, 'Удалены отработавшие ссылки подтверждения почты');
    }
    return result.count;
  }

  /** Журнал писем старше срока — как аудит, срок в политике конфиденциальности. */
  async purgeOldMailLogs(retentionDays: number): Promise<number> {
    const threshold = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
    const result = await this.prisma.mailLog.deleteMany({
      where: { createdAt: { lt: threshold } },
    });
    if (result.count > 0) {
      this.logger.log({ count: result.count }, 'Удалены старые записи журнала писем');
    }
    return result.count;
  }

  /**
   * Браузеры, из которых не входили дольше срока. Столько же живёт cookie
   * `sk_device`: браузер, чья метка истекла, уже не узнать, и запись о нём
   * бесполезна — вход из него всё равно придёт письмом «новое устройство».
   */
  async purgeStaleDevices(retentionDays: number): Promise<number> {
    const threshold = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
    const result = await this.prisma.knownDevice.deleteMany({
      where: { lastSeenAt: { lt: threshold } },
    });
    if (result.count > 0) {
      this.logger.log({ count: result.count }, 'Удалены давно не входившие браузеры');
    }
    return result.count;
  }

  /**
   * Отметки о письмах про новые редакции — доказательство уведомления, как
   * журнал согласий, и хранятся столько же.
   */
  async purgeOldLegalNotices(retentionDays: number): Promise<number> {
    const threshold = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
    const result = await this.prisma.legalUpdateNotice.deleteMany({
      where: { sentAt: { lt: threshold } },
    });
    if (result.count > 0) {
      this.logger.log({ count: result.count }, 'Удалены старые отметки о письмах про редакции');
    }
    return result.count;
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

  /**
   * Лишние активные площадки после окончания платного тарифа.
   *
   * Подключить вторую площадку на тарифе с одной нельзя, но кончиться тариф
   * может у того, кто подключил её, пока имел право. Отбирать подключение
   * (удалять канал с токенами и метриками) за неоплату нельзя — это его данные;
   * поэтому обе площадки остаются, а работает одна. Здесь и решается, какая:
   * самая старая, то есть подключённая первой. Стример вправе переключить
   * (`PlatformConnectionService.setEnabled`).
   *
   * Ночью, а не в момент окончания периода: статус подписки нигде не хранится и
   * никем не переключается (`docs/adr/0011`), а сутки лишней работы второй
   * площадки — не та цена, за которую стоит заводить ещё одно расписание.
   *
   * @returns сколько каналов выключено.
   */
  async enforcePlatformLimits(now = new Date()): Promise<number> {
    const users = await this.prisma.user.findMany({
      where: { channels: { some: { isEnabled: true } } },
      select: {
        id: true,
        status: true,
        subscription: { select: { plan: true, currentPeriodEnd: true, autoRenew: true } },
        channels: {
          where: { isEnabled: true },
          orderBy: { createdAt: 'asc' },
          select: { id: true, platform: true },
        },
      },
    });

    let disabled = 0;
    for (const user of users) {
      // Без настроенной оплаты лимитов нет вовсе: так в разработке и в
      // самостоятельной установке, где продавать некому.
      const limit = this.config.billing
        ? PLAN_FEATURES[effectivePlan(user.subscription, now)].platforms
        : null;
      if (limit === null || user.channels.length <= limit) continue;

      const extra = user.channels.slice(limit);
      await this.prisma.channel.updateMany({
        where: { id: { in: extra.map((channel) => channel.id) } },
        data: { isEnabled: false },
      });
      disabled += extra.length;
      await this.audit.record('integration.channel.toggled', user.id, {
        metadata: {
          platforms: extra.map((channel) => channel.platform.toLowerCase()),
          isEnabled: false,
          reason: 'plan_limit',
        },
      });
      this.logger.log({ userId: user.id, count: extra.length }, 'Площадки сверх тарифа выключены');
    }
    return disabled;
  }

  /**
   * Продвинутое оформление у тех, чей платный тариф уже кончился.
   *
   * Урезает его `applyPlanToConfig` на выходе к оверлею, но открытая в OBS сцена
   * конфиг не перезапрашивает: она получила его при подключении и живёт весь
   * эфир. Без этого шага стример, у которого «Про» кончился ночью, до
   * перезапуска сцены видел бы в кадре оформление, за которое больше не платит.
   *
   * Берутся только владельцы с ИСТЁКШЕЙ подпиской, а не все, у кого тарифа нет:
   * у остальных оверлеи и так получили базовый конфиг, и рассылать им нечего.
   * И только истёкшей недавно: тариф кончается в конце периода или льготных
   * дней, а дальше любая открытая сцена уже подключалась с базовым конфигом.
   * Без нижней границы каждый, у кого «Про» кончился хоть год назад, получал бы
   * рассылку каждую ночь — и перерисовку оверлея посреди эфира вместе с ней.
   * Запас в неделю поверх льготных дней переживает несколько пропущенных ночей.
   *
   * @returns сколько виджетов переопубликовано.
   */
  async refreshStyling(now = new Date()): Promise<number> {
    if (!this.config.billing) return 0;

    const users = await this.prisma.user.findMany({
      where: {
        subscription: {
          currentPeriodEnd: {
            lt: now,
            gt: new Date(now.getTime() - (GRACE_DAYS + REFRESH_STYLING_SLACK_DAYS) * DAY_MS),
          },
        },
        widgets: { some: {} },
      },
      select: {
        id: true,
        subscription: { select: { plan: true, currentPeriodEnd: true, autoRenew: true } },
        widgets: { select: { id: true, type: true, isEnabled: true, config: true } },
      },
    });

    let republished = 0;
    for (const user of users) {
      const features = PLAN_FEATURES[effectivePlan(user.subscription, now)];
      if (features.advancedStyling) continue;

      for (const widget of user.widgets) {
        const type = toContractWidgetType(widget.type);
        const stored = configSchemaFor(type).safeParse(widget.config);
        if (!stored.success) continue;
        const basic = applyPlanToConfig(stored.data, features);
        // Ничего продвинутого в конфиге нет — и сообщение шины не нужно: оверлей
        // на него перерисовывается, а перерисовка в эфире не бесплатна.
        if (JSON.stringify(basic) === JSON.stringify(stored.data)) continue;

        // Приведение as: конфиг в сообщении шины типизирован объединением по
        // типу виджета, а урезание работает по полям и типа не знает.
        await this.bus.publish({
          kind: 'widget-config',
          userId: user.id,
          widgetId: widget.id,
          isEnabled: widget.isEnabled,
          type,
          config: basic,
        } as BusMessage);
        republished += 1;
      }
    }

    if (republished > 0) {
      this.logger.log({ count: republished }, 'Оформление виджетов приведено к тарифу');
    }
    return republished;
  }
}
