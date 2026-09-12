-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "WidgetType" ADD VALUE 'GOAL';
ALTER TYPE "WidgetType" ADD VALUE 'TIMER';
ALTER TYPE "WidgetType" ADD VALUE 'TOP_DONORS';

-- CreateTable
CREATE TABLE "WidgetState" (
    "widgetId" UUID NOT NULL,
    "state" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WidgetState_pkey" PRIMARY KEY ("widgetId")
);

-- AddForeignKey
ALTER TABLE "WidgetState" ADD CONSTRAINT "WidgetState_widgetId_fkey" FOREIGN KEY ("widgetId") REFERENCES "Widget"("id") ON DELETE CASCADE ON UPDATE CASCADE;
