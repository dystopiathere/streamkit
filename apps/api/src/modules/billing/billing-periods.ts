import type { BillingPeriod as PrismaBillingPeriod, Plan as PrismaPlan } from '@prisma/client';
import {
  type BillingPeriod,
  GRACE_DAYS,
  type PaidPlan,
  type Plan,
  type SubscriptionStatus,
} from '@streamkit/contracts';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Конец периода, начавшегося в `start`.
 *
 * Календарный месяц, а не тридцать дней: оплативший 15-го ждёт продления 15-го,
 * а не «где-то в середине месяца». Дни, которых в следующем месяце нет,
 * прижимаются к его последнему дню — 31 января + месяц = 28 (29) февраля, а не
 * 3 марта, как сделал бы наивный `setUTCMonth`. По UTC: сервер и стример могут
 * жить в разных часовых поясах, а конец периода должен быть один.
 */
export function addBillingPeriod(start: Date, period: BillingPeriod): Date {
  const months = period === 'year' ? 12 : 1;
  const year = start.getUTCFullYear();
  const month = start.getUTCMonth() + months;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const result = new Date(start.getTime());
  result.setUTCDate(1);
  result.setUTCFullYear(year, month, Math.min(start.getUTCDate(), lastDay));
  return result;
}

/**
 * Состояние подписки на момент `now`.
 *
 * Вычисляется, а не хранится: хранимый статус переключала бы задача по
 * расписанию, и между концом периода и её тактом доступ был бы неверным.
 * Льготные дни — только при включённом автопродлении: это время на повтор
 * списания, а у отказавшегося от продления повторять нечего.
 */
export function subscriptionStatus(
  subscription: { currentPeriodEnd: Date | null; autoRenew: boolean } | null,
  now: Date,
): SubscriptionStatus {
  const end = subscription?.currentPeriodEnd;
  if (!subscription || !end) return 'none';
  if (now < end) return 'active';
  if (subscription.autoRenew && now.getTime() < end.getTime() + GRACE_DAYS * DAY_MS) {
    return 'grace';
  }
  return 'expired';
}

/**
 * Оплаченный тариф, который действует сейчас.
 *
 * Считается из той же пары, что и статус: тариф записан в подписке, но даёт он
 * что-то только пока период не кончился. Истёкшая подписка — это `free`, а не
 * «Про, которым нельзя пользоваться»: иначе каждый гейт пришлось бы сверять с
 * двумя полями сразу и однажды забыть.
 */
export function paidPlan(
  subscription: { plan: PrismaPlan; currentPeriodEnd: Date | null; autoRenew: boolean } | null,
  now: Date,
): Plan {
  if (!subscription) return 'free';
  const status = subscriptionStatus(subscription, now);
  return status === 'active' || status === 'grace' ? toContractPlan(subscription.plan) : 'free';
}

/**
 * Тариф, по которому открыт доступ: оплаченный, а поверх него — «Про» из дней
 * за приглашения (`User.bonusProUntil`).
 *
 * Срок приглашений — обязательный аргумент, а не необязательный: гейт, который
 * забыл его передать, молча закрывал бы «Про», за который стример отдал
 * накопленные дни. Где решается вопрос о самой подписке — есть ли что
 * продлевать, можно ли оформить новую, — нужен `paidPlan`.
 */
export function effectivePlan(
  subscription: { plan: PrismaPlan; currentPeriodEnd: Date | null; autoRenew: boolean } | null,
  now: Date,
  bonusProUntil: Date | null,
): Plan {
  if (bonusProUntil && bonusProUntil > now) return 'pro';
  return paidPlan(subscription, now);
}

export function toContractPlan(plan: PrismaPlan): PaidPlan {
  return plan === 'MULTISTREAM' ? 'multistream' : 'pro';
}

export function toPrismaPlan(plan: PaidPlan): PrismaPlan {
  return plan === 'multistream' ? 'MULTISTREAM' : 'PRO';
}

export function toContractPeriod(period: PrismaBillingPeriod): BillingPeriod {
  return period === 'YEAR' ? 'year' : 'month';
}

export function toPrismaPeriod(period: BillingPeriod): PrismaBillingPeriod {
  return period === 'year' ? 'YEAR' : 'MONTH';
}

export { DAY_MS };
