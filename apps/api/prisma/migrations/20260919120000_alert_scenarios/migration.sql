-- Подарочные подписки — свой тип события: автор у них даритель, а не подписчик.
ALTER TYPE "AlertEventType" ADD VALUE 'GIFT' AFTER 'SUBSCRIPTION';

-- Количество в событии: биты, зрители рейда, месяцы подписки, число подарков.
-- Отдельно от суммы: биты — не валюта.
ALTER TABLE "AlertEvent" ADD COLUMN "count" INTEGER;

-- Канал чата больше не хранится в виджете: он берётся из подключённого Twitch.
UPDATE "Widget" SET "config" = "config" - 'channel' WHERE "type" = 'CHAT';

-- Оповещения: общие настройки виджета становятся сценарием каждого типа
-- события. Поведение сохраняется: включены те типы, что были в eventTypes
-- (подарки — вместе с подписками), порог суммы остаётся у доната. Шаблон по
-- умолчанию «{username} — {amount}» у типов без суммы заменяется их
-- собственным: иначе фолловер пришёл бы с висящим тире.
UPDATE "Widget" AS w
SET "configVersion" = 2,
    "config" = jsonb_build_object(
      'gapMs', COALESCE(w."config" -> 'gapMs', '500'::jsonb),
      'scenarios', (
        SELECT jsonb_object_agg(
          t.type,
          (w."config" - 'gapMs' - 'eventTypes' - 'minAmountMinor'
            - CASE
                WHEN t.type <> 'donation'
                  AND COALESCE(w."config" ->> 'titleTemplate', '{username} — {amount}') = '{username} — {amount}'
                THEN ARRAY['titleTemplate', 'messageTemplate']
                ELSE ARRAY[]::text[]
              END)
          || jsonb_build_object(
            'enabled',
            COALESCE(w."config" -> 'eventTypes', '["donation"]'::jsonb)
              ? (CASE WHEN t.type = 'gift' THEN 'subscription' ELSE t.type END),
            'minAmountMinor',
            CASE WHEN t.type = 'donation'
              THEN COALESCE(w."config" -> 'minAmountMinor', '0'::jsonb)
              ELSE '0'::jsonb
            END
          )
        )
        FROM unnest(ARRAY[
          'donation', 'follow', 'subscription', 'gift',
          'resubscription', 'cheer', 'raid', 'reward'
        ]) AS t(type)
      )
    )
WHERE w."type" = 'ALERTS' AND NOT (w."config" ? 'scenarios');
