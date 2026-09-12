-- AlterTable
ALTER TABLE "Channel" ADD COLUMN     "nextAttemptAt" TIMESTAMP(3),
ADD COLUMN     "syncAttempts" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "DonationSource" ADD COLUMN     "disabledReason" TEXT;
