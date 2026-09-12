-- CreateEnum
CREATE TYPE "ChannelSyncState" AS ENUM ('OK', 'AUTH_EXPIRED', 'RATE_LIMITED', 'ERROR');

-- AlterTable
ALTER TABLE "Channel" ADD COLUMN     "isEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "lastSyncedAt" TIMESTAMP(3),
ADD COLUMN     "syncError" TEXT,
ADD COLUMN     "syncState" "ChannelSyncState" NOT NULL DEFAULT 'OK';

-- CreateTable
CREATE TABLE "AnalyticsSnapshot" (
    "id" UUID NOT NULL,
    "channelId" UUID NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL,
    "isLive" BOOLEAN NOT NULL,
    "viewers" INTEGER,
    "followers" INTEGER,
    "subscribers" INTEGER,
    "totalViews" BIGINT,
    "title" VARCHAR(200),
    "category" VARCHAR(120),

    CONSTRAINT "AnalyticsSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AnalyticsSnapshot_channelId_capturedAt_idx" ON "AnalyticsSnapshot"("channelId", "capturedAt");

-- CreateIndex
CREATE UNIQUE INDEX "AnalyticsSnapshot_channelId_capturedAt_key" ON "AnalyticsSnapshot"("channelId", "capturedAt");

-- AddForeignKey
ALTER TABLE "AnalyticsSnapshot" ADD CONSTRAINT "AnalyticsSnapshot_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
