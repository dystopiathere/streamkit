import { Prisma } from '@prisma/client';
import { DAY_MS } from './billing-periods';

type Tx = Prisma.TransactionClient;

export interface BonusProLock {
  referralDaysBalance: number;
  bonusProUntil: Date | null;
  trialStartedAt: Date | null;
  emailVerifiedAt: Date | null;
}

/**
 * Взять строку пользователя под блокировку перед тем, как продлить бесплатный
 * «Про». Строка пользователя блокируется ПЕРВОЙ, строка подписки — второй
 * (`extendBonusPro`). Оплата (`markSucceeded`) берёт только строку подписки,
 * обратного порядка ни у кого нет, и взаимной блокировки не будет.
 */
export async function lockBonusPro(tx: Tx, userId: string): Promise<BonusProLock | null> {
  const [user] = await tx.$queryRaw<BonusProLock[]>`
    SELECT "referralDaysBalance", "bonusProUntil", "trialStartedAt", "emailVerifiedAt"
    FROM "User" WHERE "id" = ${userId}::uuid FOR UPDATE`;
  return user ?? null;
}

/**
 * Продлить бесплатный «Про» — пробный период или дни за приглашения — на
 * `days` дней. Вызывается после `lockBonusPro` в той же транзакции.
 *
 * Дни идут подряд после уже идущих. Оплаченный период на это время встаёт на
 * паузу: его конец и конец оплатившего его платежа сдвигаются на те же дни.
 * Иначе стример, оплативший «Мультистрим», тратил бы оплаченные дни впустую,
 * пока действует «Про», — а у оплатившего «Про» бесплатные дни просто
 * сгорали бы.
 */
export async function extendBonusPro(
  tx: Tx,
  userId: string,
  current: Pick<BonusProLock, 'bonusProUntil'>,
  days: number,
  now: Date,
): Promise<{ startsAt: Date; endsAt: Date; pausedSubscription: boolean }> {
  const startsAt =
    current.bonusProUntil && current.bonusProUntil > now ? current.bonusProUntil : now;
  const endsAt = new Date(startsAt.getTime() + days * DAY_MS);

  const [subscription] = await tx.$queryRaw<Array<{ id: string; currentPeriodEnd: Date | null }>>`
    SELECT "id", "currentPeriodEnd" FROM "Subscription"
    WHERE "userId" = ${userId}::uuid FOR UPDATE`;
  const pausedSubscription = Boolean(
    subscription?.currentPeriodEnd && subscription.currentPeriodEnd > now,
  );
  if (subscription && pausedSubscription) {
    const shift = Prisma.sql`make_interval(days => ${days})`;
    await tx.$executeRaw`
      UPDATE "Subscription"
      SET "currentPeriodEnd" = "currentPeriodEnd" + ${shift},
          "renewalNoticeFor" = NULL,
          "renewalNoticeSentAt" = NULL,
          "updatedAt" = ${now}
      WHERE "id" = ${subscription.id}::uuid`;
    // Письмо о конце оплаченного периода ищет платёж, который кончается
    // вместе с подпиской, а возврат — платёж текущего периода. Оба смотрят на
    // `periodEnd`, и он обязан сдвинуться вместе с подпиской.
    await tx.$executeRaw`
      UPDATE "Payment"
      SET "periodEnd" = "periodEnd" + ${shift},
          "periodStart" = CASE WHEN "periodStart" > ${now}
                               THEN "periodStart" + ${shift}
                               ELSE "periodStart" END
      WHERE "subscriptionId" = ${subscription.id}::uuid
        AND "status" = 'SUCCEEDED'
        AND "periodEnd" > ${now}`;
  }

  await tx.user.update({ where: { id: userId }, data: { bonusProUntil: endsAt } });
  return { startsAt, endsAt, pausedSubscription };
}
