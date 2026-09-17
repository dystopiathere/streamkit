import { z } from 'zod';
import { CHANNEL_SYNC_STATES, PLATFORMS } from './analytics.js';
import { emailSchema, publicUserSchema } from './auth.js';
import { paymentViewSchema, PAYMENT_STATUSES, subscriptionViewSchema } from './billing.js';
import {
  currencySchema,
  cursorPaginationSchema,
  isoDateSchema,
  moneySchema,
  uuidSchema,
} from './common.js';
import { EVENT_PROVIDERS } from './events.js';
import { WIDGET_TYPES } from './widgets.js';

/**
 * Административная панель.
 *
 * Чего здесь нет и не должно появиться: имён и сообщений донатеров, ников
 * зрителей чата, имён гостей. Это данные стримера, платформа обрабатывает их по
 * его поручению и обещала не использовать в своих целях (соглашение, раздел
 * 13). События в админке — только числа.
 */

/* ------------------------------------------------------------------ */
/* Роли и вход                                                         */
/* ------------------------------------------------------------------ */

export const USER_ROLES = ['user', 'support', 'admin'] as const;
export const userRoleSchema = z.enum(USER_ROLES);
export type UserRole = z.infer<typeof userRoleSchema>;

/** Роли сотрудников: только они входят в админку. */
export const STAFF_ROLES = ['support', 'admin'] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

/** Хватает ли роли для действия: `admin` может всё, что может `support`. */
export function roleAllows(role: UserRole, required: StaffRole): boolean {
  if (role === 'admin') return true;
  return role === 'support' && required === 'support';
}

export const USER_STATUSES = ['active', 'suspended', 'anonymized'] as const;
export const userStatusSchema = z.enum(USER_STATUSES);
export type UserStatus = z.infer<typeof userStatusSchema>;

/** Вход в админку: второй фактор обязателен, без него вход не начинается. */
export const adminLoginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(128),
  totpCode: z.string().regex(/^\d{6}$/, 'Код из 6 цифр'),
});
export type AdminLoginInput = z.infer<typeof adminLoginSchema>;

export const adminMeSchema = publicUserSchema.extend({
  role: z.enum(STAFF_ROLES),
});
export type AdminMe = z.infer<typeof adminMeSchema>;

export const adminAuthResultSchema = z.object({
  accessToken: z.string(),
  expiresIn: z.number().int().positive(),
  user: adminMeSchema,
});
export type AdminAuthResult = z.infer<typeof adminAuthResultSchema>;

/* ------------------------------------------------------------------ */
/* Пользователи                                                        */
/* ------------------------------------------------------------------ */

export const ADMIN_SUBSCRIPTION_FILTERS = ['any', 'active', 'grace', 'expired', 'none'] as const;

export const adminUserListQuerySchema = cursorPaginationSchema.extend({
  /** Поиск по почте, имени или точному идентификатору. */
  q: z.string().trim().max(254).optional(),
  status: userStatusSchema.optional(),
  role: userRoleSchema.optional(),
  subscription: z.enum(ADMIN_SUBSCRIPTION_FILTERS).default('any'),
});
export type AdminUserListQuery = z.infer<typeof adminUserListQuerySchema>;

export const adminUserRowSchema = z.object({
  id: uuidSchema,
  email: z.string(),
  displayName: z.string(),
  role: userRoleSchema,
  status: userStatusSchema,
  isTotpEnabled: z.boolean(),
  createdAt: isoDateSchema,
  /** Последнее обновление сессии дашборда. null — не входил с момента очистки сессий. */
  lastSeenAt: isoDateSchema.nullable(),
  subscriptionStatus: subscriptionViewSchema.shape.status,
  widgetCount: z.number().int().min(0),
});
export type AdminUserRow = z.infer<typeof adminUserRowSchema>;

export const adminSessionSchema = z.object({
  id: uuidSchema,
  scope: z.enum(['user', 'admin']),
  createdAt: isoDateSchema,
  lastUsedAt: isoDateSchema,
  userAgent: z.string().nullable(),
});
export type AdminSession = z.infer<typeof adminSessionSchema>;

export const adminOverlayTokenSchema = z.object({
  id: uuidSchema,
  label: z.string().nullable(),
  createdAt: isoDateSchema,
  lastSeenAt: isoDateSchema.nullable(),
  revokedAt: isoDateSchema.nullable(),
});
export type AdminOverlayToken = z.infer<typeof adminOverlayTokenSchema>;

export const adminWidgetSchema = z.object({
  id: uuidSchema,
  userId: uuidSchema,
  ownerEmail: z.string(),
  type: z.enum(WIDGET_TYPES),
  name: z.string(),
  isEnabled: z.boolean(),
  createdAt: isoDateSchema,
  activeTokenCount: z.number().int().min(0),
  lastSeenAt: isoDateSchema.nullable(),
});
export type AdminWidget = z.infer<typeof adminWidgetSchema>;

export const adminRoomSchema = z.object({
  id: uuidSchema,
  userId: uuidSchema,
  ownerEmail: z.string(),
  name: z.string(),
  createdAt: isoDateSchema,
  activeInviteCount: z.number().int().min(0),
});
export type AdminRoom = z.infer<typeof adminRoomSchema>;

export const adminInviteSchema = z.object({
  id: uuidSchema,
  label: z.string(),
  createdAt: isoDateSchema,
  lastUsedAt: isoDateSchema.nullable(),
  revokedAt: isoDateSchema.nullable(),
});
export type AdminInvite = z.infer<typeof adminInviteSchema>;

export const adminChannelSchema = z.object({
  id: uuidSchema,
  userId: uuidSchema,
  ownerEmail: z.string(),
  platform: z.enum(PLATFORMS),
  login: z.string(),
  displayName: z.string(),
  isEnabled: z.boolean(),
  syncState: z.enum(CHANNEL_SYNC_STATES),
  /** Внутренняя причина сбоя. Стримеру не показывается, сотруднику — да. */
  syncError: z.string().nullable(),
  syncAttempts: z.number().int().min(0),
  lastSyncedAt: isoDateSchema.nullable(),
  nextAttemptAt: isoDateSchema.nullable(),
});
export type AdminChannel = z.infer<typeof adminChannelSchema>;

export const adminDonationSourceSchema = z.object({
  provider: z.enum(EVENT_PROVIDERS),
  isEnabled: z.boolean(),
  disabledReason: z.string().nullable(),
  lastEventAt: isoDateSchema.nullable(),
});

export const adminConsentSchema = z.object({
  document: z.string(),
  documentVersion: z.string(),
  grantedAt: isoDateSchema,
  revokedAt: isoDateSchema.nullable(),
});

export const adminUserDetailSchema = z.object({
  user: adminUserRowSchema.omit({ subscriptionStatus: true, widgetCount: true }).extend({
    anonymizedAt: isoDateSchema.nullable(),
  }),
  sessions: z.array(adminSessionSchema),
  consents: z.array(adminConsentSchema),
  subscription: subscriptionViewSchema,
  payments: z.array(paymentViewSchema),
  widgets: z.array(
    adminWidgetSchema.omit({ userId: true, ownerEmail: true }).extend({
      tokens: z.array(adminOverlayTokenSchema),
    }),
  ),
  rooms: z.array(adminRoomSchema.omit({ userId: true, ownerEmail: true })),
  channels: z.array(adminChannelSchema.omit({ userId: true, ownerEmail: true })),
  donationSources: z.array(adminDonationSourceSchema),
  /** Сколько событий пришло за всё время — число, без самих событий. */
  eventCount: z.number().int().min(0),
});
export type AdminUserDetail = z.infer<typeof adminUserDetailSchema>;

export const suspendUserSchema = z.object({
  /** Причина уходит в журнал действий: блокировка без основания не делается. */
  reason: z.string().trim().min(1, 'Укажите причину').max(500),
});
export type SuspendUserInput = z.infer<typeof suspendUserSchema>;

export const setUserRoleSchema = z.object({ role: userRoleSchema });
export type SetUserRoleInput = z.infer<typeof setUserRoleSchema>;

/** Обезличивание необратимо: подтверждается вводом почты аккаунта. */
export const anonymizeUserSchema = z.object({ confirmEmail: emailSchema });
export type AnonymizeUserInput = z.infer<typeof anonymizeUserSchema>;

export const revokeSessionsSchema = z.object({
  /** Одно устройство; без значения — все сессии пользователя. */
  familyId: uuidSchema.optional(),
});
export type RevokeSessionsInput = z.infer<typeof revokeSessionsSchema>;

/**
 * Правка подписки из админки.
 *
 * Только выключение автопродления: включить его за пользователя нельзя —
 * согласие на списания даёт он сам.
 */
export const adminUpdateSubscriptionSchema = z.object({ autoRenew: z.literal(false) });
export type AdminUpdateSubscriptionInput = z.infer<typeof adminUpdateSubscriptionSchema>;

/** Бесплатные дни — например, в компенсацию сбоя. */
export const extendSubscriptionSchema = z.object({
  days: z.coerce.number().int().min(1).max(366),
  reason: z.string().trim().min(1, 'Укажите причину').max(500),
});
export type ExtendSubscriptionInput = z.infer<typeof extendSubscriptionSchema>;

/* ------------------------------------------------------------------ */
/* Списки объектов                                                     */
/* ------------------------------------------------------------------ */

export const adminWidgetListQuerySchema = cursorPaginationSchema.extend({
  userId: uuidSchema.optional(),
  type: z.enum(WIDGET_TYPES).optional(),
  enabled: z.enum(['true', 'false']).optional(),
});
export type AdminWidgetListQuery = z.infer<typeof adminWidgetListQuerySchema>;

export const adminSetWidgetEnabledSchema = z.object({ isEnabled: z.boolean() });

export const adminRoomListQuerySchema = cursorPaginationSchema.extend({
  userId: uuidSchema.optional(),
});
export type AdminRoomListQuery = z.infer<typeof adminRoomListQuerySchema>;

export const adminChannelListQuerySchema = cursorPaginationSchema.extend({
  userId: uuidSchema.optional(),
  platform: z.enum(PLATFORMS).optional(),
  syncState: z.enum(CHANNEL_SYNC_STATES).optional(),
});
export type AdminChannelListQuery = z.infer<typeof adminChannelListQuerySchema>;

export const adminPaymentSchema = paymentViewSchema.extend({
  userId: uuidSchema,
  ownerEmail: z.string(),
  cancellationReason: z.string().nullable(),
});
export type AdminPayment = z.infer<typeof adminPaymentSchema>;

export const adminPaymentListQuerySchema = cursorPaginationSchema.extend({
  userId: uuidSchema.optional(),
  status: z.enum(PAYMENT_STATUSES).optional(),
});
export type AdminPaymentListQuery = z.infer<typeof adminPaymentListQuerySchema>;

export const adminAuditEntrySchema = z.object({
  id: uuidSchema,
  action: z.string(),
  userId: uuidSchema.nullable(),
  userEmail: z.string().nullable(),
  actorId: uuidSchema.nullable(),
  actorEmail: z.string().nullable(),
  metadata: z.record(z.string(), z.unknown()).nullable(),
  createdAt: isoDateSchema,
});
export type AdminAuditEntry = z.infer<typeof adminAuditEntrySchema>;

export const adminAuditQuerySchema = cursorPaginationSchema.extend({
  /** Префикс действия: `admin.` — все действия сотрудников. */
  action: z
    .string()
    .trim()
    .regex(/^[a-z_.]+$/, 'Только латиница, точка и подчёркивание')
    .max(64)
    .optional(),
  userId: uuidSchema.optional(),
  actorId: uuidSchema.optional(),
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
});
export type AdminAuditQuery = z.infer<typeof adminAuditQuerySchema>;

/* ------------------------------------------------------------------ */
/* Статистика платформы                                                */
/* ------------------------------------------------------------------ */

export const ADMIN_STATS_RANGES = ['30d', '90d', '365d'] as const;
export const adminStatsRangeSchema = z.enum(ADMIN_STATS_RANGES);
export type AdminStatsRange = z.infer<typeof adminStatsRangeSchema>;

export const adminStatsQuerySchema = z.object({
  range: adminStatsRangeSchema.default('30d'),
});

/** Длина диапазона в днях. */
export const ADMIN_STATS_RANGE_DAYS: Record<AdminStatsRange, number> = {
  '30d': 30,
  '90d': 90,
  '365d': 365,
};

/** Год по дням — 365 столбиков, читать нельзя. Там корзина — неделя. */
export function adminStatsBucket(range: AdminStatsRange): 'day' | 'week' {
  return range === '365d' ? 'week' : 'day';
}

export const adminStatsPointSchema = z.object({
  at: isoDateSchema,
  value: z.number().int(),
});
export type AdminStatsPoint = z.infer<typeof adminStatsPointSchema>;

export const adminStatsSchema = z.object({
  range: adminStatsRangeSchema,
  bucket: z.enum(['day', 'week']),
  generatedAt: isoDateSchema,
  users: z.object({
    total: z.number().int(),
    suspended: z.number().int(),
    /** Обновляли сессию дашборда за 7 и 30 дней. */
    active7d: z.number().int(),
    active30d: z.number().int(),
  }),
  subscriptions: z.object({
    activeMonth: z.number().int(),
    activeYear: z.number().int(),
    grace: z.number().int(),
    /** Продление, которое не спишется: автопродление выключено у активных. */
    endingWithoutRenewal: z.number().int(),
    mrr: z.array(moneySchema),
    renewalFailures: z.number().int(),
  }),
  widgets: z.array(
    z.object({ type: z.enum(WIDGET_TYPES), total: z.number().int(), enabled: z.number().int() }),
  ),
  /** Ссылки OBS, открывавшиеся за последние сутки. */
  liveOverlays: z.number().int(),
  channels: z.array(
    z.object({
      platform: z.enum(PLATFORMS),
      syncState: z.enum(CHANNEL_SYNC_STATES),
      count: z.number().int(),
    }),
  ),
  /** Расход дневной квоты YouTube. null — площадка не настроена. */
  youtubeQuota: z.object({ used: z.number().int(), limit: z.number().int() }).nullable(),
  eventsByProvider: z.array(
    z.object({ provider: z.enum(EVENT_PROVIDERS), count: z.number().int() }),
  ),
  series: z.object({
    registrations: z.array(adminStatsPointSchema),
    /** Успешные входы в дашборд. Журнал хранится 180 дней — год виден не целиком. */
    logins: z.array(adminStatsPointSchema),
    events: z.array(adminStatsPointSchema),
    rooms: z.array(adminStatsPointSchema),
    /** Оплаты за вычетом возвратов, в минорных единицах, по валютам. */
    revenue: z.array(
      z.object({ currency: currencySchema, points: z.array(adminStatsPointSchema) }),
    ),
  }),
});
export type AdminStats = z.infer<typeof adminStatsSchema>;
