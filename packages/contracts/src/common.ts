import { z } from 'zod';

/** Валюты, которые платформа умеет отображать. Расширяется по мере надобности. */
export const CURRENCIES = ['RUB', 'USD', 'EUR', 'KZT', 'BYN', 'UAH'] as const;
export const currencySchema = z.enum(CURRENCIES);
export type Currency = z.infer<typeof currencySchema>;

/**
 * Денежная сумма ВСЕГДА хранится в минорных единицах (копейки, центы) целым числом.
 * Плавающая точка для денег запрещена на всех уровнях: БД, API, фронт.
 */
export const moneySchema = z.object({
  amountMinor: z.number().int().nonnegative(),
  currency: currencySchema,
});
export type Money = z.infer<typeof moneySchema>;

/** Количество минорных единиц в мажорной. Все поддерживаемые валюты — сотенные. */
export const MINOR_UNITS_PER_MAJOR = 100;

export function toMinor(major: number, currency: Currency): Money {
  return {
    amountMinor: Math.round(major * MINOR_UNITS_PER_MAJOR),
    currency,
  };
}

export function formatMoney(money: Money, locale = 'ru-RU'): string {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: money.currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(money.amountMinor / MINOR_UNITS_PER_MAJOR);
}

export const uuidSchema = z.string().uuid();
export const isoDateSchema = z.string().datetime({ offset: true });

/** Цвет в формате #RRGGBB или #RRGGBBAA. */
export const hexColorSchema = z
  .string()
  .regex(/^#([0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/, 'Ожидается цвет в формате #RRGGBB или #RRGGBBAA');

/**
 * URL для медиа в виджетах. Только https — иначе браузер-сорс OBS заблокирует
 * смешанный контент, а http-ссылка на сторонний ресурс это ещё и утечка.
 */
export const httpsUrlSchema = z
  .string()
  .url()
  .max(2048)
  .refine((value) => value.startsWith('https://'), 'Разрешены только https-ссылки');

export const cursorPaginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().max(256).optional(),
});
export type CursorPagination = z.infer<typeof cursorPaginationSchema>;

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}
