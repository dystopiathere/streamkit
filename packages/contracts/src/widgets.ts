import { z } from 'zod';
import {
  type Currency,
  currencySchema,
  hexColorSchema,
  httpsUrlSchema,
  isoDateSchema,
  isVideoUrl,
  MINOR_UNITS_PER_MAJOR,
  type Money,
  moneySchema,
  uuidSchema,
} from './common.js';
import { type PlanFeatures } from './billing.js';
import { CHAT_PLATFORMS, type ChatPlatform } from './chat.js';
import { GUEST_LAYOUTS, MAX_GUESTS_PER_ROOM } from './rooms.js';
import {
  type AlertEvent,
  type AlertEventType,
  alertEventSchema,
  alertEventTypeSchema,
} from './events.js';

/** Типы виджетов. Новый тип = новая ветка в widgetConfigSchema + рендерер в packages/ui. */
export const WIDGET_TYPES = [
  'alerts',
  'goal',
  'timer',
  'top-donors',
  'chat',
  'guests',
  'latest',
  'roulette',
] as const;
export const widgetTypeSchema = z.enum(WIDGET_TYPES);
export type WidgetType = z.infer<typeof widgetTypeSchema>;

export const alertLayoutSchema = z.enum(['banner', 'center', 'side']);

/**
 * Анимации появления и ухода алерта.
 *
 * Первые пять — на любом тарифе, остальные входят в продвинутое оформление
 * (`PLAN_FEATURES.advancedStyling`). Порядок здесь значим: `BASIC_ALERT_ANIMATIONS`
 * отрезается от начала, а `applyPlanToConfig` заменяет продвинутую анимацию
 * базовой, а не выбрасывает алерт целиком.
 */
export const ALERT_ANIMATIONS = [
  'fade',
  'slide-up',
  'slide-left',
  'zoom',
  'bounce',
  'slide-down',
  'slide-right',
  'pop',
  'flip',
  'shake',
  'swing',
] as const;
export const BASIC_ALERT_ANIMATIONS = ALERT_ANIMATIONS.slice(0, 5) as readonly AlertAnimation[];
export const alertAnimationSchema = z.enum(ALERT_ANIMATIONS);
export type AlertAnimation = (typeof ALERT_ANIMATIONS)[number];

/**
 * Шрифты, которые платформа отдаёт сама (`@streamkit/ui/fonts`).
 *
 * Список закрытый, и это не ограничение ради ограничения: шрифт, которого нет
 * на машине с OBS, молча подменяется системным — а машина с OBS не наша. Своими
 * файлами шрифт гарантированно есть и в предпросмотре, и в кадре.
 */
export const FONT_FAMILIES = [
  'Inter',
  'Roboto',
  'Montserrat',
  'Oswald',
  'Rubik',
  'Unbounded',
  'Merriweather',
  'Caveat',
] as const;
export type FontFamily = (typeof FONT_FAMILIES)[number];

/**
 * Оформление текста. Общее для всех типов виджетов: задача у них одна — текст
 * поверх видео, где обводка не украшение, а единственный способ остаться
 * читаемым на светлом кадре.
 */
export const textStyleSchema = z.object({
  // `catch`, а не просто enum: до появления своих шрифтов поле было свободной
  // строкой, и в сохранённых конфигах может лежать «Arial». Такой шрифт и раньше
  // подменялся системным на машине с OBS — теперь он подменяется явно, а не
  // роняет чтение всего конфига.
  fontFamily: z.enum(FONT_FAMILIES).catch('Inter').default('Inter'),
  fontSize: z.number().int().min(8).max(200).default(32),
  color: hexColorSchema.default('#FFFFFF'),
  highlightColor: hexColorSchema.default('#8B5CF6'),
  strokeColor: hexColorSchema.default('#000000'),
  strokeWidth: z.number().int().min(0).max(12).default(2),
  uppercase: z.boolean().default(false),
});
export type TextStyle = z.infer<typeof textStyleSchema>;

/* ------------------------------------------------------------------ */
/* Продвинутое оформление: раскладка, цвета по элементам, фон           */
/* ------------------------------------------------------------------ */

/**
 * Элемент кадра: где он стоит и чем отличается от общего оформления текста.
 *
 * Позиция — ПРОЦЕНТЫ кадра, а не пиксели: размер браузер-сорса в OBS задаёт
 * стример, и один и тот же виджет живёт в кадре 1920×1080 и в углу 400×200.
 * Пиксельные координаты разъехались бы у каждого по-своему, и «поправить» их
 * было бы нечем — в дашборде размера кадра не знают.
 *
 * `null` значит «как раньше»: позиция — в обычном потоке (виджет остаётся таким,
 * каким был до появления раскладки), цвет и размер — общие из `text`. Пустой
 * объект — обратная совместимость сохранённых конфигов и вид на бесплатном
 * тарифе: `applyPlanToConfig` возвращает слоты именно в это состояние.
 */
export const widgetSlotSchema = z.object({
  x: z.number().min(0).max(100).nullable().default(null),
  y: z.number().min(0).max(100).nullable().default(null),
  color: hexColorSchema.nullable().default(null),
  fontSize: z.number().int().min(8).max(200).nullable().default(null),
  /**
   * Ширина элемента в пикселях окна — у картинки оповещения; высота следует
   * за пропорциями картинки. null — прежний размер «не больше 320 × 240».
   */
  width: z.number().int().min(16).max(3840).nullable().default(null),
});
export type WidgetSlot = z.infer<typeof widgetSlotSchema>;

/** Пустой слот — им же `applyPlanToConfig` заменяет настроенные без тарифа. */
export const EMPTY_SLOT: WidgetSlot = {
  x: null,
  y: null,
  color: null,
  fontSize: null,
  width: null,
};

/**
 * Схема набора слотов по их именам.
 *
 * Имена — у каждого типа свои (у цели полоса, у таймера часы), поэтому набор
 * строится из списка, а не объявляется общим объектом: лишний слот в форме
 * настроек означал бы элемент, которого в кадре нет.
 */
function slotsSchema<T extends string>(slots: readonly T[]) {
  // Значение по умолчанию (`prefault({})`) ставится на месте применения, а не
  // здесь: внутри обобщённой функции набор ключей ещё неизвестен, и пустой объект
  // не проходит проверку типов.
  return z.object(
    Object.fromEntries(slots.map((slot) => [slot, widgetSlotSchema.prefault({})])) as {
      [K in T]: z.ZodPrefault<typeof widgetSlotSchema>;
    },
  );
}

/**
 * Окно, в котором рисуется виджет: ширина и высота браузер-сорса в OBS, в
 * пикселях.
 *
 * Позиции элементов — проценты окна, а шрифты и картинки — пиксели. Пока окно
 * было «каким откроют», одна и та же раскладка в редакторе и в OBS другого
 * размера расходилась: элементы, выставленные рядом, в сорсе 800×600 и
 * 1920×1080 стояли по-разному относительно друг друга. С заданным окном виджет
 * рисуется ровно в нём, а в сорсе другого размера — масштабируется целиком,
 * без искажения композиции.
 *
 * `null` — окно не задано, виджет растягивается на весь сорс, как было раньше.
 * Так читаются виджеты, настроенные до появления окна (миграция пишет им
 * `null`): дать им 800×600 значило бы увеличить весь текст у того, чей сорс
 * 1920×1080, прямо посреди эфира. Новые виджеты создаются с 800×600.
 */
export const widgetCanvasSchema = z.object({
  width: z.number().int().min(100).max(3840),
  height: z.number().int().min(100).max(2160),
});
export type WidgetCanvas = z.infer<typeof widgetCanvasSchema>;

export const DEFAULT_WIDGET_CANVAS: WidgetCanvas = { width: 800, height: 600 };

/** Поле окна в конфиге: у всех типов одно и то же. */
const canvasField = () =>
  widgetCanvasSchema.nullable().default(() => ({ ...DEFAULT_WIDGET_CANVAS }));

/**
 * Суммы по валютам в минорных единицах: порог показа, цена прокрута.
 *
 * Ноль и отсутствие ключа значат одно и то же («порога нет», «в этой валюте не
 * крутим»), поэтому ноль на разборе выбрасывается, а не хранится. Без этого у
 * одной и той же настройки два написания, и редактор считает форму изменённой
 * после того, как сумму стёрли обратно: поле шлёт ноль, а в сохранённом конфиге
 * ключа просто нет. Сравнивать «что уйдёт на сервер» можно только с одним
 * написанием.
 */
function currencyAmounts() {
  return z
    .partialRecord(currencySchema, z.number().int().nonnegative().optional())
    .transform((amounts): Partial<Record<Currency, number>> => {
      const result: Partial<Record<Currency, number>> = {};
      for (const [currency, amount] of Object.entries(amounts) as [
        Currency,
        number | undefined,
      ][]) {
        if (typeof amount === 'number' && amount > 0) result[currency] = amount;
      }
      return result;
    });
}

/** Частые размеры браузер-сорса — подсказка в редакторе, не ограничение. */
export const CANVAS_PRESETS: readonly WidgetCanvas[] = [
  { width: 800, height: 600 },
  { width: 1280, height: 720 },
  { width: 1920, height: 1080 },
  { width: 600, height: 200 },
  { width: 400, height: 800 },
];

export const ALERT_SLOTS = ['image', 'title', 'message'] as const;
export const GOAL_SLOTS = ['title', 'bar', 'amount'] as const;
export const TIMER_SLOTS = ['title', 'clock'] as const;
export const TOP_DONORS_SLOTS = ['title', 'list'] as const;
export const LATEST_SLOTS = ['title', 'value', 'message'] as const;
export const ROULETTE_SLOTS = ['title', 'wheel', 'result'] as const;

/**
 * У каких типов есть фон.
 *
 * У гостей его нет: кадр занимают плитки с видео, и подложка под ними не видна
 * ни при какой раскладке. Шрифт при этом настраивается и у них — имена гостей
 * подписаны в кадре.
 */
export function hasWidgetBackground(type: WidgetType): boolean {
  return type !== 'guests';
}

/** Имена элементов кадра по типу виджета. Чат и гости раскладку не получают. */
export const WIDGET_SLOTS = {
  alerts: ALERT_SLOTS,
  goal: GOAL_SLOTS,
  timer: TIMER_SLOTS,
  'top-donors': TOP_DONORS_SLOTS,
  latest: LATEST_SLOTS,
  roulette: ROULETTE_SLOTS,
} as const;

/**
 * Фон виджета: цвет, картинка и как её вписать.
 *
 * Прозрачный фон остаётся значением по умолчанию: виджет живёт поверх игры, и
 * непрозрачная подложка «по умолчанию» закрыла бы её первым же включением.
 */
export const BACKGROUND_FITS = ['cover', 'contain', 'tile'] as const;
export const widgetBackgroundSchema = z.object({
  color: hexColorSchema.nullable().default(null),
  imageUrl: httpsUrlSchema.nullable().default(null),
  fit: z.enum(BACKGROUND_FITS).default('cover'),
  opacity: z.number().min(0).max(1).default(1),
  cornerRadius: z.number().int().min(0).max(96).default(0),
});
export type WidgetBackground = z.infer<typeof widgetBackgroundSchema>;

/** Фон без картинки и цвета — вид на бесплатном тарифе. */
export const EMPTY_BACKGROUND: WidgetBackground = {
  color: null,
  imageUrl: null,
  fit: 'cover',
  opacity: 1,
  cornerRadius: 0,
};

/**
 * Откуда звук оповещения: отдельный файл (`url`) или звуковая дорожка видео
 * WebM из картинки сценария. Второе действует, только пока картинка — видео:
 * заменили её на PNG — звук снова берётся из файла.
 */
export const ALERT_SOUND_SOURCES = ['file', 'video'] as const;
export type AlertSoundSource = (typeof ALERT_SOUND_SOURCES)[number];

export const alertSoundSchema = z.object({
  enabled: z.boolean().default(false),
  source: z.enum(ALERT_SOUND_SOURCES).default('file'),
  url: httpsUrlSchema.nullable().default(null),
  volume: z.number().min(0).max(1).default(0.6),
});
export type AlertSound = z.infer<typeof alertSoundSchema>;

/**
 * Что и как звучит на оповещении — одно решение для оверлея и редактора.
 *
 * `video` — звук играет само видео картинки: так звук и картинка совпадают
 * по времени, а отдельная дорожка того же файла разъезжалась бы с ним на
 * десятки миллисекунд.
 */
export type AlertSoundPlan =
  | { kind: 'none' }
  | { kind: 'file'; url: string; volume: number }
  | { kind: 'video'; volume: number };

export function alertSoundPlan(scenario: {
  imageUrl: string | null;
  sound: AlertSound;
}): AlertSoundPlan {
  const { sound } = scenario;
  if (!sound.enabled) return { kind: 'none' };
  if (sound.source === 'video' && scenario.imageUrl && isVideoUrl(scenario.imageUrl)) {
    return { kind: 'video', volume: sound.volume };
  }
  return sound.url ? { kind: 'file', url: sound.url, volume: sound.volume } : { kind: 'none' };
}

/**
 * Сценарий оповещения — всё, что видит и слышит зритель на событии одного типа.
 *
 * Сценарий на тип, а не общие настройки на весь виджет: фолловер и донат на
 * тысячу рублей — события разного веса, и стример хочет для них разный текст,
 * картинку, звук и время на экране. Раньше настройки были одни на все типы, а
 * шаблон «{username} — {amount}» над фолловером оставлял висящее тире.
 *
 * Порогов два, и работает тот, что есть у события: `minAmounts` — у донатов
 * (деньги), `minCount` — у битов, рейдов и подарков (количество).
 *
 * Порог суммы — СВОЙ У КАЖДОЙ ВАЛЮТЫ, и это единственная настройка оповещений,
 * которая вообще знает о валюте. Донат сравнивается с порогом своей валюты как
 * пришёл, без пересчёта по курсу: раньше порог был одним числом, и «100»
 * отсекало одновременно 100 ₽ и 100 $ — то есть либо пропускало мелочь в
 * рублях, либо прятало крупные донаты в долларах. В самом оповещении сумма и
 * валюта показываются как пришли.
 */
const titleTemplateSchema = z.string().min(1).max(200);
const messageTemplateSchema = z.string().max(300);

/**
 * Вид оповещения — всё, что зритель видит и слышит, без порогов и включения.
 *
 * Отдельно от сценария, потому что ровно этот набор повторяет триггер: «донат
 * от тысячи выглядит так» — это другой вид при тех же порогах сценария.
 */
function alertAppearanceShape(
  titleTemplate: z.ZodDefault<z.ZodString>,
  messageTemplate: z.ZodDefault<z.ZodString>,
) {
  return {
    layout: alertLayoutSchema.default('center'),
    /** Сколько алерт висит на экране. */
    durationMs: z.number().int().min(1000).max(60000).default(6000),
    imageUrl: httpsUrlSchema.nullable().default(null),
    titleTemplate,
    messageTemplate,
    text: textStyleSchema.prefault({}),
    sound: alertSoundSchema.prefault({}),
    animationIn: alertAnimationSchema.default('slide-up'),
    animationOut: alertAnimationSchema.default('fade'),
    /** Раскладка и фон — у каждого сценария свои: донат и фолловер выглядят по-разному. */
    slots: slotsSchema(ALERT_SLOTS).prefault({}),
    background: widgetBackgroundSchema.prefault({}),
  };
}

/** Поля вида: их копирует новый триггер из сценария и их же он заменяет. */
export const ALERT_APPEARANCE_FIELDS = [
  'layout',
  'durationMs',
  'imageUrl',
  'titleTemplate',
  'messageTemplate',
  'text',
  'sound',
  'animationIn',
  'animationOut',
  'slots',
  'background',
] as const;

/**
 * Условие триггера на сумму доната.
 *
 * Сумма — в ОДНОЙ валюте, как и порог показа: донат в долларах не сравнивается
 * с условием в рублях, курс мы не считаем (см. цель). Такой донат проходит мимо
 * триггера и показывается видом сценария.
 *
 * «Между» — включительно с обеих сторон: «от 500 до 999» читается стримером
 * именно так, и донат ровно на 999 не должен выпасть из обоих соседних триггеров.
 */
export const TRIGGER_OPERATORS = ['gte', 'gt', 'eq', 'lte', 'lt', 'between'] as const;
export type TriggerOperator = (typeof TRIGGER_OPERATORS)[number];

const triggerAmountSchema = z.number().int().nonnegative().max(100_000_000_000);

export const alertTriggerConditionSchema = z
  .object({
    operator: z.enum(TRIGGER_OPERATORS).default('gte'),
    currency: currencySchema.default('RUB'),
    amountMinor: triggerAmountSchema.default(100_000),
    /** Верхняя граница — только у «между». */
    toMinor: triggerAmountSchema.nullable().default(null),
  })
  .refine(
    (condition) =>
      condition.operator !== 'between' ||
      (condition.toMinor !== null && condition.toMinor >= condition.amountMinor),
    { path: ['toMinor'], message: 'Верхняя граница должна быть не меньше нижней' },
  );
export type AlertTriggerCondition = z.infer<typeof alertTriggerConditionSchema>;

/** Сколько триггеров у сценария. Больше десятка ступеней на эфире не различить. */
export const MAX_ALERT_TRIGGERS = 20;

/**
 * Триггер: условие и свой вид оповещения.
 *
 * Вид — полный, а не «что поменять»: стример настраивает триггер как отдельное
 * оповещение, и частичное наследование («цвет свой, анимация общая») сделало бы
 * вид триггера зависимым от правок сценария, которых стример к нему не относил.
 * Новый триггер копирует вид сценария целиком (`ALERT_APPEARANCE_FIELDS`).
 */
export const alertTriggerSchema = z.object({
  /** Ключ для списка в форме: у триггеров нет порядка кроме приоритета, а он меняется. */
  id: z.string().min(1).max(64),
  name: z.string().trim().max(60).default(''),
  condition: alertTriggerConditionSchema.prefault({}),
  ...alertAppearanceShape(
    titleTemplateSchema.default('{username} — {amount}'),
    messageTemplateSchema.default('{message}'),
  ),
});
export type AlertTrigger = z.infer<typeof alertTriggerSchema>;

/**
 * Сценарий с шаблонами по умолчанию своего типа — под то, что у события есть:
 * у фолловера нет ни суммы, ни текста, у рейда есть число зрителей.
 */
function alertScenarioSchema(
  titleTemplate: z.ZodDefault<z.ZodString>,
  messageTemplate: z.ZodDefault<z.ZodString>,
) {
  return z
    .object({
      enabled: z.boolean().default(true),
      /**
       * Минимальная сумма по валютам, в минорных единицах. Нет ключа или 0 —
       * донаты в этой валюте показываются все. Значение `undefined` схема
       * принимает: так форма присылает валюту, поле которой не трогали.
       */
      minAmounts: currencyAmounts().default({}),
      /** События с меньшим количеством не показываются (0 — показывать все). */
      minCount: z.number().int().nonnegative().max(1_000_000).default(0),
      ...alertAppearanceShape(titleTemplate, messageTemplate),
      /**
       * Триггеры по сумме: вид для доната, подходящего под условие. Порядок —
       * приоритет: срабатывает ПЕРВЫЙ подошедший, остальные не проверяются.
       * Ни один не подошёл — вид самого сценария, то есть «донат по умолчанию».
       *
       * Порог показа (`minAmounts`) сильнее триггера: донат ниже порога не
       * показывается совсем, какой бы триггер под него ни подходил. Иначе
       * «не показывать мелочь» пришлось бы повторять в каждом триггере.
       *
       * В схеме — у каждого сценария, в редакторе — только у доната: сумма есть
       * только у него.
       */
      triggers: z.array(alertTriggerSchema).max(MAX_ALERT_TRIGGERS).default([]),
    })
    .prefault({});
}

export const alertScenariosSchema = z.object({
  donation: alertScenarioSchema(
    titleTemplateSchema.default('{username} — {amount}'),
    messageTemplateSchema.default('{message}'),
  ),
  follow: alertScenarioSchema(
    titleTemplateSchema.default('{username} теперь с нами!'),
    messageTemplateSchema.default(''),
  ),
  subscription: alertScenarioSchema(
    titleTemplateSchema.default('{username} оформил подписку'),
    messageTemplateSchema.default(''),
  ),
  gift: alertScenarioSchema(
    titleTemplateSchema.default('{username} дарит подписки: {count}'),
    messageTemplateSchema.default(''),
  ),
  resubscription: alertScenarioSchema(
    titleTemplateSchema.default('{username} с нами {count} мес.'),
    messageTemplateSchema.default('{message}'),
  ),
  cheer: alertScenarioSchema(
    titleTemplateSchema.default('{username} — {count} битов'),
    messageTemplateSchema.default('{message}'),
  ),
  kicks: alertScenarioSchema(
    titleTemplateSchema.default('{username} — {count} KICKs'),
    messageTemplateSchema.default('{message}'),
  ),
  raid: alertScenarioSchema(
    titleTemplateSchema.default('Рейд от {username}: {count} зрителей'),
    messageTemplateSchema.default(''),
  ),
  reward: alertScenarioSchema(
    titleTemplateSchema.default('{username} берёт награду'),
    messageTemplateSchema.default('{message}'),
  ),
} satisfies Record<AlertEventType, unknown>);

export type AlertScenarioConfig = z.infer<typeof alertScenariosSchema>['donation'];

/** Подходит ли сумма под условие триггера. Сравнение — целыми минорными единицами. */
export function matchesTriggerCondition(
  condition: AlertTriggerCondition,
  amount: Money | null,
): boolean {
  if (!amount || amount.currency !== condition.currency) return false;
  const value = amount.amountMinor;
  switch (condition.operator) {
    case 'gte':
      return value >= condition.amountMinor;
    case 'gt':
      return value > condition.amountMinor;
    case 'eq':
      return value === condition.amountMinor;
    case 'lte':
      return value <= condition.amountMinor;
    case 'lt':
      return value < condition.amountMinor;
    case 'between':
      return (
        condition.toMinor !== null && value >= condition.amountMinor && value <= condition.toMinor
      );
  }
}

/** Первый по приоритету триггер, под который подходит событие. null — ни один. */
export function matchAlertTrigger(
  scenario: Pick<AlertScenarioConfig, 'triggers'>,
  event: Pick<AlertEvent, 'amount'>,
): AlertTrigger | null {
  return (
    scenario.triggers.find((trigger) => matchesTriggerCondition(trigger.condition, event.amount)) ??
    null
  );
}

/**
 * Вид, которым показывается событие: сценарий с видом сработавшего триггера.
 *
 * Одна функция для оверлея и предпросмотра — как `shouldShowAlert`: иначе в
 * редакторе донат на тысячу выглядел бы одним триггером, а в кадре другим.
 */
export function resolveAlertScenario(
  scenario: AlertScenarioConfig,
  event: Pick<AlertEvent, 'amount'>,
): AlertScenarioConfig {
  const trigger = matchAlertTrigger(scenario, event);
  if (!trigger) return scenario;
  const appearance = Object.fromEntries(
    ALERT_APPEARANCE_FIELDS.map((field) => [field, trigger[field]]),
  );
  return { ...scenario, ...appearance } as AlertScenarioConfig;
}

/**
 * Конфиг alert-виджета. Одна и та же схема валидирует запись в API, генерирует форму
 * настроек в дашборде и управляет рендером в overlay.
 *
 * Общая здесь только пауза между алертами: очередь одна на виджет, и оповещения
 * разных типов идут в ней друг за другом.
 */
/**
 * Голосовые донаты: запись донатера играет вместе с его оповещением.
 *
 * Настройка на весь виджет, а не на сценарий и не на триггер: голос приходит
 * с донатом как есть, и «для донатов от тысячи голос громче» — настройка,
 * которой никто не просил, зато копия её в каждом триггере разъезжалась бы.
 *
 * Потолок обязателен: длину записи задаёт донатер, а не стример, и минутная
 * тирада иначе держала бы очередь оповещений столько, сколько захочет чужой
 * человек.
 */
export const alertVoiceSchema = z.object({
  enabled: z.boolean().default(true),
  volume: z.number().min(0).max(1).default(0.8),
  maxSeconds: z.number().int().min(5).max(300).default(90),
});
export type AlertVoice = z.infer<typeof alertVoiceSchema>;

export const alertWidgetConfigSchema = z.object({
  canvas: canvasField(),
  /** Пауза между алертами, чтобы они не слипались. */
  gapMs: z.number().int().min(0).max(10000).default(500),
  voice: alertVoiceSchema.prefault({}),
  /**
   * Брать ли события с YouTube: спонсорства и платную поддержку.
   *
   * Отдельная настройка, а не «включено всегда», потому что у YouTube нет
   * подписки на события: они приходят строками в потоке чата эфира, а его
   * открытие стоит квоты, общей на весь сервис. Пока оверлей этого виджета
   * закрыт, поток не открывается, и события не придут — этим YouTube и
   * отличается от Twitch, где события идут сами.
   */
  youtubeEvents: z.boolean().default(false),
  scenarios: alertScenariosSchema.prefault({}),
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
 *
 * Валюты в конфиге НЕТ: её не выбирает стример, она приходит с донатами.
 * Сервер берёт основную валюту владельца — ту, в которой пришло больше всего
 * донатов (`primaryCurrency`), — и отдаёт её в состоянии виджета. Раньше
 * валюту выбирали в форме, и цель в рублях у стримера, которому платят в
 * тенге, молча стояла на нуле. Старое поле `currency` в сохранённых конфигах
 * схема отбрасывает.
 */
export const goalWidgetConfigSchema = z.object({
  canvas: canvasField(),
  title: z.string().min(1).max(80).default('Цель'),
  targetMinor: z.number().int().positive().max(1_000_000_000).default(1_000_000),
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
  /**
   * Картинки вместо полосы: заполнение и дорожка.
   *
   * Заполнение ОБРЕЗАЕТСЯ по прогрессу, а не растягивается: растянутая картинка
   * на 10 % прогресса — это сплющенная картинка, и выглядит она как ошибка.
   */
  barImageUrl: httpsUrlSchema.nullable().default(null),
  trackImageUrl: httpsUrlSchema.nullable().default(null),
  slots: slotsSchema(GOAL_SLOTS).prefault({}),
  background: widgetBackgroundSchema.prefault({}),
  text: textStyleSchema.prefault({}),
});
export type GoalWidgetConfig = z.infer<typeof goalWidgetConfigSchema>;

/* ------------------------------------------------------------------ */
/* Таймер                                                              */
/* ------------------------------------------------------------------ */

export const timerWidgetConfigSchema = z.object({
  canvas: canvasField(),
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
   * Валюта — основная валюта донатов владельца (см. цель), а не поле конфига.
   *
   * Ноль означает «донаты время не добавляют»: таймер бывает нужен и просто как
   * отсчёт до начала эфира.
   */
  secondsPerUnit: z.number().int().min(0).max(3600).default(0),
  countTypes: z.array(alertEventTypeSchema).min(1).default(['donation']),
  /** Потолок: марафон, который нельзя продлить бесконечно одним крупным донатом. */
  maxSeconds: z
    .number()
    .int()
    .min(60)
    .max(30 * 24 * 3600)
    .default(24 * 3600),
  showHours: z.boolean().default(true),
  slots: slotsSchema(TIMER_SLOTS).prefault({}),
  background: widgetBackgroundSchema.prefault({}),
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
  canvas: canvasField(),
  title: z.string().max(80).default('Топ донатеров'),
  period: topDonorsPeriodSchema.default('30d'),
  limit: z.number().int().min(1).max(10).default(5),
  showAmounts: z.boolean().default(true),
  slots: slotsSchema(TOP_DONORS_SLOTS).prefault({}),
  background: widgetBackgroundSchema.prefault({}),
  text: textStyleSchema.prefault({}),
});
export type TopDonorsWidgetConfig = z.infer<typeof topDonorsWidgetConfigSchema>;

/* ------------------------------------------------------------------ */
/* Чат                                                                 */
/* ------------------------------------------------------------------ */

/**
 * Конфиг виджета чата.
 *
 * Канала здесь НЕТ — и это решение, а не упрощение. Раньше логин вписывался
 * в настройки, и в эфир можно было вывести чат любого чужого канала: его
 * сообщения, ники и эмоуты шли через платформу без ведома и согласия того
 * стримера. Теперь каналы — только подключённые по OAuth площадки владельца
 * виджета: вход на площадке доказывает, что канал его. Сервер находит каналы
 * сам (`chatChannels`), без подключённой площадки виджет не создаётся.
 * Старое поле `channel` в сохранённых конфигах схема молча отбрасывает.
 * Выбрать здесь можно только, чат каких из подключённых площадок показывать.
 */
/**
 * Кого не показывать: логин Twitch или имя на YouTube, без регистра и «@».
 *
 * Строка, а не логин Twitch, потому что у YouTube постоянный идентификатор —
 * id канала вида UC…, которого стример не знает, а боты узнаются по имени:
 * «Nightbot» на обеих площадках. Старые значения — логины — остаются верными.
 */
export const hiddenChatUserSchema = z
  .string()
  .trim()
  .toLowerCase()
  .transform((value) => value.replace(/^@/, ''))
  .pipe(z.string().regex(/^[^\s\p{C}]{1,64}$/u, 'Ник без пробелов, до 64 символов'));

const chatPlatformsSchema = z.object(
  Object.fromEntries(CHAT_PLATFORMS.map((platform) => [platform, z.boolean().default(true)])) as {
    [K in ChatPlatform]: z.ZodDefault<z.ZodBoolean>;
  },
);

export const chatWidgetConfigSchema = z.object({
  canvas: canvasField(),
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
  hiddenUsers: z
    .array(hiddenChatUserSchema)
    .max(20)
    .default(['nightbot', 'streamelements', 'moobot']),
  /** Чат каких площадок показывать — из подключённых. */
  platforms: chatPlatformsSchema.prefault({}),
  /** Значок площадки перед ником: в мультичате без него не понять, откуда строка. */
  showPlatform: z.boolean().default(true),
  /** Ник цветом, который выбрал сам автор. Иначе — цветом подсветки виджета. */
  useAuthorColors: z.boolean().default(true),
  /** Фон есть, раскладки нет: в виджете чата один элемент — сама лента. */
  background: widgetBackgroundSchema.prefault({}),
  text: textStyleSchema.prefault({}),
});
export type ChatWidgetConfig = z.infer<typeof chatWidgetConfigSchema>;

/* ------------------------------------------------------------------ */
/* Гости приватной комнаты                                             */
/* ------------------------------------------------------------------ */

/**
 * Конфиг виджета гостей: какую комнату выводить и как разложить плитки.
 *
 * Комната указана идентификатором, и сервер при сохранении проверяет, что она
 * принадлежит владельцу виджета. Схема этого проверить не может, а без проверки
 * чужой идентификатор в своём виджете открывал бы видео чужой приватной комнаты
 * по собственной ссылке OBS.
 *
 * Пустая строка — виджет создан, но комнату ещё не выбрали, как пустой канал у
 * чата: создаётся он кнопкой «Новый виджет» с пустым конфигом.
 */
/**
 * Место гостя в свободной раскладке: середина плитки и её ширина в процентах
 * кадра.
 *
 * Высоты нет намеренно: плитка всегда 16:9 — таково видео с камеры, и
 * растянутая по-своему плитка обрезала бы лицо или сплющила его. `x` и `y` —
 * СЕРЕДИНА, как у элементов кадра остальных виджетов: перетаскивая, стример
 * целится серединой. Проценты, а не пиксели: размер браузер-сорса задаёт OBS.
 */
export const guestSeatSchema = z.object({
  x: z.number().min(0).max(100),
  y: z.number().min(0).max(100),
  width: z.number().min(5).max(100),
});
export type GuestSeat = z.infer<typeof guestSeatSchema>;

/** Соотношение сторон плитки гостя: как у видео с камеры. */
export const GUEST_TILE_ASPECT = 16 / 9;

/**
 * Места по умолчанию: сначала углы, потом середины верхнего и нижнего края.
 *
 * Центр кадра — под игру, поэтому первые гости встают по углам, а не рядом в
 * середине. Ширина 22 % — в кадре 16:9 это и 22 % высоты, все плитки внутри
 * поля кадра.
 */
export const DEFAULT_GUEST_SEATS: readonly GuestSeat[] = [
  { x: 13, y: 14 },
  { x: 87, y: 14 },
  { x: 13, y: 86 },
  { x: 87, y: 86 },
  { x: 38, y: 14 },
  { x: 62, y: 14 },
  { x: 38, y: 86 },
  { x: 62, y: 86 },
].map((center) => ({ ...center, width: 22 }));

/** Рамка места: из конфига, а для места, которого там нет, — по умолчанию. */
export function guestSeat(seats: readonly GuestSeat[], index: number): GuestSeat {
  return seats[index] ?? DEFAULT_GUEST_SEATS[index % DEFAULT_GUEST_SEATS.length]!;
}

export const guestsWidgetConfigSchema = z.object({
  canvas: canvasField(),
  roomId: z.union([uuidSchema, z.literal('')]).default(''),
  layout: z.enum(GUEST_LAYOUTS).default('grid'),
  /**
   * Рамки мест для свободной раскладки: 1-й гость по порядку входа — в первой,
   * и так далее. Хранятся и при автоматической раскладке: переключились на
   * сетку и обратно — расстановка на месте. Функцией, а не массивом: иначе все
   * конфиги делили бы один объект по умолчанию.
   */
  seats: z
    .array(guestSeatSchema)
    .max(MAX_GUESTS_PER_ROOM)
    .default(() => DEFAULT_GUEST_SEATS.map((seat) => ({ ...seat }))),
  /** Сколько плиток максимум. Остальные гости в кадр не попадут, но слышны будут. */
  maxTiles: z.number().int().min(1).max(MAX_GUESTS_PER_ROOM).default(4),
  showNames: z.boolean().default(true),
  /**
   * Плитка с именем, когда камера гостя выключена. Иначе гость пропадает из
   * кадра, продолжая говорить, и зрители слышат голос ниоткуда.
   */
  showWithoutVideo: z.boolean().default(true),
  gap: z.number().int().min(0).max(48).default(8),
  cornerRadius: z.number().int().min(0).max(48).default(12),
  text: textStyleSchema.prefault({ fontSize: 20 }),
});
export type GuestsWidgetConfig = z.infer<typeof guestsWidgetConfigSchema>;

/* ------------------------------------------------------------------ */
/* Последнее событие                                                   */
/* ------------------------------------------------------------------ */

/**
 * Шаблон строки по умолчанию — под то, что у события есть: у фолловера нет ни
 * суммы, ни количества, и «{username} — {amount}» оставил бы висящее тире.
 */
export const LATEST_DEFAULT_TEMPLATES: Record<AlertEventType, string> = {
  donation: '{username} — {amount}',
  follow: '{username}',
  subscription: '{username}',
  gift: '{username} × {count}',
  resubscription: '{username} · {count}',
  cheer: '{username} — {count}',
  kicks: '{username} — {count}',
  raid: '{username} · {count}',
  reward: '{username} — {message}',
};

/**
 * Конфиг виджета последнего события: последний донат, фолловер, подписчик.
 *
 * Один тип с выбором события, а не три: у них одинаково всё, кроме того, какое
 * событие брать, — а три типа означали бы три копии формы, рендерера и
 * состояния. Событие можно поменять после создания: у типа нет полей,
 * которые от него зависят, кроме шаблона.
 */
export const latestWidgetConfigSchema = z.object({
  canvas: canvasField(),
  eventType: alertEventTypeSchema.default('donation'),
  title: z.string().max(80).default('Последний донат'),
  template: z.string().min(1).max(200).default(LATEST_DEFAULT_TEMPLATES.donation),
  /** Текст доната или награды отдельной строкой — в кадре бывает длинным. */
  showMessage: z.boolean().default(false),
  /**
   * Что написать, пока событий не было. Пусто — виджет не занимает место в
   * кадре, как топ донатеров на свежем канале.
   */
  emptyText: z.string().max(80).default(''),
  slots: slotsSchema(LATEST_SLOTS).prefault({}),
  background: widgetBackgroundSchema.prefault({}),
  text: textStyleSchema.prefault({}),
});
export type LatestWidgetConfig = z.infer<typeof latestWidgetConfigSchema>;

/* ------------------------------------------------------------------ */
/* Рулетка                                                             */
/* ------------------------------------------------------------------ */

/**
 * Цвета секторов по умолчанию.
 *
 * Порядок подобран валидатором dataviz для КОЛЬЦА: соседние сектора, включая
 * замыкание последнего на первый, различимы при дейтеранопии (ΔE ≥ 9.8) и
 * обычным зрением (ΔE ≥ 22.7) на тёмной подложке. Все восемь — средней
 * светлоты, поэтому цвет подписи рендерер выбирает по контрасту с сектором.
 */
export const ROULETTE_COLORS = [
  '#A3850F',
  '#6B84EA',
  '#E0473D',
  '#2EA3B4',
  '#CF7C38',
  '#9670E0',
  '#40A85A',
  '#D0509C',
] as const;

/**
 * Замена цвета последнего сектора: он встаёт рядом с первым.
 *
 * Тогда последний сектор встаёт рядом с первым (горчичным), а с ним
 * неразличимы при дейтеранопии красный, оранжевый и зелёный (ΔE 2.1–5.9), и
 * совпадает он сам — при девяти секторах.
 * Замена различима и с первым, и с предпоследним сектором — посчитано тем же
 * валидатором.
 */
const WRAP_REPLACEMENT: Partial<Record<number, number>> = { 0: 1, 2: 3, 4: 1, 6: 7 };

/** Цвет нового сектора: по кругу палитры, с заменой на стыке кольца. */
export function rouletteSectorColor(index: number, count: number): string {
  const slot = index % ROULETTE_COLORS.length;
  const last = index === count - 1 && count > 1;
  const replaced = last ? (WRAP_REPLACEMENT[slot] ?? slot) : slot;
  return ROULETTE_COLORS[replaced]!;
}

export const rouletteSectorSchema = z.object({
  /** Ключ для списка и для итога прокрута: подпись сектора стример может переименовать. */
  id: z.string().min(1).max(64),
  label: z.string().trim().min(1, 'Назовите сектор').max(40),
  /**
   * Вес — шанс сектора относительно остальных. Размер сектора на колесе
   * пропорционален весу: зрители видят настоящие шансы, а не равные доли при
   * неравной вероятности.
   */
  weight: z.number().int().min(1).max(1000).default(1),
  color: hexColorSchema,
});
export type RouletteSector = z.infer<typeof rouletteSectorSchema>;

export const MIN_ROULETTE_SECTORS = 2;

/**
 * Как рулетка выглядит в кадре.
 *
 * `wheel` — колесо; секторов не больше `MAX_ROULETTE_SECTORS`, дальше подписи
 * на нём не читаются ни с какой стороны. `vertical` — вертикальная лента,
 * которая проматывается мимо метки: подписи в ней горизонтальные, поэтому их
 * помещается вчетверо больше (`MAX_VERTICAL_SECTORS`). Лента входит в
 * продвинутое оформление, то есть в «Про».
 */
export const ROULETTE_MODES = ['wheel', 'vertical'] as const;
export const rouletteModeSchema = z.enum(ROULETTE_MODES);
export type RouletteMode = (typeof ROULETTE_MODES)[number];

export const MAX_ROULETTE_SECTORS = 24;
export const MAX_VERTICAL_SECTORS = 100;

/** Сколько секторов помещается в этом виде рулетки. */
export function maxRouletteSectors(mode: RouletteMode): number {
  return mode === 'vertical' ? MAX_VERTICAL_SECTORS : MAX_ROULETTE_SECTORS;
}

const DEFAULT_ROULETTE_LABELS = [
  'Спеть песню',
  'Челлендж',
  'Выбор игры',
  'Ничего',
  'Реакция на видео',
  'Отжимания',
];

export function defaultRouletteSectors(): RouletteSector[] {
  return DEFAULT_ROULETTE_LABELS.map((label, index) => ({
    id: `sector-${index + 1}`,
    label,
    weight: 1,
    color: rouletteSectorColor(index, DEFAULT_ROULETTE_LABELS.length),
  }));
}

/**
 * Конфиг рулетки.
 *
 * Крутится двумя способами: донатом не меньше цены прокрута и кнопкой в
 * дашборде (розыгрыши без донатов). Результат выбирает СЕРВЕР: оверлей только
 * доводит колесо до присланного сектора. Иначе у двух сцен OBS с одной ссылкой
 * и у предпросмотра выпадало бы разное, а стример не знал бы, что выпало.
 */
export const rouletteWidgetConfigSchema = z
  .object({
    canvas: canvasField(),
    title: z.string().max(80).default('Рулетка'),
    /** Колесо или вертикальная лента. Лента — продвинутое оформление, «Про». */
    mode: rouletteModeSchema.default('wheel'),
    sectors: z
      .array(rouletteSectorSchema)
      .min(MIN_ROULETTE_SECTORS)
      .max(MAX_VERTICAL_SECTORS)
      .default(defaultRouletteSectors),
    /** Крутят ли колесо донаты. Выключено — только кнопкой из дашборда. */
    donationSpins: z.boolean().default(true),
    /**
     * Цена прокрута по валютам, в минорных единицах. Донат от этой суммы — один
     * прокрут, сколько бы он ни превышал цену: очередь из десятка прокрутов от
     * одного крупного доната забила бы эфир на минуты.
     *
     * Валюта без цены (или с нулём) колесо НЕ крутит — наоборот порогу показа
     * оповещений, где пустое поле значит «показывать все». Там пустое безопасно (лишний алерт),
     * здесь — нет: пустая цена крутила бы колесо на донат в одну копейку.
     */
    spinPrice: currencyAmounts().default({ RUB: 30_000 }),
    /** Сколько крутится колесо до остановки. */
    spinDurationMs: z.number().int().min(3000).max(20000).default(7000),
    /** Сколько итог держится на экране после остановки. */
    resultMs: z.number().int().min(1000).max(30000).default(6000),
    /** Колесо только на время прокрута: между прокрутами кадр свободен. */
    hideWhenIdle: z.boolean().default(false),
    /** Имя донатера в итоге. У прокрута кнопкой имени нет. */
    showDonor: z.boolean().default(true),
    /** Диаметр колеса (а у ленты — её высота) в пикселях окна виджета. */
    wheelSize: z.number().int().min(160).max(2000).default(420),
    /** Цвет обода, зазоров между секторами и ступицы. */
    rimColor: hexColorSchema.default('#100F0D'),
    slots: slotsSchema(ROULETTE_SLOTS).prefault({}),
    background: widgetBackgroundSchema.prefault({}),
    text: textStyleSchema.prefault({ fontSize: 28 }),
  })
  // Сколько секторов поместится, решает вид рулетки, а не массив: на колесе
  // двадцать пятая подпись не читается, а в ленте подписи горизонтальные.
  // Проверка на объекте, потому что предел зависит от соседнего поля.
  .refine((config) => config.sectors.length <= maxRouletteSectors(config.mode), {
    path: ['sectors'],
    error: 'В колесе не больше 24 секторов: для длинных списков есть вертикальная лента',
  });
export type RouletteWidgetConfig = z.infer<typeof rouletteWidgetConfigSchema>;

/**
 * Выбор сектора по весам. `random` — число из [0, 1): сервер передаёт сюда
 * криптографически стойкое, тесты — заданное.
 */
export function pickRouletteSector(
  sectors: readonly Pick<RouletteSector, 'weight'>[],
  random: number,
): number {
  const total = sectors.reduce((sum, sector) => sum + sector.weight, 0);
  let point = Math.min(Math.max(random, 0), 1 - Number.EPSILON) * total;
  for (let index = 0; index < sectors.length; index += 1) {
    point -= sectors[index]!.weight;
    if (point < 0) return index;
  }
  return sectors.length - 1;
}

/** Хватает ли доната на прокрут. Сравнение — в валюте доната, без курса. */
export function donationSpins(
  config: Pick<RouletteWidgetConfig, 'donationSpins' | 'spinPrice'>,
  amount: Money | null,
): boolean {
  if (!config.donationSpins || !amount) return false;
  const price = config.spinPrice[amount.currency];
  return price !== undefined && price > 0 && amount.amountMinor >= price;
}

/**
 * Границы секторов на колесе в градусах по часовой стрелке от верха.
 * Сектор занимает долю круга, равную доле своего веса.
 */
export function rouletteGeometry(
  sectors: readonly Pick<RouletteSector, 'weight'>[],
): { start: number; end: number }[] {
  const total = sectors.reduce((sum, sector) => sum + sector.weight, 0) || 1;
  let cursor = 0;
  return sectors.map((sector) => {
    const start = cursor;
    cursor += (sector.weight / total) * 360;
    return { start, end: cursor };
  });
}

/**
 * Прокрут: что выпало и как колесо должно остановиться.
 *
 * Точка остановки внутри сектора (`offset`) и число оборотов выбирает сервер,
 * а не оверлей: две сцены OBS с одной ссылкой должны остановиться в одной
 * точке, а не просто на одном секторе. Подпись и цвет сектора едут с прокрутом
 * — стример может переименовать сектор, пока колесо крутится.
 */
export const rouletteSpinSchema = z.object({
  id: uuidSchema,
  sectorId: z.string().min(1).max(64),
  sectorIndex: z.number().int().nonnegative(),
  label: z.string().max(40),
  color: hexColorSchema,
  offset: z.number().min(0).max(1),
  turns: z.number().int().min(1).max(20),
  source: z.enum(['donation', 'manual']),
  username: z.string().max(64).nullable(),
  amount: moneySchema.nullable(),
  createdAt: isoDateSchema,
});
export type RouletteSpin = z.infer<typeof rouletteSpinSchema>;

/** Сколько последних прокрутов помнит сервер: историю видит стример в дашборде. */
export const ROULETTE_HISTORY_LIMIT = 20;

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
  z.object({ type: z.literal('guests'), config: guestsWidgetConfigSchema }),
  z.object({ type: z.literal('latest'), config: latestWidgetConfigSchema }),
  z.object({ type: z.literal('roulette'), config: rouletteWidgetConfigSchema }),
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
  guests: guestsWidgetConfigSchema,
  latest: latestWidgetConfigSchema,
  roulette: rouletteWidgetConfigSchema,
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
 * Конфиг, приведённый к тарифу: без продвинутого оформления, если его нет.
 *
 * Настройки продвинутого оформления НЕ удаляются из базы — стример их сделал, и
 * после оплаты они обязаны вернуться такими же. Поэтому урезание происходит на
 * выходе: сервер прогоняет через эту функцию конфиг, который уезжает в оверлей,
 * а дашборд — конфиг для предпросмотра. Реализация одна, потому что расхождение
 * между «что в кадре» и «что в предпросмотре» замечают уже на записи эфира.
 *
 * Что снимается: позиции элементов и их цвета (слоты пустеют), фон, картинки
 * вместо полосы цели, шрифт (остаётся `Inter`) и анимации сверх базовых —
 * последние заменяются, а не выбрасываются: алерт без анимации выглядел бы
 * поломкой, а не ограничением тарифа.
 *
 * Тип не проверяется: функция смотрит на поля, а не на `type`. Новый тип с
 * `slots` или `background` получает урезание автоматически — забыть его здесь
 * нельзя, в отличие от списка типов.
 */
export function applyPlanToConfig<T extends Record<string, unknown>>(
  config: T,
  features: Pick<PlanFeatures, 'advancedStyling'>,
): T {
  if (features.advancedStyling) return config;

  const result: Record<string, unknown> = { ...config };
  for (const [key, value] of Object.entries(result)) {
    if (key === 'slots' && isRecord(value)) {
      result[key] = Object.fromEntries(Object.keys(value).map((slot) => [slot, { ...EMPTY_SLOT }]));
      continue;
    }
    if (key === 'background' && isRecord(value)) {
      result[key] = { ...EMPTY_BACKGROUND };
      continue;
    }
    if ((key === 'barImageUrl' || key === 'trackImageUrl') && value !== null) {
      result[key] = null;
      continue;
    }
    if (key === 'text' && isRecord(value)) {
      result[key] = { ...value, fontFamily: 'Inter' };
      continue;
    }
    if ((key === 'animationIn' || key === 'animationOut') && typeof value === 'string') {
      result[key] = basicAnimation(value);
      continue;
    }
    // Вертикальная лента рулетки и её длинный список — тоже продвинутое
    // оформление. Сектора режутся здесь, а не просто перестаёт рисоваться
    // лента: сервер выбирает сектор по тому же приведённому конфигу, и в кадр
    // не должен прийти номер, которого на колесе нет.
    if (key === 'mode' && value === 'vertical') {
      result[key] = 'wheel';
      continue;
    }
    if (key === 'sectors' && Array.isArray(value) && value.length > MAX_ROULETTE_SECTORS) {
      result[key] = value.slice(0, MAX_ROULETTE_SECTORS);
      continue;
    }
    // Триггеры сценария — такой же полный вид оповещения, как сам сценарий.
    if (key === 'triggers' && Array.isArray(value)) {
      result[key] = value.map((trigger: unknown) =>
        isRecord(trigger) ? applyPlanToConfig(trigger, features) : trigger,
      );
      continue;
    }
    // Сценарии алертов: у каждого свои слоты, фон, шрифт и анимации.
    if (key === 'scenarios' && isRecord(value)) {
      result[key] = Object.fromEntries(
        Object.entries(value).map(([type, scenario]) => [
          type,
          isRecord(scenario) ? applyPlanToConfig(scenario, features) : scenario,
        ]),
      );
    }
  }
  return result as T;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Базовая замена продвинутой анимации.
 *
 * Пары подобраны по направлению и характеру движения: «вниз» становится
 * «вверх», «вправо» — «влево», а прыжок и тряска — «bounce». Незнакомое
 * значение — `fade`: она есть всегда.
 */
function basicAnimation(animation: string): AlertAnimation {
  if ((BASIC_ALERT_ANIMATIONS as readonly string[]).includes(animation)) {
    return animation as AlertAnimation;
  }
  switch (animation) {
    case 'slide-down':
      return 'slide-up';
    case 'slide-right':
      return 'slide-left';
    case 'pop':
    case 'flip':
      return 'zoom';
    case 'shake':
    case 'swing':
      return 'bounce';
    default:
      return 'fade';
  }
}

/**
 * Есть ли у типа состояние, которое считает сервер.
 *
 * У алертов и чата его нет: их «состояние» — это поток событий, он ничего не
 * накапливает и восстанавливать его неоткуда. Спрашивать снимок у таких
 * виджетов бессмысленно, и дашборд не должен рисовать им блок управления.
 */
export function hasWidgetState(type: WidgetType): boolean {
  return (
    type === 'goal' ||
    type === 'timer' ||
    type === 'top-donors' ||
    type === 'latest' ||
    type === 'roulette'
  );
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
  /**
   * В какой валюте донаты продлевают марафон. Нужна дашборду для подписи
   * «секунд за 1 ₽»: в конфиге валюты больше нет. Дефолт — для снимков,
   * посланных сервером до появления поля.
   */
  currency: currencySchema.default('RUB'),
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

/**
 * Последнее событие выбранного типа. Без id и провайдера: в кадр идёт только
 * то, что в нём показывается.
 */
export const latestEventSchema = alertEventSchema.pick({
  type: true,
  username: true,
  message: true,
  amount: true,
  count: true,
  createdAt: true,
});
export type LatestEvent = z.infer<typeof latestEventSchema>;

export const latestStateSchema = z.object({
  kind: z.literal('latest'),
  /** null — таких событий ещё не было. */
  event: latestEventSchema.nullable(),
});
export type LatestState = z.infer<typeof latestStateSchema>;

/**
 * История рулетки — для дашборда, новые первыми.
 *
 * Оверлей её не крутит: колесо двигает только сообщение о прокруте. Иначе
 * переподключившаяся сцена прокрутила бы заново последний розыгрыш.
 */
export const rouletteStateSchema = z.object({
  kind: z.literal('roulette'),
  spins: z.array(rouletteSpinSchema).max(ROULETTE_HISTORY_LIMIT),
});
export type RouletteState = z.infer<typeof rouletteStateSchema>;

export const widgetStateSchema = z.discriminatedUnion('kind', [
  goalStateSchema,
  timerStateSchema,
  topDonorsStateSchema,
  latestStateSchema,
  rouletteStateSchema,
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
    z.object({
      kind: z.literal('roulette'),
      /** `spin` — прокрут кнопкой, `clear` — стереть историю прокрутов. */
      action: z.enum(['spin', 'clear']),
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

export const ALERT_TEMPLATE_VARS = ['username', 'amount', 'count', 'message', 'type'] as const;
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
 * Голос донатера, который играет с этим оповещением. null — играть нечего.
 *
 * Отдельно от звука сценария, потому что они не складываются: голос и звук
 * оповещения, включённые разом, дают кашу, в которой не разобрать ни того, ни
 * другого. Голос старше — его прислал донатер, а звук сценария стример слышал
 * уже тысячу раз.
 */
export function alertVoiceUrl(
  config: Pick<AlertWidgetConfig, 'voice'>,
  event: Pick<AlertEvent, 'audioUrl'>,
): string | null {
  return config.voice.enabled && event.audioUrl ? event.audioUrl : null;
}

/**
 * Сколько оповещение держится на экране с голосовым донатом: не меньше
 * длительности сценария, не дольше потолка голоса.
 *
 * Длину записи браузер узнаёт заранее, до показа: оповещение, которое сначала
 * появилось на секунды сценария, а потом «передумало» и осталось, выглядит
 * зависшим.
 */
export function alertVoiceDurationMs(
  config: Pick<AlertWidgetConfig, 'voice'>,
  scenarioDurationMs: number,
  voiceSeconds: number,
): number {
  const tail = 500;
  const voiceMs = Math.round(voiceSeconds * 1000) + tail;
  return Math.min(Math.max(scenarioDurationMs, voiceMs), config.voice.maxSeconds * 1000);
}

/**
 * Решение «показывать ли событие этим виджетом». Общая логика для бэкенда
 * (не слать лишнего в сокет) и overlay (страховка на клиенте).
 *
 * Выключенный сценарий не показывает и тестовое событие: стример проверяет
 * ровно то, что увидят зрители. Пороги тест обходит — иначе проверка алерта
 * при пороге в тысячу рублей молча ничего бы не показала.
 */
export function shouldShowAlert(
  event: Pick<AlertEvent, 'type' | 'amount' | 'count' | 'isTest'>,
  config: Pick<AlertWidgetConfig, 'scenarios'>,
): boolean {
  const scenario = config.scenarios[event.type];
  if (!scenario.enabled) return false;
  if (event.isTest) return true;
  // Порог — той валюты, в которой пришёл донат. Донат без суммы (валюта, которой
  // у нас нет, — см. коннектор DonationAlerts) порогом не отсекается: сравнить
  // его не с чем, а потерять донат на экране хуже, чем показать лишний.
  if (event.amount) {
    const threshold = scenario.minAmounts[event.amount.currency] ?? 0;
    if (event.amount.amountMinor < threshold) return false;
  }
  if (scenario.minCount > 0) {
    if (event.count === null || event.count < scenario.minCount) return false;
  }
  return true;
}
