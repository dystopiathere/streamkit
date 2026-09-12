import { z } from 'zod';
import { currencySchema, isoDateSchema, uuidSchema } from './common.js';

/* ------------------------------------------------------------------ */
/* Площадки                                                            */
/* ------------------------------------------------------------------ */

/**
 * Площадки, для которых есть сбор метрик.
 *
 * Список короче, чем enum `Platform` в схеме БД: там уже заведены VKPLAY и
 * TROVO под будущие коннекторы, но контракт описывает то, что реально работает.
 */
export const PLATFORMS = ['twitch', 'youtube'] as const;
export const platformSchema = z.enum(PLATFORMS);
export type Platform = z.infer<typeof platformSchema>;

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
  syncState: channelSyncStateSchema,
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

export const ANALYTICS_RANGES = ['24h', '7d', '30d'] as const;
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

const RANGE_HOURS: Record<AnalyticsRange, number> = { '24h': 24, '7d': 24 * 7, '30d': 24 * 30 };

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
  return range === '30d' ? 'day' : 'hour';
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
