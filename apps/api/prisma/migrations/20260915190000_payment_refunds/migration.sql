-- Возвраты по платежу: сумма успешных возвратов ЮKassa и момент последнего.
ALTER TABLE "Payment"
  ADD COLUMN "refundedAmountMinor" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "refundedAt" TIMESTAMP(3);
