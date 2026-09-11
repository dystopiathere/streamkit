import { z } from 'zod';
import { alertEventSchema } from './events.js';
import { alertWidgetConfigSchema } from './widgets.js';

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

export const configUpdatedMessageSchema = z.object({
  widgetId: z.string().uuid(),
  isEnabled: z.boolean(),
  config: alertWidgetConfigSchema,
});
export type ConfigUpdatedMessage = z.infer<typeof configUpdatedMessageSchema>;

export const revokedMessageSchema = z.object({
  reason: z.enum(['token-revoked', 'widget-deleted']),
});
export type RevokedMessage = z.infer<typeof revokedMessageSchema>;

/** Начальное состояние, которое overlay получает сразу после подключения. */
export const overlayBootstrapSchema = z.object({
  widgetId: z.string().uuid(),
  name: z.string(),
  isEnabled: z.boolean(),
  config: alertWidgetConfigSchema,
});
export type OverlayBootstrap = z.infer<typeof overlayBootstrapSchema>;
