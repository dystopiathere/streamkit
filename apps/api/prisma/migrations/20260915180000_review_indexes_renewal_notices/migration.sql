-- Уборка по сроку хранения удаляет по одной дате: составные индексы ей не помогают.
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- Отдельный индекс повторял уникальный на те же колонки и только удваивал запись снимка.
DROP INDEX "AnalyticsSnapshot_channelId_capturedAt_idx";
CREATE INDEX "AnalyticsSnapshot_capturedAt_idx" ON "AnalyticsSnapshot"("capturedAt");

-- Цена продления — снимок в подписке. Существующим подпискам проставляется цена
-- их периода по прайсу, действовавшему до этой миграции.
ALTER TABLE "Subscription"
  ADD COLUMN "renewalAmountMinor" INTEGER,
  ADD COLUMN "renewalCurrency" VARCHAR(3),
  ADD COLUMN "renewalNoticeFor" TIMESTAMP(3),
  ADD COLUMN "renewalNoticeSentAt" TIMESTAMP(3);

UPDATE "Subscription"
SET "renewalAmountMinor" = CASE WHEN "period" = 'YEAR' THEN 490000 ELSE 49000 END,
    "renewalCurrency" = 'RUB';

ALTER TABLE "Subscription"
  ALTER COLUMN "renewalAmountMinor" SET NOT NULL,
  ALTER COLUMN "renewalCurrency" SET NOT NULL;
