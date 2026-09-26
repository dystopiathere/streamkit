-- «Про» поверх подписки теперь не только за приглашения, но и пробный период:
-- одна цепочка, одно поле.
ALTER TABLE "User" RENAME COLUMN "referralProUntil" TO "bonusProUntil";

-- AlterTable
ALTER TABLE "User" ADD COLUMN "trialStartedAt" TIMESTAMP(3),
ADD COLUMN "trialEndsAt" TIMESTAMP(3),
ADD COLUMN "bonusEndNoticeFor" TIMESTAMP(3);

-- AlterEnum
ALTER TYPE "MailKind" ADD VALUE 'FREE_PRO_ENDING';
