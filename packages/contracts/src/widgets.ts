import { z } from 'zod';
import {
  currencySchema,
  hexColorSchema,
  httpsUrlSchema,
  isoDateSchema,
  MINOR_UNITS_PER_MAJOR,
  uuidSchema,
} from './common.js';
import { chatChannelSchema, twitchLoginSchema } from './chat.js';
import { type AlertEvent, alertEventTypeSchema } from './events.js';

/** Типы виджетов. Новый тип = новая ветка в widgetConfigSchema + рендерер в packages/ui. */
export const WIDGET_TYPES = ['alerts', 'goal', 'timer', 'top-donors', 'chat'] as const;
export const widgetTypeSchema = z.enum(WIDGET_TYPES);
export type WidgetType = z.infer<typeof widgetTypeSchema>;

export const alertLayoutSchema = z.enum(['banner', 'center', 'side']);
export const alertAnimationSchema = z.enum(['fade', 'slide-up', 'slide-left', 'zoom', 'bounce']);

/**
 * Оформление текста. Общее для всех типов виджетов: задача у них одна — текст
 * поверх видео, где обводка не украшение, а единственный способ остаться
 * читаемым на светлом кадре.
 */
export const textStyleSchema = z.object({
  fontFamily: z.string().min(1).max(64).default('Inter'),
  fontSize: z.number().int().min(8).max(200).default(32),
  color: hexColorSchema.default('#FFFFFF'),
  highlightColor: hexColorSchema.default('#8B5CF6'),
  strokeColor: hexColorSchema.default('#000000'),
  strokeWidth: z.number().int().min(0).max(12).default(2),
  uppercase: z.boolean().default(false),
});
export type TextStyle = z.infer<typeof textStyleSchema>;

export const alertSoundSchema = z.object({
  enabled: z.boolean().default(false),
  url: httpsUrlSchema.nullable().default(null),
  volume: z.number().min(0).max(1).default(0.6),
});
export type AlertSound = z.infer<typeof alertSoundSchema>;

/**
 * Конфиг alert-виджета. Одна и та же схема валидирует запись в API, генерирует форму
 * настроек в дашборде и управляет рендером в overlay.
 */
export const alertWidgetConfigSchema = z.object({
  layout: alertLayoutSchema.default('center'),
  /** Сколько алерт висит на экране. */
  durationMs: z.number().int().min(1000).max(60000).default(6000),
  /** Пауза между алертами, чтобы они не слипались. */
  gapMs: z.number().int().min(0).max(10000).default(500),
  /** Алерты дешевле порога не показываются (0 — показывать все). */
  minAmountMinor: z.number().int().nonnegative().default(0),
  /** Какие типы событий этот виджет вообще показывает. */
  eventTypes: z.array(alertEventTypeSchema).min(1).default(['donation']),
  imageUrl: httpsUrlSchema.nullable().default(null),
  titleTemplate: z.string().min(1).max(200).default('{username} — {amount}'),
  messageTemplate: z.string().max(300).default('{message}'),
  text: textStyleSchema.prefault({}),
  sound: alertSoundSchema.prefault({}),
  animationIn: alertAnimationSchema.default('slide-up'),
  animationOut: alertAnimationSchema.default('fade'),
});
export type AlertWidgetConfig = z.infer<typeof alertWidgetConfigSchema>;

/* ------------------------------------------------------------------ */
/* Цель сбора                                                          */
/* ------------------------------------------------------------------ */

/**
 * Конфиг виджета цели.
 *
 * ОДНА валюта на цель, и это не упрощение. Сложить рубли с долларами нельзя, а
 * пересчитать по курсу — значит показать зрителям сумму, которой никто не
 * жертвовал, и менять её задним числом вслед за курсом. Донаты в других валютах
 * в цель не идут, и форма настроек говорит это прямо.
 */
export const goalWidgetConfigSchema = z.object({
  title: z.string().min(1).max(80).default('Цель'),
  targetMinor: z.number().int().positive().max(1_000_000_000).default(1_000_000),
  currency: currencySchema.default('RUB'),
  /**
   * С какого момента считаются донаты.
   *
   * Значение по умолчанию вычисляется в момент создания виджета: цель,
   * подключённая сегодня, не должна задним числом собрать всё, что пришло за
   * год. Стример может сдвинуть дату руками — например, на начало марафона.
   */
  startedAt: isoDateSchema.default(() => new Date().toISOString()),
  /** Какие события наполняют цель. Подписки часто считают наравне с донатами. */
  countTypes: z.array(alertEventTypeSchema).min(1).default(['donation']),
  showAmounts: z.boolean().default(true),
  barColor: hexColorSchema.default('#9167EA'),
  trackColor: hexColorSchema.default('#2A2B3680'),
  text: textStyleSchema.prefault({}),
});
export type GoalWidgetConfig = z.infer<typeof goalWidgetConfigSchema>;

/* ------------------------------------------------------------------ */
/* Таймер                                                              */
/* ------------------------------------------------------------------ */

export const timerWidgetConfigSchema = z.object({
  title: z.string().max(80).default(''),
  /** Сколько времени на часах при запуске и после сброса. */
  initialSeconds: z
    .number()
    .int()
    .min(0)
    .max(24 * 3600)
    .default(3600),
  /**
   * Сколько секунд добавляет одна МАЖОРНАЯ единица валюты — один рубль.
   *
   * Ноль означает «донаты время не добавляют»: таймер бывает нужен и просто как
   * отсчёт до начала эфира.
   */
  secondsPerUnit: z.number().int().min(0).max(3600).default(0),
  countTypes: z.array(alertEventTypeSchema).min(1).default(['donation']),
  currency: currencySchema.default('RUB'),
  /** Потолок: марафон, который нельзя продлить бесконечно одним крупным донатом. */
  maxSeconds: z
    .number()
    .int()
    .min(60)
    .max(30 * 24 * 3600)
    .default(24 * 3600),
  showHours: z.boolean().default(true),
  text: textStyleSchema.prefault({}),
});
export type TimerWidgetConfig = z.infer<typeof timerWidgetConfigSchema>;

/**
 * Сколько секунд добавляет донат.
 *
 * Арифметика ТОЛЬКО целочисленная: сумма приходит в минорных единицах, и
 * промежуточное деление во float — ровно тот случай, который правило 1
 * репозитория запрещает. Округление вниз в пользу стримера не работает, зато
 * работает предсказуемо: 99 копеек при ставке 1 секунда за рубль дают ноль.
 */
export function donationSeconds(amountMinor: number, secondsPerUnit: number): number {
  if (amountMinor <= 0 || secondsPerUnit <= 0) return 0;
  return Math.floor((amountMinor * secondsPerUnit) / MINOR_UNITS_PER_MAJOR);
}

/* ------------------------------------------------------------------ */
/* Топ донатеров                                                       */
/* ------------------------------------------------------------------ */

export const TOP_DONORS_PERIODS = ['24h', '7d', '30d', 'all'] as const;
export const topDonorsPeriodSchema = z.enum(TOP_DONORS_PERIODS);
export type TopDonorsPeriod = z.infer<typeof topDonorsPeriodSchema>;

/**
 * Конфиг виджета топа донатеров.
 *
 * Периода «за эфир» здесь нет намеренно: донат приходит из DonationAlerts или
 * собственного вебхука, которые про канал площадки ничего не знают, и при двух
 * подключённых каналах «эфир» просто не определён. То же решение уже принято
 * для сводки донатов в аналитике — выдумывать связь, которой нет в данных,
 * хуже, чем её не показывать.
 */
export const topDonorsWidgetConfigSchema = z.object({
  title: z.string().max(80).default('Топ донатеров'),
  period: topDonorsPeriodSchema.default('30d'),
  limit: z.number().int().min(1).max(10).default(5),
  currency: currencySchema.default('RUB'),
  showAmounts: z.boolean().default(true),
  text: textStyleSchema.prefault({}),
});
export type TopDonorsWidgetConfig = z.infer<typeof topDonorsWidgetConfigSchema>;

/* ------------------------------------------------------------------ */
/* Чат                                                                 */
/* ------------------------------------------------------------------ */

/**
 * Конфиг виджета чата.
 *
 * Канал задан ЗДЕСЬ, а не берётся из подключённой площадки, и это решение, а не
 * упрощение. Чтобы читать чат Twitch, достаточно логина: анонимный IRC не
 * требует ни OAuth, ни токена, ни зарегистрированного приложения. Значит,
 * виджет работает у стримера, который вообще не подключал аналитику, — а
 * приложение Twitch в этом проекте до сих пор не зарегистрировано. Форма
 * подставляет логин уже подключённого канала, если он есть.
 */
export const chatWidgetConfigSchema = z.object({
  channel: chatChannelSchema,
  /** Сколько строк держим на экране. Больше полусотни не читает никто. */
  maxMessages: z.number().int().min(1).max(50).default(20),
  /** Через сколько секунд строка гаснет. 0 — не гаснет вовсе. */
  messageLifetimeSeconds: z.number().int().min(0).max(3600).default(0),
  /** Новые сверху — для чата, закреплённого в верхнем углу кадра. */
  newestFirst: z.boolean().default(false),
  showBadges: z.boolean().default(true),
  showEmotes: z.boolean().default(true),
  /** Сообщения, начинающиеся с «!»: команды ботов зрителям не интересны. */
  hideCommands: z.boolean().default(true),
  /**
   * Кого не показывать. По умолчанию — привычные боты: их сообщения занимают
   * место в кадре, а адресованы механике канала, а не зрителям.
   */
  hiddenUsers: z.array(twitchLoginSchema).max(20).default(['nightbot', 'streamelements', 'moobot']),
  /** Ник цветом, который выбрал сам автор. Иначе — цветом подсветки виджета. */
  useAuthorColors: z.boolean().default(true),
  text: textStyleSchema.prefault({}),
});
export type ChatWidgetConfig = z.infer<typeof chatWidgetConfigSchema>;

/* ------------------------------------------------------------------ */
/* Объединение по типу                                                 */
/* ------------------------------------------------------------------ */

/** Дискриминированное объединение по типу виджета: добавление типа не ломает старые. */
export const widgetConfigSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('alerts'), config: alertWidgetConfigSchema }),
  z.object({ type: z.literal('goal'), config: goalWidgetConfigSchema }),
  z.object({ type: z.literal('timer'), config: timerWidgetConfigSchema }),
  z.object({ type: z.literal('top-donors'), config: topDonorsWidgetConfigSchema }),
  z.object({ type: z.literal('chat'), config: chatWidgetConfigSchema }),
]);
export type WidgetConfig = z.infer<typeof widgetConfigSchema>;

/**
 * Единственное место соответствия «тип виджета → схема его конфига».
 *
 * Нужно потому, что тип виджета известен только в рантайме: он лежит в БД, а
 * не в сигнатуре. Раньше во всех таких местах стояла `alertWidgetConfigSchema`
 * — шесть вхождений в одном сервисе, и каждое пришлось бы править под новый
 * тип. Запись Record обязывает компилятор напомнить о новом типе здесь.
 */
export const WIDGET_CONFIG_SCHEMAS = {
  alerts: alertWidgetConfigSchema,
  goal: goalWidgetConfigSchema,
  timer: timerWidgetConfigSchema,
  'top-donors': topDonorsWidgetConfigSchema,
  chat: chatWidgetConfigSchema,
} as const satisfies Record<
  WidgetType,
  z.ZodType<Record<string, unknown>, Record<string, unknown>>
>;

/**
 * Тип результата намеренно широкий: конкретный тип виджета известен только в
 * рантайме, а `Record<string, unknown>` — минимум, которого хватает и форме
 * настроек в дашборде, и мержу конфига на сервере.
 */
export function configSchemaFor(
  type: WidgetType,
): z.ZodType<Record<string, unknown>, Record<string, unknown>> {
  return WIDGET_CONFIG_SCHEMAS[type];
}

/**
 * Есть ли у типа состояние, которое считает сервер.
 *
 * У алертов и чата его нет: их «состояние» — это поток событий, он ничего не
 * накапливает и восстанавливать его неоткуда. Спрашивать снимок у таких
 * виджетов бессмысленно, и дашборд не должен рисовать им блок управления.
 */
export function hasWidgetState(type: WidgetType): boolean {
  return type === 'goal' || type === 'timer' || type === 'top-donors';
}

export const widgetSchema = z
  .object({
    id: uuidSchema,
    userId: uuidSchema,
    name: z.string().min(1).max(80),
    isEnabled: z.boolean(),
    createdAt: isoDateSchema,
    updatedAt: isoDateSchema,
  })
  .and(widgetConfigSchema);
export type Widget = z.infer<typeof widgetSchema>;

export const createWidgetSchema = z
  .object({
    name: z.string().min(1).max(80),
  })
  .and(widgetConfigSchema);
export type CreateWidgetInput = z.infer<typeof createWidgetSchema>;

/**
 * Частичное обновление виджета.
 *
 * Конфиг здесь — свободная запись, а не схема конкретного типа, и это
 * осознанный размен. Тип виджета известен только серверу: он лежит в БД, а в
 * запросе его нет и быть не должно (иначе клиент мог бы прислать патч не от
 * того типа). Сервер накладывает патч на сохранённый конфиг и валидирует
 * результат ЦЕЛИКОМ схемой сохранённого типа — то есть строгость никуда не
 * делась, она просто осталась ровно в одном месте вместо двух расходящихся.
 */
export const updateWidgetSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  isEnabled: z.boolean().optional(),
  config: z.record(z.string(), z.unknown()).optional(),
});
export type UpdateWidgetInput = z.infer<typeof updateWidgetSchema>;

/**
 * Публичная ссылка на виджет для браузер-сорса OBS — то, что видно в дашборде.
 *
 * Сам токен здесь отсутствует: он показывается ровно один раз при выпуске, в
 * БД лежит только хэш. Схема живёт в контрактах, потому что пересекает границу
 * приложений — раньше этот тип был объявлен дважды, на бэкенде и на фронте,
 * и новое поле в ответе молча не доезжало до интерфейса.
 */
export const overlayTokenViewSchema = z.object({
  id: uuidSchema,
  label: z.string().max(80).nullable(),
  createdAt: isoDateSchema,
  /** Когда оверлей последний раз подключался. null — ни разу. */
  lastSeenAt: isoDateSchema.nullable(),
});
export type OverlayTokenView = z.infer<typeof overlayTokenViewSchema>;

/** Ответ на выпуск ссылки. Значение токена возвращается единственный раз. */
export const createdOverlayTokenSchema = z.object({
  id: uuidSchema,
  url: z.string().url(),
});
export type CreatedOverlayToken = z.infer<typeof createdOverlayTokenSchema>;

/** Дефолтный конфиг для только что созданного виджета. */
export function defaultAlertWidgetConfig(): AlertWidgetConfig {
  return alertWidgetConfigSchema.parse({});
}

/** Дефолтный конфиг любого типа — для формы создания и для оверлея до bootstrap. */
export function defaultWidgetConfig(type: WidgetType): WidgetConfig {
  return widgetConfigSchema.parse({ type, config: {} });
}

/* ------------------------------------------------------------------ */
/* Состояние виджета                                                   */
/* ------------------------------------------------------------------ */

/**
 * Снимок состояния, который оверлей получает при подключении и при изменении.
 *
 * Отличается от конфига тем, что конфиг настраивает стример, а состояние
 * считает сервер: сколько собрано, кто в топе, до какого момента идёт отсчёт.
 * У alert-виджета состояния нет — его «состояние» это поток событий.
 */
export const goalStateSchema = z.object({
  kind: z.literal('goal'),
  /** Собрано с учётом стартовой суммы, в минорных единицах валюты цели. */
  raisedMinor: z.number().int().nonnegative(),
  targetMinor: z.number().int().positive(),
  currency: currencySchema,
  /**
   * Стартовая сумма, уже включённая в raisedMinor.
   *
   * Отдаётся отдельно, чтобы форма в дашборде могла показать заданное значение.
   * Без него поле всегда открывалось нулём, и сохранение настроек затирало
   * смещение — собранная сумма на экране падала без всякой причины.
   */
  offsetMinor: z.number().int(),
});
export type GoalState = z.infer<typeof goalStateSchema>;

/**
 * Состояние таймера.
 *
 * Оверлей тикает сам от `endsAt`, а не получает секунды по сокету: иначе минута
 * эфира стоила бы шестидесяти сообщений на каждый браузер-сорс. `serverNow`
 * обязателен — часы машины с OBS расходятся с серверными на что угодно, и без
 * поправки таймер врёт ровно на эту разницу.
 */
export const timerStateSchema = z.object({
  kind: z.literal('timer'),
  /** Момент окончания. null — таймер на паузе или ещё не запускался. */
  endsAt: isoDateSchema.nullable(),
  /** Остаток на паузе. null, когда таймер идёт. */
  pausedSeconds: z.number().int().nonnegative().nullable(),
  serverNow: isoDateSchema,
});
export type TimerState = z.infer<typeof timerStateSchema>;

export const topDonorEntrySchema = z.object({
  username: z.string().max(120),
  amountMinor: z.number().int().nonnegative(),
  count: z.number().int().positive(),
});
export type TopDonorEntry = z.infer<typeof topDonorEntrySchema>;

export const topDonorsStateSchema = z.object({
  kind: z.literal('top-donors'),
  currency: currencySchema,
  entries: z.array(topDonorEntrySchema),
});
export type TopDonorsState = z.infer<typeof topDonorsStateSchema>;

export const widgetStateSchema = z.discriminatedUnion('kind', [
  goalStateSchema,
  timerStateSchema,
  topDonorsStateSchema,
]);
export type WidgetState = z.infer<typeof widgetStateSchema>;

/**
 * Команда управления состоянием виджета из дашборда.
 *
 * Одна ручка на все типы, а не отдельная под каждый: команды различаются
 * дискриминантом, и добавление типа не плодит эндпоинтов, которые потом надо
 * помнить. Для алертов команд нет — их «состояние» это поток событий.
 */
export const widgetStateCommandSchema = z
  .discriminatedUnion('kind', [
    z.object({
      kind: z.literal('goal'),
      /** Стартовая сумма. Может быть отрицательной: цель бывает с долгом. */
      offsetMinor: z.number().int().min(-1_000_000_000).max(1_000_000_000),
    }),
    z.object({
      kind: z.literal('timer'),
      action: z.enum(['start', 'pause', 'reset', 'add']),
      /** Только для `add`. Секунды, а не минуты: сложение должно быть точным. */
      seconds: z
        .number()
        .int()
        .min(1)
        .max(24 * 3600)
        .optional(),
    }),
  ])
  // Проверка связи полей висит на объединении, а не на его ветке: ветка
  // дискриминированного объединения обязана оставаться ZodObject, иначе Zod
  // не может по ней разветвиться.
  .superRefine((value, ctx) => {
    if (value.kind === 'timer' && value.action === 'add' && value.seconds === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['seconds'],
        message: 'Для добавления времени нужно указать секунды',
      });
    }
  });
export type WidgetStateCommand = z.infer<typeof widgetStateCommandSchema>;

/** Доля выполнения цели от 0 до 1. Перебор не обрезается по смыслу, а по шкале. */
export function goalProgress(state: Pick<GoalState, 'raisedMinor' | 'targetMinor'>): number {
  if (state.targetMinor <= 0) return 0;
  return Math.min(state.raisedMinor / state.targetMinor, 1);
}

/**
 * Остаток таймера в секундах на заданный момент.
 *
 * Считается из `endsAt` и поправки на расхождение часов, а не из счётчика:
 * счётчик в браузере уезжает на каждой подлагивающей сцене OBS, а момент
 * окончания — нет.
 */
export function timerRemainingSeconds(state: TimerState, now: number, clockSkewMs = 0): number {
  if (state.pausedSeconds !== null) return state.pausedSeconds;
  if (!state.endsAt) return 0;
  return Math.max(0, Math.round((new Date(state.endsAt).getTime() - (now + clockSkewMs)) / 1000));
}

/** Часы:минуты:секунды. Часы прячутся, когда их не просили и когда их нет. */
export function formatDuration(totalSeconds: number, showHours = true): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;
  const pad = (value: number) => String(value).padStart(2, '0');

  return showHours || hours > 0
    ? `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`
    : `${pad(minutes)}:${pad(seconds)}`;
}

/* ------------------------------------------------------------------ */
/* Шаблоны текста                                                       */
/* ------------------------------------------------------------------ */

export const ALERT_TEMPLATE_VARS = ['username', 'amount', 'message', 'type'] as const;
export type AlertTemplateVar = (typeof ALERT_TEMPLATE_VARS)[number];

/**
 * Подстановка переменных в пользовательский шаблон.
 *
 * ВАЖНО: результат — обычный текст и вставляется только через textContent/JSX.
 * Никогда не рендерить его как HTML: шаблон пишет пользователь, а overlay открыт
 * по публичной ссылке.
 */
export function renderTemplate(
  template: string,
  vars: Partial<Record<AlertTemplateVar, string>>,
): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => {
    const value = vars[key as AlertTemplateVar];
    return value === undefined ? match : value;
  });
}

/**
 * Решение «показывать ли событие этим виджетом». Общая логика для бэкенда
 * (не слать лишнего в сокет) и overlay (страховка на клиенте).
 */
export function shouldShowAlert(
  event: Pick<AlertEvent, 'type' | 'amount' | 'isTest'>,
  config: Pick<AlertWidgetConfig, 'eventTypes' | 'minAmountMinor'>,
): boolean {
  if (event.isTest) return true;
  if (!config.eventTypes.includes(event.type)) return false;
  if (config.minAmountMinor > 0) {
    if (!event.amount) return false;
    if (event.amount.amountMinor < config.minAmountMinor) return false;
  }
  return true;
}
