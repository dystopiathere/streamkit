import { randomInt } from 'node:crypto';
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  REFERRAL_CODE_ALPHABET,
  REFERRAL_CODE_LENGTH,
  type ReferralOverview,
} from '@streamkit/contracts';
import { AuditService, type AuditContext } from '../../common/audit/audit.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { DAY_MS, toContractPlan } from './billing-periods';

/** Сколько раз пробуем выдать промокод, если сгенерированный уже занят. */
const CODE_ATTEMPTS = 5;

/**
 * Программа приглашений: промокод, баланс дней «Про», их включение.
 *
 * Начисление и отзыв живут не здесь, а в транзакциях оплаты и возврата
 * (`referral-rewards.ts`): дни появляются ровно вместе с деньгами.
 */
@Injectable()
export class ReferralsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async overview(userId: string, now = new Date()): Promise<ReferralOverview> {
    const code = await this.ensureCode(userId);
    const [user, invited, rewards, activations] = await Promise.all([
      this.prisma.user.findUniqueOrThrow({
        where: { id: userId },
        select: { referralDaysBalance: true, referralProUntil: true },
      }),
      this.prisma.user.count({ where: { referredById: userId } }),
      this.prisma.referralReward.findMany({
        where: { referrerId: userId },
        orderBy: { createdAt: 'desc' },
        take: 100,
      }),
      this.prisma.referralActivation.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
    ]);

    return {
      code,
      invited,
      paid: rewards.filter((reward) => !reward.revokedAt).length,
      balanceDays: user.referralDaysBalance,
      proUntil:
        user.referralProUntil && user.referralProUntil > now
          ? user.referralProUntil.toISOString()
          : null,
      rewards: rewards.map((reward) => ({
        id: reward.id,
        plan: toContractPlan(reward.plan),
        days: reward.days,
        createdAt: reward.createdAt.toISOString(),
        revoked: reward.revokedAt !== null,
      })),
      activations: activations.map((activation) => ({
        id: activation.id,
        days: activation.days,
        startsAt: activation.startsAt.toISOString(),
        endsAt: activation.endsAt.toISOString(),
      })),
    };
  }

  /**
   * Включить накопленные дни «Про».
   *
   * Дни идут подряд после уже включённых. Оплаченный период на это время
   * встаёт на паузу: его конец и конец оплатившего его платежа сдвигаются на
   * те же дни. Иначе стример, оплативший «Мультистрим», тратил бы оплаченные
   * дни впустую, пока действует «Про», — а «Про» у стримера с оплаченным
   * «Про» просто сгорал бы.
   *
   * Строка пользователя блокируется первой, строка подписки — второй. Порядок
   * важен: оплата (`markSucceeded`) берёт только строку подписки, и обратного
   * порядка ни у кого нет, поэтому взаимной блокировки не будет.
   */
  async activate(
    userId: string,
    days: number,
    context: AuditContext = {},
    now = new Date(),
  ): Promise<ReferralOverview> {
    const result = await this.prisma.$transaction(async (tx) => {
      const [user] = await tx.$queryRaw<
        Array<{ referralDaysBalance: number; referralProUntil: Date | null }>
      >`
        SELECT "referralDaysBalance", "referralProUntil" FROM "User"
        WHERE "id" = ${userId}::uuid FOR UPDATE`;
      if (!user) throw new NotFoundException('Пользователь не найден');
      if (user.referralDaysBalance < days) {
        throw new ConflictException('Столько дней ещё не накоплено');
      }

      const startsAt =
        user.referralProUntil && user.referralProUntil > now ? user.referralProUntil : now;
      const endsAt = new Date(startsAt.getTime() + days * DAY_MS);

      const [subscription] = await tx.$queryRaw<
        Array<{ id: string; currentPeriodEnd: Date | null }>
      >`
        SELECT "id", "currentPeriodEnd" FROM "Subscription"
        WHERE "userId" = ${userId}::uuid FOR UPDATE`;
      if (subscription?.currentPeriodEnd && subscription.currentPeriodEnd > now) {
        const shift = Prisma.sql`make_interval(days => ${days})`;
        await tx.$executeRaw`
          UPDATE "Subscription"
          SET "currentPeriodEnd" = "currentPeriodEnd" + ${shift},
              "renewalNoticeFor" = NULL,
              "renewalNoticeSentAt" = NULL,
              "updatedAt" = ${now}
          WHERE "id" = ${subscription.id}::uuid`;
        // Письмо о конце оплаченного периода ищет платёж, который кончается
        // вместе с подпиской, а возврат — платёж текущего периода. Оба смотрят
        // на `periodEnd`, и он обязан сдвинуться вместе с подпиской.
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

      await tx.user.update({
        where: { id: userId },
        data: {
          referralDaysBalance: { decrement: days },
          referralProUntil: endsAt,
        },
      });
      await tx.referralActivation.create({ data: { userId, days, startsAt, endsAt } });
      return {
        endsAt,
        paused: Boolean(subscription?.currentPeriodEnd && subscription.currentPeriodEnd > now),
      };
    });

    await this.audit.record('billing.referral.activated', userId, {
      ...context,
      metadata: { days, endsAt: result.endsAt.toISOString(), pausedSubscription: result.paused },
    });
    return this.overview(userId, now);
  }

  /**
   * Промокод владельца: выдаётся при первом обращении.
   *
   * Условное обновление по `referralCode: null` не даёт двум вкладкам выдать
   * два кода, а занятый код — редкость при 31⁸ вариантах — просто
   * генерируется заново.
   */
  private async ensureCode(userId: string): Promise<string> {
    for (let attempt = 0; attempt < CODE_ATTEMPTS; attempt += 1) {
      const current = await this.prisma.user.findUniqueOrThrow({
        where: { id: userId },
        select: { referralCode: true },
      });
      if (current.referralCode) return current.referralCode;
      try {
        await this.prisma.user.updateMany({
          where: { id: userId, referralCode: null },
          data: { referralCode: generateReferralCode() },
        });
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          continue;
        }
        throw error;
      }
    }
    throw new ConflictException('Не удалось выдать промокод — попробуйте ещё раз');
  }
}

export function generateReferralCode(): string {
  let code = '';
  for (let index = 0; index < REFERRAL_CODE_LENGTH; index += 1) {
    code += REFERRAL_CODE_ALPHABET[randomInt(REFERRAL_CODE_ALPHABET.length)];
  }
  return code;
}
