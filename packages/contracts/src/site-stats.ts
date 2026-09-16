import { z } from 'zod';
import { uuidSchema } from './common.js';

/**
 * Статистика посещений публичных страниц — Umami на собственном сервере.
 *
 * Идентификатор сайта в Umami отдаёт API, а не сборка: он появляется только
 * после первого входа в развёрнутый Umami, и пересобирать ради него дашборд
 * незачем. null — статистика на этом сервере не настроена, и скрипт не грузится.
 */
export const siteStatsConfigSchema = z.object({
  umamiWebsiteId: uuidSchema.nullable(),
});
export type SiteStatsConfig = z.infer<typeof siteStatsConfigSchema>;

/**
 * Согласие анонимного посетителя на статистику.
 *
 * У посетителя главной нет учётной записи, и в журнал пользователя его ответ из
 * баннера не записать. Идентификатор — случайный, выпущен браузером и хранится
 * в нём же: он связывает запись журнала с этим браузером и больше ни с чем.
 */
export const visitorConsentInputSchema = z.object({
  visitorId: uuidSchema,
});
export type VisitorConsentInput = z.infer<typeof visitorConsentInputSchema>;

/**
 * Сколько действует согласие анонимного посетителя. Потом баннер спрашивает
 * снова: у посетителя нет раздела «Приватность», где он увидел бы, на что
 * соглашался год назад.
 */
export const VISITOR_CONSENT_TTL_DAYS = 365;
