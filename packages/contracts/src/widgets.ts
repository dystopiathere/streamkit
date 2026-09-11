import { z } from 'zod';
import { hexColorSchema, httpsUrlSchema, isoDateSchema, uuidSchema } from './common.js';
import { type AlertEvent, alertEventTypeSchema } from './events.js';

/** Типы виджетов. Новый тип = новая ветка в widgetConfigSchema + рендерер в packages/ui. */
export const WIDGET_TYPES = ['alerts'] as const;
export const widgetTypeSchema = z.enum(WIDGET_TYPES);
export type WidgetType = z.infer<typeof widgetTypeSchema>;

export const alertLayoutSchema = z.enum(['banner', 'center', 'side']);
export const alertAnimationSchema = z.enum(['fade', 'slide-up', 'slide-left', 'zoom', 'bounce']);

export const alertTextStyleSchema = z.object({
  fontFamily: z.string().min(1).max(64).default('Inter'),
  fontSize: z.number().int().min(8).max(200).default(32),
  color: hexColorSchema.default('#FFFFFF'),
  highlightColor: hexColorSchema.default('#8B5CF6'),
  strokeColor: hexColorSchema.default('#000000'),
  strokeWidth: z.number().int().min(0).max(12).default(2),
  uppercase: z.boolean().default(false),
});
export type AlertTextStyle = z.infer<typeof alertTextStyleSchema>;

export const alertSoundSchema = z.object({
  enabled: z.boolean().default(false),
  url: httpsUrlSchema.nullable().default(null),
  volume: z.number().min(0).max(1).default(0.6),
});
export type AlertSound = z.infer<typeof alertSoundSchema>;

/**
 * Конфиг alert-виджета. Одна и та же схема валидирует запись в API, генерирует форму
 * настроек в дашборде и управляет рендером в overlay.
 */
export const alertWidgetConfigSchema = z.object({
  layout: alertLayoutSchema.default('center'),
  /** Сколько алерт висит на экране. */
  durationMs: z.number().int().min(1000).max(60000).default(6000),
  /** Пауза между алертами, чтобы они не слипались. */
  gapMs: z.number().int().min(0).max(10000).default(500),
  /** Алерты дешевле порога не показываются (0 — показывать все). */
  minAmountMinor: z.number().int().nonnegative().default(0),
  /** Какие типы событий этот виджет вообще показывает. */
  eventTypes: z.array(alertEventTypeSchema).min(1).default(['donation']),
  imageUrl: httpsUrlSchema.nullable().default(null),
  titleTemplate: z.string().min(1).max(200).default('{username} — {amount}'),
  messageTemplate: z.string().max(300).default('{message}'),
  text: alertTextStyleSchema.default({}),
  sound: alertSoundSchema.default({}),
  animationIn: alertAnimationSchema.default('slide-up'),
  animationOut: alertAnimationSchema.default('fade'),
});
export type AlertWidgetConfig = z.infer<typeof alertWidgetConfigSchema>;

/** Дискриминированное объединение по типу виджета: добавление типа не ломает старые. */
export const widgetConfigSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('alerts'), config: alertWidgetConfigSchema }),
]);
export type WidgetConfig = z.infer<typeof widgetConfigSchema>;

export const widgetSchema = z
  .object({
    id: uuidSchema,
    userId: uuidSchema,
    name: z.string().min(1).max(80),
    isEnabled: z.boolean(),
    createdAt: isoDateSchema,
    updatedAt: isoDateSchema,
  })
  .and(widgetConfigSchema);
export type Widget = z.infer<typeof widgetSchema>;

export const createWidgetSchema = z
  .object({
    name: z.string().min(1).max(80),
  })
  .and(widgetConfigSchema);
export type CreateWidgetInput = z.infer<typeof createWidgetSchema>;

export const updateWidgetSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  isEnabled: z.boolean().optional(),
  config: alertWidgetConfigSchema.partial().optional(),
});
export type UpdateWidgetInput = z.infer<typeof updateWidgetSchema>;

/** Дефолтный конфиг для только что созданного виджета. */
export function defaultAlertWidgetConfig(): AlertWidgetConfig {
  return alertWidgetConfigSchema.parse({});
}

/* ------------------------------------------------------------------ */
/* Шаблоны текста                                                       */
/* ------------------------------------------------------------------ */

export const ALERT_TEMPLATE_VARS = ['username', 'amount', 'message', 'type'] as const;
export type AlertTemplateVar = (typeof ALERT_TEMPLATE_VARS)[number];

/**
 * Подстановка переменных в пользовательский шаблон.
 *
 * ВАЖНО: результат — обычный текст и вставляется только через textContent/JSX.
 * Никогда не рендерить его как HTML: шаблон пишет пользователь, а overlay открыт
 * по публичной ссылке.
 */
export function renderTemplate(
  template: string,
  vars: Partial<Record<AlertTemplateVar, string>>,
): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => {
    const value = vars[key as AlertTemplateVar];
    return value === undefined ? match : value;
  });
}

/**
 * Решение «показывать ли событие этим виджетом». Общая логика для бэкенда
 * (не слать лишнего в сокет) и overlay (страховка на клиенте).
 */
export function shouldShowAlert(
  event: Pick<AlertEvent, 'type' | 'amount' | 'isTest'>,
  config: Pick<AlertWidgetConfig, 'eventTypes' | 'minAmountMinor'>,
): boolean {
  if (event.isTest) return true;
  if (!config.eventTypes.includes(event.type)) return false;
  if (config.minAmountMinor > 0) {
    if (!event.amount) return false;
    if (event.amount.amountMinor < config.minAmountMinor) return false;
  }
  return true;
}
