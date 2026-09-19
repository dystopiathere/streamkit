import { z } from 'zod';
import { isoDateSchema, moneySchema, uuidSchema } from './common.js';
import { LANGUAGES } from './messages.js';

/**
 * Типы событий, которые могут вызвать алерт на стриме.
 *
 * Подарочные подписки — отдельный тип, а не `subscription`: у подписки автор —
 * тот, кто подписался, у подарка — тот, кто подарил, и шаблон «оформил
 * подписку» над дарителем пяти подписок читался бы неправдой.
 */
export const ALERT_EVENT_TYPES = [
  'donation',
  'follow',
  'subscription',
  'gift',
  'resubscription',
  'cheer',
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
  occurredAt: isoDateSchema.optional(),
});
export type WebhookAlertPayload = z.infer<typeof webhookAlertPayloadSchema>;

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
  })
  .default({});
export type TestEventInput = z.infer<typeof testEventSchema>;
