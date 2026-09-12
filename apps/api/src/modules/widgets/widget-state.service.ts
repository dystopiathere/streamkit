import { Injectable, Logger } from '@nestjs/common';
import type { Widget as PrismaWidget } from '@prisma/client';
import {
  type AlertEvent,
  donationSeconds,
  type GoalWidgetConfig,
  goalWidgetConfigSchema,
  timerWidgetConfigSchema,
  type TopDonorsPeriod,
  type TopDonorsWidgetConfig,
  topDonorsWidgetConfigSchema,
  type WidgetState,
} from '@streamkit/contracts';
import { z } from 'zod';
import { RealtimeBus } from '../../common/bus/realtime-bus.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { toPrismaEventType } from '../events/event.mappers';

/**
 * Сохранённое состояние виджета.
 *
 * Схемы живут здесь, а не в контрактах, сознательно: это внутреннее состояние
 * сервера, наружу оно уходит в другой форме (`WidgetState` — уже посчитанный
 * снимок). В контракты попадает то, что пересекает границу приложений, а не
 * всё подряд.
 */
const storedGoalSchema = z.object({
  /** Стартовая сумма: «собрали столько-то до запуска виджета». */
  offsetMinor: z.number().int().default(0),
});

const storedTimerSchema = z.object({
  endsAt: z.string().datetime({ offset: true }).nullable().default(null),
  pausedSeconds: z.number().int().nonnegative().nullable().default(null),
});

type StoredGoal = z.infer<typeof storedGoalSchema>;
type StoredTimer = z.infer<typeof storedTimerSchema>;

const PERIOD_MS: Record<Exclude<TopDonorsPeriod, 'all'>, number> = {
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
};

export type TimerAction = 'start' | 'pause' | 'reset' | 'add';

export interface TimerSnapshot {
  endsAt: string | null;
  pausedSeconds: number | null;
}

interface TimerBounds {
  nowMs: number;
  initialSeconds: number;
  maxSeconds: number;
  seconds: number;
}

/** Сколько осталось на часах прямо сейчас — идут они или стоят. */
function remainingSeconds(snapshot: TimerSnapshot, nowMs: number): number | null {
  if (snapshot.pausedSeconds !== null) return snapshot.pausedSeconds;
  if (!snapshot.endsAt) return null;
  return Math.max(0, Math.round((new Date(snapshot.endsAt).getTime() - nowMs) / 1000));
}

/**
 * Переход состояния таймера.
 *
 * Вынесено чистой функцией: вся логика марафона — это арифметика над двумя
 * полями, и проверять её удобнее без БД и без часов. Хранится момент окончания,
 * а не счётчик: счётчик в браузере уезжает на каждой подлагивающей сцене OBS,
 * а момент окончания переживает и перезагрузку сцены, и перезапуск сервера.
 */
export function applyTimerAction(
  snapshot: TimerSnapshot,
  action: TimerAction,
  bounds: TimerBounds,
): TimerSnapshot {
  const current = remainingSeconds(snapshot, bounds.nowMs);
  const running = snapshot.endsAt !== null;

  switch (action) {
    case 'start': {
      // Никогда не запускавшийся таймер стартует с настроенной длительности.
      const from = current ?? bounds.initialSeconds;
      return { endsAt: new Date(bounds.nowMs + from * 1000).toISOString(), pausedSeconds: null };
    }

    case 'pause':
      if (!running) return snapshot;
      return { endsAt: null, pausedSeconds: current ?? bounds.initialSeconds };

    case 'reset':
      // Сброс останавливает: иначе «сбросить» посреди марафона означало бы
      // запустить новый отсчёт, которого никто не просил.
      return { endsAt: null, pausedSeconds: bounds.initialSeconds };

    case 'add': {
      // Донат на незапущенный таймер не пропадает: часы заводятся с начальной
      // длительности, и уже к ней прибавляется время. Иначе первые донаты
      // марафона исчезали бы бесследно.
      const from = current ?? bounds.initialSeconds;
      const total = Math.min(from + bounds.seconds, bounds.maxSeconds);
      return running
        ? { endsAt: new Date(bounds.nowMs + total * 1000).toISOString(), pausedSeconds: null }
        : { endsAt: null, pausedSeconds: total };
    }
  }
}

/**
 * Состояние виджетов: то, что считает сервер, а не настраивает стример.
 *
 * Разделение с конфигом принципиальное. Конфиг — это «цель 100 000 рублей»,
 * состояние — «собрано 43 700». Смешать их значило бы переписывать
 * пользовательские настройки при каждом донате и при каждом тике таймера.
 *
 * Прогресс цели и топ донатеров СЧИТАЮТСЯ запросом, а не хранятся счётчиком.
 * Счётчик пришлось бы чинить руками после любого расхождения — удалённого
 * события, изменённой даты старта, пересозданного виджета; запрос по
 * индексированному (userId, createdAt) дёшев, а донаты приходят единицами в
 * минуту, а не тысячами в секунду.
 */
@Injectable()
export class WidgetStateService {
  private readonly logger = new Logger(WidgetStateService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly bus: RealtimeBus,
  ) {}

  /** Снимок состояния для оверлея. null — у типа состояния нет (алерты). */
  async compute(widget: PrismaWidget): Promise<WidgetState | null> {
    switch (widget.type) {
      case 'GOAL':
        return this.goalState(widget);
      case 'TIMER':
        return this.timerState(widget);
      case 'TOP_DONORS':
        return this.topDonorsState(widget);
      default:
        return null;
    }
  }

  /**
   * То же по идентификатору — для шлюза, который знает только id виджета.
   *
   * Лишний запрос здесь не жаль: он случается один раз на подключение
   * браузер-сорса, а альтернатива — протащить строку Prisma через границу
   * модуля realtime, который о Prisma знать не должен.
   */
  async computeById(widgetId: string): Promise<WidgetState | null> {
    const widget = await this.prisma.widget.findUnique({ where: { id: widgetId } });
    return widget ? this.compute(widget) : null;
  }

  /**
   * Реакция на записанное событие: пересчитать и разослать состояние.
   *
   * Одна точка на все типы, потому что один донат меняет сразу всё — сумму
   * цели, порядок в топе, остаток марафонского таймера, — а какие виджеты
   * открыты в OBS, отсюда не видно.
   */
  async onAlertEvent(userId: string, event: AlertEvent): Promise<void> {
    const widgets = await this.prisma.widget.findMany({
      where: { userId, isEnabled: true, type: { in: ['GOAL', 'TIMER', 'TOP_DONORS'] } },
    });

    for (const widget of widgets) {
      await this.reactTo(widget, event).catch((error: unknown) =>
        this.logger.warn({ err: error, widgetId: widget.id }, 'Не удалось разослать состояние'),
      );
    }
  }

  private async reactTo(widget: PrismaWidget, event: AlertEvent): Promise<void> {
    // Таймеру донат не просто меняет картинку, а двигает момент окончания —
    // это запись, а не пересчёт. Остальным типам достаточно посчитать заново.
    if (widget.type === 'TIMER') {
      await this.addDonationTime(widget, event);
      return;
    }
    await this.publish(widget);
  }

  async publish(widget: PrismaWidget): Promise<void> {
    const state = await this.compute(widget);
    if (!state) return;
    await this.bus.publish({ kind: 'widget-state', widgetId: widget.id, state });
  }

  /* ---------------------------------------------------------------- */
  /* Цель                                                               */
  /* ---------------------------------------------------------------- */

  /** Стартовая сумма цели. Ноль отличается от «не задано» только в интерфейсе. */
  async setGoalOffset(widget: PrismaWidget, offsetMinor: number): Promise<void> {
    await this.write(widget.id, { offsetMinor } satisfies StoredGoal);
    await this.publish(widget);
  }

  private async goalState(widget: PrismaWidget): Promise<WidgetState> {
    const config = goalWidgetConfigSchema.parse(widget.config);
    const stored = storedGoalSchema.parse((await this.read(widget.id)) ?? {});

    const raised = await this.raisedMinor(widget.userId, config);
    return {
      kind: 'goal',
      // Отрицательный итог невозможен по смыслу, но смещение задаёт человек.
      raisedMinor: Math.max(0, raised + stored.offsetMinor),
      targetMinor: config.targetMinor,
      currency: config.currency,
    };
  }

  /**
   * Сумма по цели.
   *
   * Фильтр по валюте обязателен и не является упрощением: сложить рубли с
   * долларами нельзя, а пересчитать по курсу значило бы показать зрителям
   * сумму, которой никто не жертвовал, и менять её задним числом вслед за
   * курсом. Донаты в других валютах в цель не идут — форма настроек об этом
   * говорит прямо.
   */
  private async raisedMinor(userId: string, config: GoalWidgetConfig): Promise<number> {
    const result = await this.prisma.alertEvent.aggregate({
      where: {
        userId,
        isTest: false,
        currency: config.currency,
        type: { in: config.countTypes.map(toPrismaEventType) },
        createdAt: { gte: new Date(config.startedAt) },
      },
      _sum: { amountMinor: true },
    });
    return result._sum.amountMinor ?? 0;
  }

  /* ---------------------------------------------------------------- */
  /* Таймер                                                             */
  /* ---------------------------------------------------------------- */

  private async timerState(widget: PrismaWidget): Promise<WidgetState> {
    const stored = storedTimerSchema.parse((await this.read(widget.id)) ?? {});
    const config = timerWidgetConfigSchema.parse(widget.config);

    // Ни разу не запускавшийся таймер — это не нулевой таймер, а остановленный
    // на начальной длительности. Иначе свежесозданный марафон показывает
    // зрителям 00:00:00, то есть выглядит уже закончившимся.
    const stopped = stored.endsAt === null && stored.pausedSeconds === null;

    return {
      kind: 'timer',
      endsAt: stored.endsAt,
      pausedSeconds: stopped ? config.initialSeconds : stored.pausedSeconds,
      // Часы машины с OBS расходятся с серверными на что угодно. Без этой
      // отметки оверлей не может вычислить поправку и врёт ровно на разницу.
      serverNow: new Date().toISOString(),
    };
  }

  /**
   * Команда управления таймером из дашборда или прилетевший донат.
   *
   * Ответом уходит уже пересчитанное состояние: дашборду не за чем делать
   * второй запрос, чтобы узнать результат собственного нажатия.
   */
  async applyTimerAction(
    widget: PrismaWidget,
    action: TimerAction,
    seconds = 0,
  ): Promise<WidgetState | null> {
    const config = timerWidgetConfigSchema.parse(widget.config);
    const next = applyTimerAction(await this.readTimer(widget.id), action, {
      nowMs: Date.now(),
      initialSeconds: config.initialSeconds,
      maxSeconds: config.maxSeconds,
      seconds,
    });

    await this.write(widget.id, next);
    const state = await this.compute(widget);
    if (state) await this.bus.publish({ kind: 'widget-state', widgetId: widget.id, state });
    return state;
  }

  /**
   * Донат добавляет время марафона.
   *
   * Условий три, и каждое существенно: событие должно быть нужного типа, в
   * валюте таймера (курс мы не считаем — см. цель) и не тестовым. Тестовый
   * алерт из дашборда не должен двигать реальный марафон.
   */
  private async addDonationTime(widget: PrismaWidget, event: AlertEvent): Promise<void> {
    const config = timerWidgetConfigSchema.parse(widget.config);

    const eligible =
      !event.isTest &&
      event.amount !== null &&
      event.amount.currency === config.currency &&
      config.countTypes.includes(event.type);
    if (!eligible) {
      // Состояние всё равно рассылаем: конфиг мог поменяться, а оверлей мог
      // переподключиться и не знать текущего остатка.
      await this.publish(widget);
      return;
    }

    const seconds = donationSeconds(event.amount?.amountMinor ?? 0, config.secondsPerUnit);
    if (seconds <= 0) {
      await this.publish(widget);
      return;
    }
    await this.applyTimerAction(widget, 'add', seconds);
  }

  /* ---------------------------------------------------------------- */
  /* Топ донатеров                                                      */
  /* ---------------------------------------------------------------- */

  private async topDonorsState(widget: PrismaWidget): Promise<WidgetState> {
    const config = topDonorsWidgetConfigSchema.parse(widget.config);
    return {
      kind: 'top-donors',
      currency: config.currency,
      entries: await this.topDonors(widget.userId, config),
    };
  }

  private async topDonors(userId: string, config: TopDonorsWidgetConfig) {
    const since =
      config.period === 'all' ? undefined : new Date(Date.now() - PERIOD_MS[config.period]);

    const rows = await this.prisma.alertEvent.groupBy({
      by: ['username'],
      where: {
        userId,
        isTest: false,
        currency: config.currency,
        amountMinor: { not: null },
        ...(since ? { createdAt: { gte: since } } : {}),
      },
      _sum: { amountMinor: true },
      _count: { _all: true },
      orderBy: { _sum: { amountMinor: 'desc' } },
      take: config.limit,
    });

    return rows.map((row) => ({
      username: row.username,
      amountMinor: row._sum.amountMinor ?? 0,
      count: row._count._all,
    }));
  }

  /* ---------------------------------------------------------------- */
  /* Хранилище                                                          */
  /* ---------------------------------------------------------------- */

  async read(widgetId: string): Promise<unknown> {
    const row = await this.prisma.widgetState.findUnique({ where: { widgetId } });
    return row?.state ?? null;
  }

  async write(widgetId: string, state: object): Promise<void> {
    await this.prisma.widgetState.upsert({
      where: { widgetId },
      create: { widgetId, state: state as never },
      update: { state: state as never },
    });
  }

  /** Текущее сохранённое состояние таймера — нужно командам управления. */
  async readTimer(widgetId: string): Promise<StoredTimer> {
    return storedTimerSchema.parse((await this.read(widgetId)) ?? {});
  }

  async writeTimer(widget: PrismaWidget, state: StoredTimer): Promise<void> {
    await this.write(widget.id, state);
    await this.publish(widget);
  }
}
