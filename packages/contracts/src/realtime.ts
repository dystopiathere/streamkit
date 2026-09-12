import { z } from 'zod';
import { channelStatsSchema } from './analytics.js';
import { alertEventSchema } from './events.js';
import { widgetConfigSchema, widgetStateSchema } from './widgets.js';

/**
 * Имена socket.io-событий. Вынесены в константы, чтобы опечатка в строке
 * ловилась компилятором, а не тишиной в проде.
 */
export const SOCKET_EVENTS = {
  /** Сервер → overlay: показать алерт. */
  alert: 'alert',
  /** Сервер → overlay: конфиг изменился, применить без перезагрузки страницы. */
  configUpdated: 'config:updated',
  /** Сервер → overlay: токен отозван, соединение сейчас закроется. */
  revoked: 'revoked',
  /** Сервер → дашборд: новое событие в истории. */
  eventCreated: 'event:created',
  /** Сервер → дашборд: свежие метрики канала. */
  analyticsUpdated: 'analytics:updated',
  /** Сервер → overlay: пересчитанное состояние виджета (цель, таймер, топ). */
  widgetState: 'widget:state',
} as const;

export type SocketEventName = (typeof SOCKET_EVENTS)[keyof typeof SOCKET_EVENTS];

/** Комната overlay-соединения. Ключ — id токена, не сам токен. */
export function overlayRoom(tokenId: string): string {
  return `overlay:${tokenId}`;
}

/** Комната личного кабинета пользователя. */
export function dashboardRoom(userId: string): string {
  return `dashboard:${userId}`;
}

export const alertMessageSchema = z.object({
  event: alertEventSchema,
});
export type AlertMessage = z.infer<typeof alertMessageSchema>;

/**
 * Конфиг приезжает вместе с типом виджета.
 *
 * Без типа оверлей не знает, чем именно рендерить присланный объект: раньше тип
 * был ровно один, и его можно было не передавать.
 */
export const configUpdatedMessageSchema = z
  .object({
    widgetId: z.string().uuid(),
    isEnabled: z.boolean(),
  })
  .and(widgetConfigSchema);
export type ConfigUpdatedMessage = z.infer<typeof configUpdatedMessageSchema>;

/** Пересчитанное сервером состояние виджета. */
export const widgetStateMessageSchema = z.object({
  widgetId: z.string().uuid(),
  state: widgetStateSchema,
});
export type WidgetStateMessage = z.infer<typeof widgetStateMessageSchema>;

export const revokedMessageSchema = z.object({
  reason: z.enum(['token-revoked', 'widget-deleted']),
});
export type RevokedMessage = z.infer<typeof revokedMessageSchema>;

/**
 * Свежий снимок метрик канала.
 *
 * Приходит в дашборд сам, а не запрашивается: иначе открытая вкладка
 * «Аналитика» превратилась бы в генератор запросов к API раз в минуту.
 */
export const analyticsUpdatedMessageSchema = z.object({
  channelId: z.string().uuid(),
  stats: channelStatsSchema,
});
export type AnalyticsUpdatedMessage = z.infer<typeof analyticsUpdatedMessageSchema>;

/** Начальное состояние, которое overlay получает сразу после подключения. */
export const overlayBootstrapSchema = z
  .object({
    widgetId: z.string().uuid(),
    name: z.string(),
    isEnabled: z.boolean(),
    /** Состояние считается сервером; у alert-виджета его нет. */
    state: widgetStateSchema.nullable().default(null),
  })
  .and(widgetConfigSchema);
export type OverlayBootstrap = z.infer<typeof overlayBootstrapSchema>;
