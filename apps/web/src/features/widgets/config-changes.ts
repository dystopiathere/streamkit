import { configSchemaFor, type WidgetType } from '@streamkit/contracts';

/**
 * Есть ли несохранённые изменения.
 *
 * Сравниваются не «трогали ли поле», а два конфига, приведённых схемой к одному
 * виду: тот, что лежит на сервере, и тот, что уйдёт туда сейчас. Слежение за
 * полями (`formState.isDirty`) считало изменением то, у чего поменялось
 * написание, а не смысл, и отметка залипала: поле валюты, которого в
 * сохранённом конфиге нет, появляется в значениях формы при первом же открытии
 * раздела, — а «Отменить» её не снимала, потому что поля регистрировались
 * заново сразу после сброса.
 *
 * Конфиг, который схема не принимает (недописанное число), — всегда изменение:
 * сохранить его нельзя, и говорить «всё сохранено» нечестно.
 */
export function isChanged(type: WidgetType, saved: unknown, current: unknown): boolean {
  const schema = configSchemaFor(type);
  const canonical = (value: unknown): string | undefined => {
    const parsed = schema.safeParse(value);
    // Ключи сортируются: порядок полей в объекте ничего не значит, а валюты
    // ложатся в него в том порядке, в котором их задавали.
    return parsed.success
      ? JSON.stringify(parsed.data, (_key, item: unknown) =>
          item && typeof item === 'object' && !Array.isArray(item)
            ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => (a < b ? -1 : 1)))
            : item,
        )
      : undefined;
  };
  const next = canonical(current);
  return next === undefined || next !== canonical(saved);
}
