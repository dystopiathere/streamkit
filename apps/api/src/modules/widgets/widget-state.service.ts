import { randomInt, randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import type { Widget as PrismaWidget } from '@prisma/client';
import {
  type AlertEvent,
  type Currency,
  CURRENCIES,
  donationSeconds,
  type GoalWidgetConfig,
  donationSpins,
  goalWidgetConfigSchema,
  type LatestEvent,
  latestWidgetConfigSchema,
  pickRouletteSector,
  ROULETTE_HISTORY_LIMIT,
  type RouletteSpin,
  rouletteSpinSchema,
  rouletteWidgetConfigSchema,
  timerWidgetConfigSchema,
  type TopDonorsPeriod,
  type TopDonorsWidgetConfig,
  topDonorsWidgetConfigSchema,
  type WidgetState,
} from '@streamkit/contracts';
import { z } from 'zod';
import { RealtimeBus } from '../../common/bus/realtime-bus.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { RedisLock } from '../../common/redis/lock.service';
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

/**
 * История рулетки. Прокрут, который схема уже не читает (сектор переименовали
 * за пределы длины, схема поменялась), выбрасывается, а не роняет состояние:
 * история — справка для стримера, а не деньги.
 */
const storedRouletteSchema = z.object({
  spins: z.array(z.unknown()).default([]),
});

function readSpins(raw: unknown): RouletteSpin[] {
  const stored = storedRouletteSchema.safeParse(raw ?? {});
  if (!stored.success) return [];
  return stored.data.spins.flatMap((spin) => {
    const parsed = rouletteSpinSchema.safeParse(spin);
    return parsed.success ? [parsed.data] : [];
  });
}

type StoredGoal = z.infer<typeof storedGoalSchema>;
export type StoredTimer = z.infer<typeof storedTimerSchema>;

const PERIOD_MS: Record<Exclude<TopDonorsPeriod, 'all'>, number> = {
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
};

export type TimerAction = 'start' | 'pause' | 'reset' | 'add';

/** Блокировка на один виджет: соседние таймеры друг другу не мешают. */
function timerLockKey(widgetId: string): string {
  return `streamkit:lock:widget-timer:${widgetId}`;
}

/** Внутри блокировки два запроса к БД — секунды хватает с запасом. */
const TIMER_LOCK_TTL_MS = 5_000;

/** История рулетки дописывается под блокировкой: два доната в одну секунду — два прокрута. */
function rouletteLockKey(widgetId: string): string {
  return `streamkit:lock:widget-roulette:${widgetId}`;
}

/** Точность случайной точки внутри сектора: десятитысячные доли. */
const OFFSET_STEPS = 10_000;

/**
 * Где внутри сектора остановится стрелка: не у самых краёв.
 *
 * Стрелка на границе двух секторов выглядит спорной, даже если сервер знает,
 * какой выпал, — зрители спорят с тем, что видят. Поле в 15 % с каждой стороны
 * снимает спор, а случайная точка в середине не даёт колесу замирать
 * подозрительно одинаково.
 */
function spinOffset(): number {
  return 0.15 + (0.7 * randomInt(0, OFFSET_STEPS + 1)) / OFFSET_STEPS;
}

/**
 * Сколько оборотов до остановки: около одного в секунду прокрута, но не меньше
 * трёх — медленное колесо читается как «решили заранее».
 */
function spinTurns(durationMs: number): number {
  return Math.max(3, Math.round(durationMs / 1000)) + randomInt(0, 2);
}

/** Криптографически стойкое число из [0, 1) для выбора сектора. */
function secureRandom(): number {
  return randomInt(0, 2 ** 48 - 1) / 2 ** 48;
}

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
      // Потолок обрезает ПРИБАВКУ, а не сам таймер. Начальная длительность и
      // потолок задаются независимо, и «не больше шести часов» легко поставить
      // марафону, заведённому на двенадцать. Без нижней границы первый же донат
      // срезал бы такой таймер вдвое на глазах зрителей — то есть донат отнимал
      // бы время вместо того, чтобы его добавлять.
      const total = Math.max(from, Math.min(from + bounds.seconds, bounds.maxSeconds));
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
    private readonly lock: RedisLock,
  ) {}

  /**
   * Снимок состояния для оверлея. null — у типа состояния нет (алерты).
   *
   * `currency` — уже посчитанная основная валюта владельца: реакция на донат
   * считает её один раз на все виджеты, а не по разу на каждый.
   */
  async compute(widget: PrismaWidget, currency?: Currency): Promise<WidgetState | null> {
    switch (widget.type) {
      case 'GOAL':
        return this.goalState(widget, currency);
      case 'TIMER':
        return this.timerState(widget, currency);
      case 'TOP_DONORS':
        return this.topDonorsState(widget, currency);
      case 'LATEST':
        return this.latestState(widget);
      case 'ROULETTE':
        return { kind: 'roulette', spins: readSpins(await this.read(widget.id)) };
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
   * Основная валюта донатов владельца — в ней считают цель, таймер и топ.
   *
   * Валюту не выбирает стример: она приходит с событием. Сложить рубли с
   * долларами нельзя, а курс мы не считаем (см. цель), поэтому виджеты берут
   * валюту, в которой донатов больше всего, а остальные в сумму не идут.
   * Пока донатов нет — рубли: аудитория сервиса русскоязычная.
   *
   * Считается по всей истории, а не за период: иначе один долларовый донат
   * в тихую неделю переключал бы цель на доллары прямо посреди сбора.
   */
  async primaryCurrency(userId: string): Promise<Currency> {
    const rows = await this.prisma.alertEvent.groupBy({
      by: ['currency'],
      where: { userId, isTest: false, currency: { not: null } },
      _count: { _all: true },
      // Вторая сортировка — по коду: при равенстве валюта не должна
      // переключаться от запроса к запросу.
      orderBy: [{ _count: { currency: 'desc' } }, { currency: 'asc' }],
      take: 1,
    });
    const currency = rows[0]?.currency;
    return currency && (CURRENCIES as readonly string[]).includes(currency)
      ? (currency as Currency)
      : 'RUB';
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
      where: {
        userId,
        isEnabled: true,
        type: { in: ['GOAL', 'TIMER', 'TOP_DONORS', 'LATEST', 'ROULETTE'] },
      },
    });
    if (widgets.length === 0) return;

    // Основная валюта считается по всей истории донатов — один раз на событие,
    // а не на каждый виджет: цель, таймер и топ одного стримера делили бы три
    // одинаковых прохода по всем его событиям на каждый донат.
    const currency = await this.primaryCurrency(userId);
    for (const widget of widgets) {
      await this.reactTo(widget, event, currency).catch((error: unknown) =>
        this.logger.warn({ err: error, widgetId: widget.id }, 'Не удалось разослать состояние'),
      );
    }
  }

  private async reactTo(
    widget: PrismaWidget,
    event: AlertEvent,
    currency: Currency,
  ): Promise<void> {
    // Таймеру донат не просто меняет картинку, а двигает момент окончания —
    // это запись, а не пересчёт. Остальным типам достаточно посчитать заново.
    if (widget.type === 'TIMER') {
      await this.addDonationTime(widget, event, currency);
      return;
    }
    // Последнее событие меняет только событие своего типа, а тестовое — никакое:
    // «Тестовый зритель» висел бы в кадре последним донатом до настоящего.
    if (widget.type === 'LATEST') {
      const config = latestWidgetConfigSchema.parse(widget.config);
      if (event.isTest || event.type !== config.eventType) return;
      await this.publish(widget);
      return;
    }
    // Рулетку крутит донат не меньше цены прокрута. Тестовый донат — нет:
    // «Проверить в OBS» проверяет оповещение, а колесо проверяют кнопкой прокрута.
    if (widget.type === 'ROULETTE') {
      const config = rouletteWidgetConfigSchema.parse(widget.config);
      if (event.isTest || event.type !== 'donation' || !donationSpins(config, event.amount)) {
        return;
      }
      await this.spinRoulette(widget, {
        source: 'donation',
        username: event.username,
        amount: event.amount,
      });
      return;
    }
    await this.publish(widget, currency);
  }

  async publish(widget: PrismaWidget, currency?: Currency): Promise<void> {
    const state = await this.compute(widget, currency);
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

  private async goalState(widget: PrismaWidget, known?: Currency): Promise<WidgetState> {
    const config = goalWidgetConfigSchema.parse(widget.config);
    const stored = storedGoalSchema.parse((await this.read(widget.id)) ?? {});

    const currency = known ?? (await this.primaryCurrency(widget.userId));
    const raised = await this.raisedMinor(widget.userId, config, currency);
    return {
      kind: 'goal',
      // Отрицательный итог невозможен по смыслу, но смещение задаёт человек.
      raisedMinor: Math.max(0, raised + stored.offsetMinor),
      targetMinor: config.targetMinor,
      currency,
      // Смещение отдаётся отдельно от суммы: иначе поле «стартовая сумма» в
      // дашборде нечем заполнить, оно всегда показывает ноль, и сохранение
      // формы затирает заданное значение.
      offsetMinor: stored.offsetMinor,
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
  private async raisedMinor(
    userId: string,
    config: GoalWidgetConfig,
    currency: Currency,
  ): Promise<number> {
    const result = await this.prisma.alertEvent.aggregate({
      where: {
        userId,
        isTest: false,
        currency,
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

  private async timerState(widget: PrismaWidget, currency?: Currency): Promise<WidgetState> {
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
      currency: currency ?? (await this.primaryCurrency(widget.userId)),
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
    currency?: Currency,
  ): Promise<WidgetState | null> {
    const config = timerWidgetConfigSchema.parse(widget.config);

    // Чтение и запись — под блокировкой, и это не перестраховка. Два доната в
    // одну секунду (два запроса к вебхуку либо вебхук и коннектор в воркере)
    // читают ОДИН снимок и оба пишут «плюс минуту» вместо «плюс две». У цели и
    // топа такого нет: они считаются запросом по событиям и сходятся сами. У
    // таймера состояние из событий не выводится, и потерянная минута марафона
    // не восстановится уже ничем.
    //
    // Снимок считается и публикуется ТОЖЕ под блокировкой. Иначе оверлей видел
    // гонку уже на выходе: первый донат записал «плюс минуту» и отпустил
    // блокировку, второй записал «плюс две» и опубликовал, а медленная публикация
    // первого приходила последней — и марафон на экране оказывался на минуту
    // короче записанного до следующего доната.
    return this.lock.withLockWaiting(timerLockKey(widget.id), TIMER_LOCK_TTL_MS, async () => {
      const next = applyTimerAction(await this.readTimer(widget.id), action, {
        nowMs: Date.now(),
        initialSeconds: config.initialSeconds,
        maxSeconds: config.maxSeconds,
        seconds,
      });
      await this.write(widget.id, next);

      const state = await this.compute(widget, currency);
      if (state) await this.bus.publish({ kind: 'widget-state', widgetId: widget.id, state });
      return state;
    });
  }

  /**
   * Донат добавляет время марафона.
   *
   * Условий три, и каждое существенно: событие должно быть нужного типа, в
   * основной валюте донатов (курс мы не считаем — см. цель) и не тестовым. Тестовый
   * алерт из дашборда не должен двигать реальный марафон.
   */
  private async addDonationTime(
    widget: PrismaWidget,
    event: AlertEvent,
    currency: Currency,
  ): Promise<void> {
    const config = timerWidgetConfigSchema.parse(widget.config);

    const eligible =
      !event.isTest &&
      event.amount !== null &&
      config.countTypes.includes(event.type) &&
      event.amount.currency === currency;
    if (!eligible) {
      // Состояние всё равно рассылаем: конфиг мог поменяться, а оверлей мог
      // переподключиться и не знать текущего остатка.
      await this.publish(widget, currency);
      return;
    }

    const seconds = donationSeconds(event.amount?.amountMinor ?? 0, config.secondsPerUnit);
    if (seconds <= 0) {
      await this.publish(widget, currency);
      return;
    }
    await this.applyTimerAction(widget, 'add', seconds, currency);
  }

  /* ---------------------------------------------------------------- */
  /* Топ донатеров                                                      */
  /* ---------------------------------------------------------------- */

  private async topDonorsState(widget: PrismaWidget, known?: Currency): Promise<WidgetState> {
    const config = topDonorsWidgetConfigSchema.parse(widget.config);
    const currency = known ?? (await this.primaryCurrency(widget.userId));
    return {
      kind: 'top-donors',
      currency,
      entries: await this.topDonors(widget.userId, config, currency),
    };
  }

  private async topDonors(userId: string, config: TopDonorsWidgetConfig, currency: Currency) {
    const since =
      config.period === 'all' ? undefined : new Date(Date.now() - PERIOD_MS[config.period]);

    const rows = await this.prisma.alertEvent.groupBy({
      by: ['username'],
      where: {
        userId,
        isTest: false,
        currency,
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
  /* Последнее событие                                                  */
  /* ---------------------------------------------------------------- */

  private async latestState(widget: PrismaWidget): Promise<WidgetState> {
    const config = latestWidgetConfigSchema.parse(widget.config);
    const row = await this.prisma.alertEvent.findFirst({
      where: { userId: widget.userId, isTest: false, type: toPrismaEventType(config.eventType) },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    const event: LatestEvent | null = row
      ? {
          type: config.eventType,
          username: row.username,
          message: row.message,
          amount:
            row.amountMinor !== null && row.currency
              ? { amountMinor: row.amountMinor, currency: row.currency as Currency }
              : null,
          count: row.count,
          createdAt: row.createdAt.toISOString(),
        }
      : null;
    return { kind: 'latest', event };
  }

  /* ---------------------------------------------------------------- */
  /* Рулетка                                                            */
  /* ---------------------------------------------------------------- */

  /**
   * Прокрут: выбрать сектор, записать в историю, разослать.
   *
   * Сектор выбирает сервер, а не оверлей: у двух сцен OBS с одной ссылкой
   * выпадало бы разное, и стример не знал бы, что обещано зрителям. Прокрут
   * уходит отдельным сообщением шины, история — состоянием: состояние приходит
   * и при переподключении, и прокрут в нём крутился бы заново.
   */
  async spinRoulette(
    widget: PrismaWidget,
    trigger: Pick<RouletteSpin, 'source' | 'username' | 'amount'>,
  ): Promise<RouletteSpin> {
    const config = rouletteWidgetConfigSchema.parse(widget.config);
    const index = pickRouletteSector(config.sectors, secureRandom());
    const sector = config.sectors[index]!;
    const spin: RouletteSpin = {
      id: randomUUID(),
      sectorId: sector.id,
      sectorIndex: index,
      label: sector.label,
      color: sector.color,
      offset: spinOffset(),
      turns: spinTurns(config.spinDurationMs),
      ...trigger,
      createdAt: new Date().toISOString(),
    };

    // История дописывается под блокировкой: два доната в одну секунду читают
    // один список, и без неё второй прокрут затирал бы первый.
    const spins = await this.lock.withLockWaiting(
      rouletteLockKey(widget.id),
      TIMER_LOCK_TTL_MS,
      async () => {
        const next = [spin, ...readSpins(await this.read(widget.id))].slice(
          0,
          ROULETTE_HISTORY_LIMIT,
        );
        await this.write(widget.id, { spins: next });
        return next;
      },
    );

    await this.bus.publish({ kind: 'roulette-spin', widgetId: widget.id, spin });
    await this.bus.publish({
      kind: 'widget-state',
      widgetId: widget.id,
      state: { kind: 'roulette', spins },
    });
    return spin;
  }

  /**
   * Стереть историю прокрутов. В ней имена донатеров и суммы, поэтому она
   * уходит и вместе с историей событий, а не только по кнопке виджета.
   */
  async clearRouletteHistory(widget: PrismaWidget): Promise<WidgetState> {
    await this.lock.withLockWaiting(rouletteLockKey(widget.id), TIMER_LOCK_TTL_MS, () =>
      this.write(widget.id, { spins: [] }),
    );
    const state: WidgetState = { kind: 'roulette', spins: [] };
    await this.bus.publish({ kind: 'widget-state', widgetId: widget.id, state });
    return state;
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
}
