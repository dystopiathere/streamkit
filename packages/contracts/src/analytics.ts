import { z } from 'zod';
import { currencySchema, isoDateSchema, uuidSchema } from './common.js';
import { alertEventTypeSchema } from './events.js';

/* ------------------------------------------------------------------ */
/* Площадки                                                            */
/* ------------------------------------------------------------------ */

/**
 * Площадки, для которых есть сбор метрик.
 *
 * Список короче, чем enum `Platform` в схеме БД: там уже заведены VKPLAY и
 * TROVO под будущие коннекторы, но контракт описывает то, что реально работает.
 */
export const PLATFORMS = ['twitch', 'youtube', 'kick'] as const;
export const platformSchema = z.enum(PLATFORMS);
export type Platform = z.infer<typeof platformSchema>;

/** Счётчики канала, которые площадка может отдавать. */
export type ChannelCounter = 'followers' | 'subscribers' | 'totalViews';

/**
 * Какие счётчики отдаёт площадка — одна таблица на карточку канала, графики и
 * сводку по эфирам.
 *
 * Карточка канала показывала все счётчики всем площадкам, и у YouTube стояли
 * «Фолловеров —» навсегда: фолловеров у YouTube нет, это не пробел в данных, а
 * поле не о нём. Прочерк оставлен для «площадка не сообщила», а не для «такого
 * не бывает».
 *
 * `audience` — счётчик, которым меряется рост аудитории. Он у площадок разный
 * по названию и одинаковый по смыслу: фолловер Twitch и подписчик YouTube — это
 * бесплатное «следить за каналом». Платные подписчики Twitch — другое, их
 * немного и не у всех: они есть только у компаньонов и партнёров, поэтому
 * `optional` — без значения карточка их не показывает вовсе.
 *
 * У Kick счётчика аудитории нет вовсе: публичный API не отдаёт число
 * фолловеров, только платных подписчиков своего канала. Подставить их вместо
 * аудитории значило бы назвать ростом аудитории рост платных подписок —
 * поэтому `audience: null`, и прирост аудитории считается без Kick.
 */
export const PLATFORM_COUNTERS: Record<
  Platform,
  {
    audience: ChannelCounter | null;
    counters: readonly ChannelCounter[];
    optional: readonly ChannelCounter[];
  }
> = {
  twitch: {
    audience: 'followers',
    counters: ['followers', 'subscribers'],
    optional: ['subscribers'],
  },
  youtube: { audience: 'subscribers', counters: ['subscribers', 'totalViews'], optional: [] },
  kick: { audience: null, counters: ['subscribers'], optional: [] },
};

/**
 * Состояние сбора метрик по каналу.
 *
 * Отдельное поле, а не «последняя ошибка строкой»: интерфейс должен уметь
 * сказать «переподключите площадку» и «квота исчерпана, вернёмся завтра»
 * разными словами — это разные действия пользователя, а не разные оттенки
 * одной аварии.
 */
export const CHANNEL_SYNC_STATES = ['ok', 'auth-expired', 'rate-limited', 'error'] as const;
export const channelSyncStateSchema = z.enum(CHANNEL_SYNC_STATES);
export type ChannelSyncState = z.infer<typeof channelSyncStateSchema>;

export const channelSchema = z.object({
  id: uuidSchema,
  platform: platformSchema,
  /** Идентификатор канала на стороне площадки. */
  externalId: z.string().min(1).max(128),
  login: z.string().max(128),
  displayName: z.string().max(128),
  avatarUrl: z.string().url().nullable(),
  connectedAt: isoDateSchema,
  /** Когда метрики собирались в последний раз. null — ещё ни разу. */
  lastSyncedAt: isoDateSchema.nullable(),
  /**
   * Работает ли канал: собираются метрики, читается чат, идут события.
   *
   * Выключенным он бывает на тарифе, где активна одна площадка: подключены обе,
   * но работает выбранная. Отключение — это не выключение: оно удаляет канал
   * вместе с токенами и снимками.
   */
  isEnabled: z.boolean(),
  syncState: channelSyncStateSchema,
  /**
   * Выданных площадкой прав меньше, чем нужно сейчас: канал подключали до
   * того, как понадобились новые (биты и баллы канала для оповещений).
   * Метрики собираются, но часть событий не придёт, пока канал не
   * переподключат.
   */
  needsReconnect: z.boolean(),
});
export type Channel = z.infer<typeof channelSchema>;

/* ------------------------------------------------------------------ */
/* Метрики                                                             */
/* ------------------------------------------------------------------ */

/**
 * Снимок метрик канала.
 *
 * Все показатели nullable, и это не перестраховка: площадки отдают разные
 * наборы. У Twitch есть подписчики и фолловеры, у YouTube — подписчики и
 * суммарные просмотры, фолловеров нет вовсе. Придумывать ноль вместо
 * «неизвестно» значит нарисовать на графике падение до нуля там, где данных
 * просто не существует.
 */
export const channelStatsSchema = z.object({
  capturedAt: isoDateSchema,
  isLive: z.boolean(),
  /** Зрители прямо сейчас. null, когда эфира нет. */
  viewers: z.number().int().nonnegative().nullable(),
  followers: z.number().int().nonnegative().nullable(),
  subscribers: z.number().int().nonnegative().nullable(),
  /** Суммарные просмотры канала за всё время. */
  totalViews: z.number().int().nonnegative().nullable(),
  title: z.string().max(200).nullable(),
  category: z.string().max(120).nullable(),
  /**
   * Когда начался идущий эфир, по часам площадки. null вне эфира и когда
   * площадка время не сообщила. Время стрима считается от него, а не от
   * первого нашего снимка: опрос идёт раз в минуту, и сервис могли подключить
   * посреди эфира.
   */
  liveSince: isoDateSchema.nullable(),
});
export type ChannelStats = z.infer<typeof channelStatsSchema>;

/** Точка ряда. Отличается от снимка тем, что это уже усреднённая корзина. */
export const analyticsPointSchema = z.object({
  at: isoDateSchema,
  viewers: z.number().nonnegative().nullable(),
  followers: z.number().int().nonnegative().nullable(),
  subscribers: z.number().int().nonnegative().nullable(),
  /** Доля корзины, в которой канал был в эфире: от 0 до 1. */
  liveShare: z.number().min(0).max(1),
});
export type AnalyticsPoint = z.infer<typeof analyticsPointSchema>;

/* ------------------------------------------------------------------ */
/* Диапазоны                                                           */
/* ------------------------------------------------------------------ */

/**
 * Диапазоны. Самый длинный — девяносто дней: столько хранятся снимки метрик
 * (`SNAPSHOT_RETENTION_DAYS` в уборке), и более длинный диапазон молча
 * показывал бы площадки только за последние три месяца из выбранных.
 */
export const ANALYTICS_RANGES = ['24h', '7d', '30d', '90d'] as const;
export const analyticsRangeSchema = z.enum(ANALYTICS_RANGES);
export type AnalyticsRange = z.infer<typeof analyticsRangeSchema>;

/**
 * Часовой пояс, в котором режется ряд на корзины.
 *
 * Не украшение: корзины считались по UTC, а аудитория продукта в РФ. Эфир с
 * 22:00 до 02:00 по Москве разваливался на графике за месяц на две разные
 * «даты», и подпись оси называла день, которого у этих данных нет.
 *
 * Проверяем зону через Intl, а не регуляркой: список зон меняется, а движок
 * знает актуальный. Неизвестная зона до SQL доехать не должна — там она станет
 * ошибкой запроса, то есть пятисоткой на ровном месте.
 */
export const timeZoneSchema = z
  .string()
  .min(1)
  .max(64)
  .refine(isKnownTimeZone, { message: 'Неизвестный часовой пояс' });

function isKnownTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export const analyticsQuerySchema = z.object({
  range: analyticsRangeSchema.default('7d'),
  /** UTC по умолчанию: старый клиент не присылает зону, и его ответ не меняется. */
  timeZone: timeZoneSchema.default('UTC'),
});
export type AnalyticsQuery = z.infer<typeof analyticsQuerySchema>;

const RANGE_HOURS: Record<AnalyticsRange, number> = {
  '24h': 24,
  '7d': 24 * 7,
  '30d': 24 * 30,
  '90d': 24 * 90,
};

export function rangeToMs(range: AnalyticsRange): number {
  return RANGE_HOURS[range] * 60 * 60 * 1000;
}

/**
 * Размер корзины для прореживания ряда.
 *
 * Опрос идёт раз в минуту в эфире, и тридцать дней таких точек — это под
 * 43 тысячи значений на график шириной в тысячу пикселей. Час для коротких
 * диапазонов и сутки для месяца дают примерно 24-30 точек: столько глаз
 * различает, а больше только зашумляет линию.
 */
export function rangeBucket(range: AnalyticsRange): 'hour' | 'day' {
  return range === '30d' || range === '90d' ? 'day' : 'hour';
}

/**
 * Корзина сводки по эфирам и донатам — сутки везде, кроме суток.
 *
 * Не та же, что у ряда метрик: зрители меняются в течение эфира, и неделю их
 * читают по часам. Донаты и часы в эфире по часам недели — это 168 столбиков,
 * почти все пустые; вопрос «в какие дни» они не отвечают, а «в какие часы»
 * лучше отвечает тепловая карта.
 */
export function overviewBucket(range: AnalyticsRange): 'hour' | 'day' {
  return range === '24h' ? 'hour' : 'day';
}

/* ------------------------------------------------------------------ */
/* Сводка                                                              */
/* ------------------------------------------------------------------ */

/**
 * Донаты за период.
 *
 * Массив по валютам, а не одно число. Сложить рубли с долларами нельзя, а
 * спрятать это за «примерно» — соврать в отчёте о деньгах. Сумма, как везде в
 * проекте, целая в минорных единицах.
 *
 * Считаются по пользователю, а НЕ по каналу, и это не упрощение: донат
 * приходит из DonationAlerts или собственного вебхука, которые про канал
 * площадки ничего не знают. Привязать сумму к конкретному каналу означало бы
 * выдумать связь, которой в данных нет.
 */
export const donationTotalSchema = z.object({
  currency: currencySchema,
  amountMinor: z.number().int().nonnegative(),
  count: z.number().int().nonnegative(),
});
export type DonationTotal = z.infer<typeof donationTotalSchema>;

/** Изменение показателя за период. null — снимков не хватило для сравнения. */
const deltaSchema = z.number().int().nullable();

export const channelSummarySchema = z.object({
  channel: channelSchema,
  range: analyticsRangeSchema,
  /** Последний снимок. null, если метрики ещё ни разу не собирались. */
  current: channelStatsSchema.nullable(),
  deltas: z.object({
    followers: deltaSchema,
    subscribers: deltaSchema,
    totalViews: deltaSchema,
  }),
  /** Пиковое число зрителей за период. null, если эфира не было. */
  peakViewers: z.number().int().nonnegative().nullable(),
  /** Часы в эфире за период. */
  liveHours: z.number().nonnegative(),
});
export type ChannelSummary = z.infer<typeof channelSummarySchema>;

export const analyticsSeriesSchema = z.object({
  channelId: uuidSchema,
  range: analyticsRangeSchema,
  bucket: z.enum(['hour', 'day']),
  points: z.array(analyticsPointSchema),
});
export type AnalyticsSeries = z.infer<typeof analyticsSeriesSchema>;

/* ------------------------------------------------------------------ */
/* Подключение площадки                                                */
/* ------------------------------------------------------------------ */

/** Какие площадки вообще настроены в этой инсталляции. */
export const availablePlatformSchema = z.object({
  platform: platformSchema,
  title: z.string(),
  /** false — client id и secret не заданы, кнопку подключения показывать нельзя. */
  isConfigured: z.boolean(),
  /** Подключена ли площадка текущим пользователем. */
  isConnected: z.boolean(),
});
export type AvailablePlatform = z.infer<typeof availablePlatformSchema>;

export const authorizeResponseSchema = z.object({
  url: z.string().url(),
});
export type AuthorizeResponse = z.infer<typeof authorizeResponseSchema>;

/**
 * Включение площадки.
 *
 * Нужно там, где активной может быть одна: подключены обе, работает выбранная.
 * Литерал `true` не ставим — выключить канал стример тоже вправе, например,
 * чтобы перестать тратить квоту YouTube на канал, который сейчас не в эфире.
 */
export const setChannelEnabledSchema = z.object({ isEnabled: z.boolean() });
export type SetChannelEnabledInput = z.infer<typeof setChannelEnabledSchema>;

/* ------------------------------------------------------------------ */
/* Сводка по эфирам и донатам                                          */
/* ------------------------------------------------------------------ */

/** Прирост аудитории. null — снимков не хватило, чтобы сравнить. */
const audienceGainSchema = z.number().int().nullable();

/**
 * Корзина времени: донаты, минуты в эфире, прирост аудитории и события.
 *
 * Донаты — в основной валюте стримера (`AnalyticsOverview.currency`): сложить
 * рубли с тенге нельзя, а корзина без суммы бесполезна на графике.
 */
export const overviewBucketSchema = z.object({
  at: isoDateSchema,
  donationsMinor: z.number().int().nonnegative(),
  donationsCount: z.number().int().nonnegative(),
  /** Минут в эфире хотя бы на одной площадке — одновременный эфир не удваивается. */
  liveMinutes: z.number().int().nonnegative(),
  audienceGain: audienceGainSchema,
});
export type OverviewBucket = z.infer<typeof overviewBucketSchema>;

/**
 * Эфир — непрерывный отрезок «в эфире» хотя бы на одной площадке.
 *
 * Мультистрим на Twitch и YouTube одновременно — один эфир, а не два: донаты
 * приходят не с площадки, и разделить их между двумя эфирами было бы нечем.
 */
export const streamSessionSchema = z.object({
  startedAt: isoDateSchema,
  endedAt: isoDateSchema,
  minutes: z.number().int().nonnegative(),
  platforms: z.array(platformSchema).min(1),
  /** Пик зрителей, сложенный по площадкам в максимуме каждой. */
  peakViewers: z.number().int().nonnegative().nullable(),
  /** Средние зрители, сложенные по площадкам. */
  avgViewers: z.number().int().nonnegative().nullable(),
  donationsMinor: z.number().int().nonnegative(),
  donationsCount: z.number().int().nonnegative(),
  audienceGain: audienceGainSchema,
  /** Остальные события за эфир: фолловы, подписки, подарки, рейды… */
  events: z.number().int().nonnegative(),
});
export type StreamSession = z.infer<typeof streamSessionSchema>;

/** Клетка тепловой карты: день недели (1 — понедельник) и час по местному времени. */
export const donationHeatCellSchema = z.object({
  weekday: z.number().int().min(1).max(7),
  hour: z.number().int().min(0).max(23),
  amountMinor: z.number().int().nonnegative(),
  count: z.number().int().nonnegative(),
});
export type DonationHeatCell = z.infer<typeof donationHeatCellSchema>;

export const analyticsOverviewSchema = z.object({
  range: analyticsRangeSchema,
  bucket: z.enum(['hour', 'day']),
  /** Основная валюта донатов: в ней корзины, эфиры и тепловая карта. */
  currency: currencySchema,
  /** Донаты по всем валютам — итог периода без пересчёта курса. */
  donationTotals: z.array(donationTotalSchema),
  buckets: z.array(overviewBucketSchema),
  /** Эфиры периода, от старых к новым. */
  streams: z.array(streamSessionSchema),
  /** Сколько донатов основной валюты пришло во время эфиров. */
  donationsDuringStreamsMinor: z.number().int().nonnegative(),
  /** События периода по типам, кроме тестовых. */
  eventCounts: z.array(
    z.object({ type: alertEventTypeSchema, count: z.number().int().positive() }),
  ),
  /** Только непустые клетки. */
  heatmap: z.array(donationHeatCellSchema),
});
export type AnalyticsOverview = z.infer<typeof analyticsOverviewSchema>;
