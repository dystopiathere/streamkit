import { z } from 'zod';
import { isoDateSchema, uuidSchema } from './common.js';

/** Донат-сервисы, которые подключает сам стример. Вебхук — отдельно: он для разработчиков. */
export const DONATION_SERVICES = ['donationalerts', 'donatepay'] as const;
export const donationServiceSchema = z.enum(DONATION_SERVICES);
export type DonationService = z.infer<typeof donationServiceSchema>;

/**
 * Как сервис подключается: входом в сервис (OAuth) или ключом API, который
 * стример копирует из кабинета сервиса. У DonatePay OAuth для сторонних
 * приложений нет — только личный ключ.
 */
export const DONATION_SERVICE_CONNECTIONS = ['oauth', 'api_key'] as const;
export const donationServiceConnectionSchema = z.enum(DONATION_SERVICE_CONNECTIONS);
export type DonationServiceConnection = z.infer<typeof donationServiceConnectionSchema>;

/** Сервисы, которые подключаются ключом API. */
export const apiKeyDonationServiceSchema = z.enum(['donatepay']);
export type ApiKeyDonationService = z.infer<typeof apiKeyDonationServiceSchema>;

/**
 * Ключ API донат-сервиса. Хранится только шифротекстом и наружу не отдаётся —
 * ни в списке источников, ни сотруднику.
 */
export const donationServiceKeySchema = z.object({
  apiKey: z.string().trim().min(1, 'Вставьте ключ API').max(256, 'Ключ API длиннее, чем бывает'),
});
export type DonationServiceKey = z.infer<typeof donationServiceKeySchema>;

/**
 * Донат-сервис на странице «Источники».
 *
 * `disabledReason` — почему источник выключили мы, а не стример: истёк доступ,
 * сервис отозвал приложение. Без него выключенный источник выглядел бы в
 * дашборде так же, как никогда не подключённый.
 */
export const donationServiceViewSchema = z.object({
  service: donationServiceSchema,
  title: z.string(),
  connection: donationServiceConnectionSchema,
  /** false — приложение сервиса не настроено на сервере, подключать нечем. */
  isConfigured: z.boolean(),
  isConnected: z.boolean(),
  isEnabled: z.boolean(),
  accountName: z.string().nullable(),
  disabledReason: z.string().nullable(),
  lastEventAt: isoDateSchema.nullable(),
});
export type DonationServiceView = z.infer<typeof donationServiceViewSchema>;

/** Собственный вебхук. Секрета в ответе нет: он показывается один раз при выпуске. */
export const webhookSourceViewSchema = z.object({
  sourceId: uuidSchema,
  isEnabled: z.boolean(),
  lastEventAt: isoDateSchema.nullable(),
});
export type WebhookSourceView = z.infer<typeof webhookSourceViewSchema>;

export const donationSourcesSchema = z.object({
  services: z.array(donationServiceViewSchema),
  /** null — вебхук ещё не заводили. */
  webhook: webhookSourceViewSchema.nullable(),
});
export type DonationSources = z.infer<typeof donationSourcesSchema>;
