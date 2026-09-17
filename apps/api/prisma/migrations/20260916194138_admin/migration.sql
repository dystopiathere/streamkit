-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('USER', 'SUPPORT', 'ADMIN');

-- CreateEnum
CREATE TYPE "SessionScope" AS ENUM ('USER', 'ADMIN');

-- AlterTable
ALTER TABLE "AuditLog" ADD COLUMN     "actorId" UUID;

-- AlterTable
ALTER TABLE "RefreshToken" ADD COLUMN     "scope" "SessionScope" NOT NULL DEFAULT 'USER';

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "role" "UserRole" NOT NULL DEFAULT 'USER';

-- CreateIndex
CREATE INDEX "AlertEvent_createdAt_idx" ON "AlertEvent"("createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_actorId_createdAt_idx" ON "AuditLog"("actorId", "createdAt");

-- CreateIndex
CREATE INDEX "RefreshToken_lastUsedAt_idx" ON "RefreshToken"("lastUsedAt");

-- CreateIndex
CREATE INDEX "User_role_idx" ON "User"("role");

-- CreateIndex
CREATE INDEX "User_createdAt_idx" ON "User"("createdAt");

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
