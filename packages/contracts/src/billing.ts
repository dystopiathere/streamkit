import { z } from 'zod';
import { isoDateSchema, type Money, moneySchema, uuidSchema } from './common.js';

/**
 * Платная подписка на платформу.
 *
 * Стример платит платформе за тариф «Про», и платформа — обычный продавец своей
 * услуги: денег третьих лиц через неё не проходит. Донаты по-прежнему приходят
 * событиями из внешних сервисов (docs/adr/0002). Почему так и как устроены
 * списания — docs/adr/0011.
 */

/**
 * Реквизиты продавца на публичных страницах. Поле null — не заполнено в
 * окружении: страница показывает это явно, а не прячет строку.
 */
export const sellerInfoSchema = z.object({
  name: z.string().nullable(),
  inn: z.string().nullable(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
});
export type SellerInfo = z.infer<typeof sellerInfoSchema>;

export const BILLING_PERIODS = ['month', 'year'] as const;
export const billingPeriodSchema = z.enum(BILLING_PERIODS);
export type BillingPeriod = z.infer<typeof billingPeriodSchema>;

/**
 * Цены тарифа «Про».
 *
 * ЗАГЛУШКИ: цену утверждает владелец продукта. Сумма снимается в строку
 * платежа в момент его создания, и списание берёт её оттуда — смена цены здесь
 * не меняет уже созданные платежи задним числом.
 */
export const PLAN_PRICES: Record<BillingPeriod, Money> = {
  month: { amountMinor: 49_000, currency: 'RUB' },
  year: { amountMinor: 490_000, currency: 'RUB' },
};

/**
 * Льготные дни после конца периода при включённом автопродлении.
 *
 * Списание может не пройти по причинам, в которых стример не виноват: банк
 * отклонил операцию ночью, на карте кончились деньги за день до зарплаты. Эфир
 * с гостями в этот вечер не должен сорваться из-за того, что повтор списания
 * назначен на завтра.
 */
export const GRACE_DAYS = 3;

/** Сколько раз пытаемся списать продление, прежде чем выключить его. */
export const MAX_RENEWAL_ATTEMPTS = 3;

export const SUBSCRIPTION_STATUSES = ['none', 'active', 'grace', 'expired'] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

export const subscriptionViewSchema = z.object({
  /**
   * - `none` — ни разу не оплачивали;
   * - `active` — оплаченный период идёт;
   * - `grace` — период кончился, продление ещё пытается списаться;
   * - `expired` — доступа нет.
   */
  status: z.enum(SUBSCRIPTION_STATUSES),
  /** Период следующего продления. */
  period: billingPeriodSchema.nullable(),
  currentPeriodEnd: isoDateSchema.nullable(),
  autoRenew: z.boolean(),
  /**
   * Сколько спишется при продлении. Цена подписки, а не текущий прайс: у
   * оформивших раньше она сохраняется, пока их не предупредят о новой.
   */
  renewalAmount: moneySchema.nullable(),
  /** «Карта *4444». Сам способ оплаты наружу не отдаётся никогда. */
  paymentMethodTitle: z.string().nullable(),
  /**
   * Сколько дней текущего периода подарено сотрудником, а не оплачено.
   *
   * Считается отдельно от срока, потому что снять можно только подарок:
   * оплаченные дни — обязательство по оферте, и сотрудник их не забирает.
   */
  giftedDays: z.number().int().min(0),
  /** Открыты ли приватные комнаты — то, что покупается. */
  roomsAccess: z.boolean(),
  /** Настроен ли приём оплаты на этом сервере. Без него комнаты бесплатны. */
  billingConfigured: z.boolean(),
});
export type SubscriptionView = z.infer<typeof subscriptionViewSchema>;

export const PAYMENT_STATUSES = ['pending', 'succeeded', 'canceled'] as const;
export const PAYMENT_KINDS = ['initial', 'renewal'] as const;

export const paymentViewSchema = moneySchema.extend({
  id: uuidSchema,
  period: billingPeriodSchema,
  kind: z.enum(PAYMENT_KINDS),
  status: z.enum(PAYMENT_STATUSES),
  createdAt: isoDateSchema,
  paidAt: isoDateSchema.nullable(),
  /** Возвращено по платежу, в той же валюте. 0 — возвратов не было. */
  refundedAmountMinor: z.number().int().min(0),
});
export type PaymentView = z.infer<typeof paymentViewSchema>;

export const checkoutInputSchema = z.object({
  period: billingPeriodSchema,
  /**
   * Согласие с офертой и с автоматическими списаниями. Литерал `true`: запрос
   * без согласия отвергается схемой, до всякой логики.
   */
  acceptOffer: z.literal(true),
});
export type CheckoutInput = z.infer<typeof checkoutInputSchema>;

export const checkoutResultSchema = z.object({
  paymentId: uuidSchema,
  /** Страница оплаты ЮKassa. Данные карты вводятся там, а не у нас. */
  confirmationUrl: z.string().url(),
});
export type CheckoutResult = z.infer<typeof checkoutResultSchema>;

/**
 * Правка подписки.
 *
 * Включить автопродление обратно можно только с повторным согласием на
 * списания: выключение отзывало его, и молча списывать по старому нельзя.
 */
export const updateSubscriptionSchema = z
  .object({
    autoRenew: z.boolean().optional(),
    period: billingPeriodSchema.optional(),
    acceptOffer: z.literal(true).optional(),
  })
  .refine((input) => input.autoRenew !== true || input.acceptOffer === true, {
    message: 'Включение автопродления требует согласия на списания',
    path: ['acceptOffer'],
  });
export type UpdateSubscriptionInput = z.infer<typeof updateSubscriptionSchema>;
