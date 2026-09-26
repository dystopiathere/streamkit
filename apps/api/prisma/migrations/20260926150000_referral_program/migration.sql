-- AlterTable
ALTER TABLE "User" ADD COLUMN     "referralCode" VARCHAR(16),
ADD COLUMN     "referralDaysBalance" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "referralProUntil" TIMESTAMP(3),
ADD COLUMN     "referredById" UUID;

-- CreateTable
CREATE TABLE "ReferralReward" (
    "id" UUID NOT NULL,
    "referrerId" UUID NOT NULL,
    "referredId" UUID NOT NULL,
    "paymentId" UUID NOT NULL,
    "plan" "Plan" NOT NULL,
    "days" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "ReferralReward_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReferralActivation" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "days" INTEGER NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReferralActivation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ReferralReward_referredId_key" ON "ReferralReward"("referredId");

-- CreateIndex
CREATE UNIQUE INDEX "ReferralReward_paymentId_key" ON "ReferralReward"("paymentId");

-- CreateIndex
CREATE INDEX "ReferralReward_referrerId_createdAt_idx" ON "ReferralReward"("referrerId", "createdAt");

-- CreateIndex
CREATE INDEX "ReferralActivation_userId_createdAt_idx" ON "ReferralActivation"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "User_referralCode_key" ON "User"("referralCode");

-- CreateIndex
CREATE INDEX "User_referredById_idx" ON "User"("referredById");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_referredById_fkey" FOREIGN KEY ("referredById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReferralReward" ADD CONSTRAINT "ReferralReward_referrerId_fkey" FOREIGN KEY ("referrerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReferralReward" ADD CONSTRAINT "ReferralReward_referredId_fkey" FOREIGN KEY ("referredId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReferralReward" ADD CONSTRAINT "ReferralReward_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReferralActivation" ADD CONSTRAINT "ReferralActivation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

