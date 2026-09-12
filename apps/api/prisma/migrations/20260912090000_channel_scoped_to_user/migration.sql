-- Уникальность канала перестаёт быть глобальной и становится «один канал на
-- площадку у пользователя».
--
-- Глобальная уникальность (platform, externalId) означала, что удалённый
-- аккаунт навсегда запирает за собой канал, и что два человека, ведущие один
-- канал, не могут подключить его каждый к своему дашборду. Подключение канала
-- к аналитике — не заявление о владении им.

-- DropIndex
DROP INDEX "Channel_platform_externalId_key";

-- CreateIndex
CREATE INDEX "Channel_platform_externalId_idx" ON "Channel"("platform", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "Channel_userId_platform_key" ON "Channel"("userId", "platform");
