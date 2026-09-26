import type { Payment, Plan as PrismaPlan, Prisma } from '@prisma/client';
import { REFERRAL_REWARD_DAYS } from '@streamkit/contracts';
import { toContractPlan } from './billing-periods';

type Tx = Prisma.TransactionClient;

export interface CreditedReward {
  referrerId: string;
  days: number;
  plan: PrismaPlan;
}

/**
 * Начислить пригласившему дни за оплату — если это ПЕРВАЯ успешная оплата
 * приглашённого.
 *
 * Вызывается в транзакции `markSucceeded`, после перевода платежа в
 * SUCCEEDED: начисление и оплата либо случаются вместе, либо не случаются
 * вовсе. Строка вставляется через `skipDuplicates` (ON CONFLICT DO NOTHING), а
 * не ловлей уникальности: ошибка внутри транзакции PostgreSQL обрывает её
 * целиком, и вместе с начислением потерялась бы сама оплата.
 */
export async function creditReferralReward(
  tx: Tx,
  payment: Payment,
): Promise<CreditedReward | null> {
  const payer = await tx.user.findUnique({
    where: { id: payment.userId },
    select: { referredById: true },
  });
  const referrerId = payer?.referredById;
  if (!referrerId) return null;

  // Первая — значит, других успешных не было. Возвращённая раньше оплата тоже
  // считается: иначе «оплатил, вернул, оплатил» начисляло бы второй раз.
  const earlier = await tx.payment.count({
    where: { userId: payment.userId, status: 'SUCCEEDED', id: { not: payment.id } },
  });
  if (earlier > 0) return null;

  const days = REFERRAL_REWARD_DAYS[toContractPlan(payment.plan)];
  const created = await tx.referralReward.createMany({
    data: [
      {
        referrerId,
        referredId: payment.userId,
        paymentId: payment.id,
        plan: payment.plan,
        days,
      },
    ],
    skipDuplicates: true,
  });
  if (created.count === 0) return null;

  await tx.user.update({
    where: { id: referrerId },
    data: { referralDaysBalance: { increment: days } },
  });
  return { referrerId, days, plan: payment.plan };
}

/**
 * Отозвать начисление за платёж, по которому сделан возврат.
 *
 * Иначе программа накручивалась бы в два шага: оплатить второй аккаунт,
 * получить четырнадцать дней, вернуть деньги. С баланса снимается, сколько
 * там есть: уже включённые дни прошли или идут, и отнимать идущий «Про» мы не
 * станем — это не деньги, а бонус, и цена такого случая ниже цены второй даты
 * в подписке.
 */
export async function revokeReferralReward(
  tx: Tx,
  paymentId: string,
  now: Date,
): Promise<{ referrerId: string; days: number } | null> {
  const reward = await tx.referralReward.findUnique({ where: { paymentId } });
  if (!reward || reward.revokedAt) return null;

  const claimed = await tx.referralReward.updateMany({
    where: { id: reward.id, revokedAt: null },
    data: { revokedAt: now },
  });
  if (claimed.count === 0) return null;

  await tx.$executeRaw`
    UPDATE "User"
    SET "referralDaysBalance" = GREATEST("referralDaysBalance" - ${reward.days}, 0)
    WHERE "id" = ${reward.referrerId}::uuid`;
  return { referrerId: reward.referrerId, days: reward.days };
}
