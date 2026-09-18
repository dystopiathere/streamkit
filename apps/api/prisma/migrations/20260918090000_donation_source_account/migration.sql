-- Имя аккаунта у провайдера донатов: стример видит, какой аккаунт подключён.
ALTER TABLE "DonationSource" ADD COLUMN "accountName" TEXT;
