-- Согласия анонимных посетителей на статистику посещений.
CREATE TABLE "VisitorConsent" (
    "id" UUID NOT NULL,
    "visitorId" UUID NOT NULL,
    "documentVersion" TEXT NOT NULL,
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "ipHash" TEXT,
    "userAgent" VARCHAR(512),

    CONSTRAINT "VisitorConsent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "VisitorConsent_visitorId_idx" ON "VisitorConsent"("visitorId");
CREATE INDEX "VisitorConsent_grantedAt_idx" ON "VisitorConsent"("grantedAt");
