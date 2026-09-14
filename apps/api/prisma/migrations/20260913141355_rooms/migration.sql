-- AlterEnum
ALTER TYPE "WidgetType" ADD VALUE 'GUESTS';

-- CreateTable
CREATE TABLE "Room" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Room_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoomInvite" (
    "id" UUID NOT NULL,
    "roomId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "label" VARCHAR(80) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "RoomInvite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GuestConsent" (
    "id" UUID NOT NULL,
    "inviteId" UUID NOT NULL,
    "documentVersion" TEXT NOT NULL,
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ipHash" TEXT,
    "userAgent" VARCHAR(512),

    CONSTRAINT "GuestConsent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Room_userId_idx" ON "Room"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "RoomInvite_tokenHash_key" ON "RoomInvite"("tokenHash");

-- CreateIndex
CREATE INDEX "RoomInvite_roomId_idx" ON "RoomInvite"("roomId");

-- CreateIndex
CREATE INDEX "GuestConsent_inviteId_idx" ON "GuestConsent"("inviteId");

-- CreateIndex
CREATE INDEX "GuestConsent_grantedAt_idx" ON "GuestConsent"("grantedAt");

-- AddForeignKey
ALTER TABLE "Room" ADD CONSTRAINT "Room_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoomInvite" ADD CONSTRAINT "RoomInvite_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GuestConsent" ADD CONSTRAINT "GuestConsent_inviteId_fkey" FOREIGN KEY ("inviteId") REFERENCES "RoomInvite"("id") ON DELETE CASCADE ON UPDATE CASCADE;
