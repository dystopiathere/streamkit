-- Порог суммы в сценарии оповещения — теперь свой у каждой валюты
-- (`minAmounts`), а не одно число на все (`minAmountMinor`).
--
-- Поведение сохраняется: старый порог сравнивался с суммой как есть, в любой
-- валюте, поэтому то же число переносится на каждую валюту. Нулевой порог
-- («показывать все») переносится пустым набором — это то же самое.
UPDATE "Widget" AS w
SET "configVersion" = 3,
    "config" = jsonb_set(
      w."config",
      '{scenarios}',
      (
        SELECT jsonb_object_agg(
          s.key,
          (s.value - 'minAmountMinor')
          || jsonb_build_object(
            'minAmounts',
            CASE
              WHEN COALESCE((s.value ->> 'minAmountMinor')::bigint, 0) > 0 THEN (
                SELECT jsonb_object_agg(c.code, s.value -> 'minAmountMinor')
                FROM unnest(ARRAY['RUB', 'USD', 'EUR', 'KZT', 'BYN', 'UAH']) AS c(code)
              )
              ELSE '{}'::jsonb
            END
          )
        )
        FROM jsonb_each(w."config" -> 'scenarios') AS s
      )
    )
WHERE w."type" = 'ALERTS'
  AND jsonb_typeof(w."config" -> 'scenarios') = 'object';
