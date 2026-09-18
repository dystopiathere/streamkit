import { z } from 'zod';
import { isoDateSchema, uuidSchema } from './common.js';

/** Донат-сервисы, которые подключаются кнопкой. Вебхук — отдельно: он для разработчиков. */
export const DONATION_SERVICES = ['donationalerts'] as const;
export const donationServiceSchema = z.enum(DONATION_SERVICES);
export type DonationService = z.infer<typeof donationServiceSchema>;

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
