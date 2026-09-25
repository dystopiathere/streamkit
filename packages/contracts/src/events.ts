import { z } from 'zod';
import { httpsUrlSchema, isoDateSchema, moneySchema, uuidSchema } from './common.js';
import { LANGUAGES } from './messages.js';

/**
 * Типы событий, которые могут вызвать алерт на стриме.
 *
 * Подарочные подписки — отдельный тип, а не `subscription`: у подписки автор —
 * тот, кто подписался, у подарка — тот, кто подарил, и шаблон «оформил
 * подписку» над дарителем пяти подписок читался бы неправдой.
 *
 * KICKs — отдельный тип, а не `cheer`: это другая валюта другой площадки, и
 * «500 битов» над подарком в KICKs было бы неправдой в кадре.
 */
export const ALERT_EVENT_TYPES = [
  'donation',
  'follow',
  'subscription',
  'gift',
  'resubscription',
  'cheer',
  'kicks',
  'raid',
  'reward',
] as const;
export const alertEventTypeSchema = z.enum(ALERT_EVENT_TYPES);
export type AlertEventType = z.infer<typeof alertEventTypeSchema>;

/** Источники событий. `manual` — тестовый алерт из дашборда. */
export const EVENT_PROVIDERS = [
  'donationalerts',
  'donatepay',
  'twitch',
  'youtube',
  'kick',
  'webhook',
  'manual',
] as const;
export const eventProviderSchema = z.enum(EVENT_PROVIDERS);
export type EventProvider = z.infer<typeof eventProviderSchema>;

/**
 * Количество в событии — не деньги: биты, зрители рейда, месяцы подписки,
 * число подарочных подписок. Отдельно от `amount`: биты не валюта, и сложить
 * их с рублями в цели или топе значило бы посчитать то, чего нет.
 */
export const eventCountSchema = z
  .number()
  .int()
  .nonnegative()
  .max(1_000_000_000)
  .nullable()
  .default(null);

/**
 * Нормализованное событие от коннектора. Ещё не сохранено: без `id` и без времени
 * записи. `externalId` — идентификатор события на стороне провайдера, по нему
 * строится дедупликация; если провайдер его не даёт, коннектор обязан собрать
 * стабильный синтетический ключ.
 */
export const incomingAlertEventSchema = z.object({
  userId: uuidSchema,
  type: alertEventTypeSchema,
  provider: eventProviderSchema,
  externalId: z.string().min(1).max(256),
  username: z.string().min(1).max(64),
  message: z.string().max(500).default(''),
  amount: moneySchema.nullable().default(null),
  count: eventCountSchema,
  /**
   * Голосовой донат: ссылка на запись у провайдера, а не текст.
   *
   * Файл остаётся у него — мы храним только ссылку и проигрываем её в кадре.
   * Своего хранилища для чужого голоса заводить нечего: это данные третьего
   * лица, поручённые стримером, и срок их жизни должен совпадать со сроком
   * жизни самого события.
   */
  audioUrl: httpsUrlSchema.nullable().default(null),
  isTest: z.boolean().default(false),
  occurredAt: isoDateSchema.optional(),
});
export type IncomingAlertEvent = z.infer<typeof incomingAlertEventSchema>;

/** Событие, уже сохранённое в БД и пригодное для отправки в overlay. */
export const alertEventSchema = incomingAlertEventSchema.extend({
  id: uuidSchema,
  createdAt: isoDateSchema,
});
export type AlertEvent = z.infer<typeof alertEventSchema>;

/**
 * Ключ дедупликации. Провайдеры переотправляют события при реконнекте, а дубль
 * алерта виден зрителям на стриме — поэтому ключ строится до любой записи в БД.
 */
export function dedupKey(event: Pick<IncomingAlertEvent, 'provider' | 'externalId'>): string {
  return `dedup:${event.provider}:${event.externalId}`;
}

/** Тело собственного входящего вебхука (подписывается HMAC, см. apps/api). */
export const webhookAlertPayloadSchema = z.object({
  type: alertEventTypeSchema.default('donation'),
  externalId: z.string().min(1).max(256),
  username: z.string().min(1).max(64),
  message: z.string().max(500).default(''),
  amount: moneySchema.nullable().default(null),
  count: eventCountSchema,
  /** Голосовой донат: ссылка на запись. Только https — её играет браузер-сорс. */
  audioUrl: httpsUrlSchema.nullable().default(null),
  occurredAt: isoDateSchema.optional(),
});
export type WebhookAlertPayload = z.infer<typeof webhookAlertPayloadSchema>;

/**
 * Страница истории событий.
 *
 * Номера страниц, а не курсор: стример листает историю, чтобы найти донат
 * «где-то на прошлой неделе», и прыжок на пятую страницу ему нужнее, чем
 * «дальше» пять раз. Сдвиг, от которого курсор защищает, закрыт отсечкой
 * `until`: страницы считаются от момента первой загрузки, и донат, пришедший
 * во время листания, не сдвигает строки между страницами — он появляется
 * наверху первой, когда стример к ней вернётся.
 */
export const EVENTS_PAGE_SIZES = [25, 50, 100] as const;

export const eventsPageQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(100_000).default(1),
  pageSize: z.coerce
    .number()
    .int()
    .refine((value) => (EVENTS_PAGE_SIZES as readonly number[]).includes(value), {
      message: 'Недопустимый размер страницы',
    })
    .default(25),
  until: isoDateSchema.optional(),
});
export type EventsPageQuery = z.infer<typeof eventsPageQuerySchema>;

export const eventsPageSchema = z.object({
  items: z.array(alertEventSchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1),
  /** Отсечка, от которой считаются страницы: её передают в следующие запросы. */
  until: isoDateSchema,
});
export type EventsPage = z.infer<typeof eventsPageSchema>;

/**
 * Итог обнуления истории событий.
 *
 * Число удалённых записей возвращается, чтобы подтверждение в интерфейсе было
 * про то, что произошло («удалено 412 событий»), а не про то, что кнопка
 * нажалась. Восстановить их нечем, и это единственное сообщение об объёме
 * потери, которое стример увидит.
 */
export const eventsResetResultSchema = z.object({
  removedEvents: z.number().int().nonnegative(),
  /**
   * Сколько виджетов пересчитались вместе с историей: цель и топ донатеров
   * считаются по событиям, и открытые в OBS сцены должны узнать новую сумму
   * сразу, а не при следующем донате.
   */
  refreshedWidgets: z.number().int().nonnegative(),
});
export type EventsResetResult = z.infer<typeof eventsResetResultSchema>;

/**
 * Тестовый алерт из дашборда. Имя и текст пишет сервер — на языке интерфейса
 * стримера: алерт уходит в OBS, и английский дашборд с «Тестовым зрителем» в
 * кадре выглядел бы поломкой перевода. Без тела — донат по-русски: Express 5
 * оставляет `body` неопределённым, если его нет, отсюда `.default({})`.
 * `type` — сценарий, который стример настраивает: у каждого своя проверка.
 */
export const testEventSchema = z
  .object({
    language: z.enum(LANGUAGES).optional(),
    type: alertEventTypeSchema.optional(),
    /**
     * Сумма тестового доната — проверка триггера: «донат от тысячи» с
     * тестовыми 500 ₽ не проверить. У остальных типов суммы нет, и её нет в тесте.
     */
    amount: moneySchema.optional(),
  })
  .default({});
export type TestEventInput = z.infer<typeof testEventSchema>;
