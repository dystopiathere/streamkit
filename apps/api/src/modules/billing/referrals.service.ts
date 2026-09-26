import { randomInt } from 'node:crypto';
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  REFERRAL_CODE_ALPHABET,
  REFERRAL_CODE_LENGTH,
  type ReferralOverview,
} from '@streamkit/contracts';
import { AuditService, type AuditContext } from '../../common/audit/audit.service';
import { RealtimeBus } from '../../common/bus/realtime-bus.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { toContractPlan } from './billing-periods';
import { extendBonusPro, lockBonusPro } from './bonus-pro';

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
    private readonly bus: RealtimeBus,
  ) {}

  async overview(userId: string, now = new Date()): Promise<ReferralOverview> {
    const code = await this.ensureCode(userId);
    const [user, invited, rewards, activations] = await Promise.all([
      this.prisma.user.findUniqueOrThrow({
        where: { id: userId },
        select: { referralDaysBalance: true, bonusProUntil: true },
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
        user.bonusProUntil && user.bonusProUntil > now ? user.bonusProUntil.toISOString() : null,
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
   * Включить накопленные дни «Про». Идут подряд после уже идущего бесплатного
   * «Про», оплаченный период на это время стоит (`extendBonusPro`).
   */
  async activate(
    userId: string,
    days: number,
    context: AuditContext = {},
    now = new Date(),
  ): Promise<ReferralOverview> {
    const result = await this.prisma.$transaction(async (tx) => {
      const user = await lockBonusPro(tx, userId);
      if (!user) throw new NotFoundException('Пользователь не найден');
      if (user.referralDaysBalance < days) {
        throw new ConflictException('Столько дней ещё не накоплено');
      }
      const extended = await extendBonusPro(tx, userId, user, days, now);
      await tx.user.update({
        where: { id: userId },
        data: { referralDaysBalance: { decrement: days } },
      });
      await tx.referralActivation.create({
        data: { userId, days, startsAt: extended.startsAt, endsAt: extended.endsAt },
      });
      return extended;
    });

    await this.audit.record('billing.referral.activated', userId, {
      ...context,
      metadata: {
        days,
        endsAt: result.endsAt.toISOString(),
        pausedSubscription: result.pausedSubscription,
      },
    });
    // Открытые сцены снимают подпись бесплатного тарифа сразу, а не при
    // следующем подключении.
    await this.bus.publish({ kind: 'plan-changed', userId }).catch(() => undefined);
    return this.overview(userId, now);
  }

  /**
   * Промокод владельца: выдаётся при первом обращении.
   *
   * Условное обновление по `referralCode: null` не даёт двум вкладкам выдать
   * два кода, а занятый код — редкость при 31⁸ вариантах — просто
   * генерируется заново.
   */
  async ensureCode(userId: string): Promise<string> {
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
