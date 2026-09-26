-- AlterTable
ALTER TABLE "User" ADD COLUMN "language" VARCHAR(2) NOT NULL DEFAULT 'ru';

-- AlterTable
ALTER TABLE "Subscription" ADD COLUMN "expiryNoticeFor" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "KnownDevice" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "deviceHash" TEXT NOT NULL,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KnownDevice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LegalUpdateNotice" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "document" "ConsentDocument" NOT NULL,
    "version" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LegalUpdateNotice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "KnownDevice_lastSeenAt_idx" ON "KnownDevice"("lastSeenAt");

-- CreateIndex
CREATE UNIQUE INDEX "KnownDevice_userId_deviceHash_key" ON "KnownDevice"("userId", "deviceHash");

-- CreateIndex
CREATE UNIQUE INDEX "LegalUpdateNotice_userId_document_version_key" ON "LegalUpdateNotice"("userId", "document", "version");

-- AddForeignKey
ALTER TABLE "KnownDevice" ADD CONSTRAINT "KnownDevice_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LegalUpdateNotice" ADD CONSTRAINT "LegalUpdateNotice_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
