import { z } from 'zod';
import { isoDateSchema, uuidSchema } from './common.js';
import { type PaidPlan, paidPlanSchema } from './billing.js';

/**
 * Программа приглашений.
 *
 * Стример раздаёт свой промокод, приглашённый вводит его при регистрации.
 * Первая успешная оплата приглашённого — любого тарифа, один раз — начисляет
 * пригласившему дни «Про». Дни копятся и включаются, когда и на сколько он
 * решит сам; на это время оплаченный период встаёт на паузу, а не сгорает.
 */

/**
 * Сколько дней «Про» пригласивший получает за первую оплату приглашённого.
 * Зависит от тарифа этой оплаты, а не от периода: год «Мультистрима» — те же
 * три дня, что и месяц.
 */
export const REFERRAL_REWARD_DAYS: Record<PaidPlan, number> = {
  multistream: 3,
  pro: 14,
};

/**
 * Алфавит промокода — без 0/O и 1/I/L: код диктуют голосом в эфире и
 * переписывают с экрана, и похожие знаки дали бы «промокод не найден» на ровном
 * месте.
 */
export const REFERRAL_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const REFERRAL_CODE_LENGTH = 8;

/**
 * Промокод из формы регистрации. Регистр и пробелы по краям не важны: код
 * вводят руками, и «abcd 2345 » должен найтись так же, как «ABCD2345».
 */
export const referralCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9]{4,16}$/, 'Промокод не найден');

/** Сколько дней можно включить за раз — год, как самый длинный период тарифа. */
export const MAX_REFERRAL_ACTIVATION_DAYS = 365;

export const activateReferralDaysSchema = z.object({
  days: z
    .number()
    .int('Целое число дней')
    .min(1, 'Минимум один день')
    .max(MAX_REFERRAL_ACTIVATION_DAYS, 'Не больше 365 дней за раз'),
});
export type ActivateReferralDaysInput = z.infer<typeof activateReferralDaysSchema>;

/**
 * Начисление за приглашённого. Без имени и почты приглашённого: пригласивший
 * узнаёт, что его приглашение оплатили, но не кто это был.
 */
export const referralRewardViewSchema = z.object({
  id: uuidSchema,
  plan: paidPlanSchema,
  days: z.number().int().positive(),
  createdAt: isoDateSchema,
  /** Отозвано возвратом оплаты, за которую начислено. */
  revoked: z.boolean(),
});
export type ReferralRewardView = z.infer<typeof referralRewardViewSchema>;

export const referralActivationViewSchema = z.object({
  id: uuidSchema,
  days: z.number().int().positive(),
  startsAt: isoDateSchema,
  endsAt: isoDateSchema,
});
export type ReferralActivationView = z.infer<typeof referralActivationViewSchema>;

export const referralOverviewSchema = z.object({
  code: z.string(),
  /** Сколько зарегистрировалось по промокоду. */
  invited: z.number().int().min(0),
  /** Сколько из них оплатило тариф и принесло дни. */
  paid: z.number().int().min(0),
  /** Накоплено и ещё не включено. */
  balanceDays: z.number().int().min(0),
  /** До какого момента действует включённый «Про». null — сейчас не действует. */
  proUntil: isoDateSchema.nullable(),
  rewards: z.array(referralRewardViewSchema),
  activations: z.array(referralActivationViewSchema),
});
export type ReferralOverview = z.infer<typeof referralOverviewSchema>;
