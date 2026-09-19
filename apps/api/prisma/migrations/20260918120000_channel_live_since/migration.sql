-- Начало идущего эфира по часам площадки: время стрима в окне эфира.
ALTER TABLE "Channel" ADD COLUMN "liveSince" TIMESTAMP(3);
