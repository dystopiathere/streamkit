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
  /**
   * Сервер → overlay: начальное состояние сразу после подключения.
   *
   * Отдельное событие от configUpdated, а не то же самое. Раньше оно было одним,
   * и это молча ломало обновление настроек: bootstrap несёт имя виджета и его
   * состояние, обновление конфига — нет, а схема требовала имя обязательным.
   * Сообщение о смене настроек не проходило разбор и отбрасывалось целиком.
   */
  bootstrap: 'overlay:bootstrap',
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
  /** Сервер → overlay: сообщение чата площадки. */
  chatMessage: 'chat:message',
} as const;

export type SocketEventName = (typeof SOCKET_EVENTS)[keyof typeof SOCKET_EVENTS];

/** Комната overlay-соединения. Ключ — id токена, не сам токен. */
export function overlayRoom(tokenId: string): string {
  return `overlay:${tokenId}`;
}

/**
 * Комната всех сокетов одного виджета — по ней рассылается смена настроек.
 *
 * Живёт в контрактах, а не в шлюзе: по этой же комнате шлюз переселяет
 * оверлеи чата, когда стример поменял канал в настройках.
 */
export function widgetRoom(widgetId: string): string {
  return `widget:${widgetId}`;
}

/**
 * Комната одного канала чата.
 *
 * Ключ — КАНАЛ, а не пользователь, и это выбор с последствиями. Сообщения чата
 * идут сотнями в минуту: адресуй их по пользователю — и на каждое пришлось бы
 * спрашивать у БД, какие у него виджеты, то есть повторять запрос, который уже
 * числится в известных ограничениях на куда более редких донатах. По каналу
 * сообщение уходит в комнату напрямую, без единого запроса.
 *
 * Побочная выгода: два стримера, смотрящие один канал, делят одну комнату.
 */
export function chatRoom(platform: string, channel: string): string {
  return `chat:${platform}:${channel}`;
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
 *
 * Состояния здесь нет НАМЕРЕННО. «Настройки изменились» не означает «состояния
 * больше нет»: если бы поле было и приезжало пустым, правка заголовка цели во
 * время эфира обнуляла бы собранную сумму на экране, а идущий марафон
 * откатывался бы к начальной длительности.
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

/**
 * Причины отзыва ссылки. `owner-suspended` — аккаунт владельца заблокирован:
 * оверлей закрывает соединение так же, как при отзыве, и после разблокировки
 * источник в OBS нужно обновить.
 */
export const OVERLAY_REVOKE_REASONS = [
  'token-revoked',
  'widget-deleted',
  'owner-suspended',
] as const;
export type OverlayRevokeReason = (typeof OVERLAY_REVOKE_REASONS)[number];

export const revokedMessageSchema = z.object({
  reason: z.enum(OVERLAY_REVOKE_REASONS),
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

/**
 * Начальное состояние, которое overlay получает сразу после подключения.
 *
 * Приезжает своим событием (SOCKET_EVENTS.bootstrap), а не тем же, что смена
 * настроек: только здесь есть имя виджета и посчитанное сервером состояние.
 */
export const overlayBootstrapSchema = z
  .object({
    widgetId: z.string().uuid(),
    name: z.string(),
    isEnabled: z.boolean(),
    /** Состояние считается сервером; у alert-виджета его нет. */
    state: widgetStateSchema.nullable(),
  })
  .and(widgetConfigSchema);
export type OverlayBootstrap = z.infer<typeof overlayBootstrapSchema>;
