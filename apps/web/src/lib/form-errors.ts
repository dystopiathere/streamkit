import { translateMessage } from '@streamkit/contracts';
import type { FieldErrors, FieldValues, Resolver } from 'react-hook-form';
import { currentLanguage } from './locale';

/**
 * Резолвер формы, чьи сообщения об ошибках — на языке интерфейса.
 *
 * Тексты проверок живут в схемах contracts по-русски: те же схемы проверяют
 * запросы на сервере. Переводятся они здесь, на выходе резолвера, — иначе
 * пришлось бы переводить у каждого поля каждой формы.
 */
export function localizedResolver<TValues extends FieldValues, TContext, TOutput>(
  resolver: Resolver<TValues, TContext, TOutput>,
): Resolver<TValues, TContext, TOutput> {
  return async (values, context, options) => {
    const result = await resolver(values, context, options);
    return { ...result, errors: localizeErrors(result.errors) } as typeof result;
  };
}

function localizeErrors(errors: FieldErrors): FieldErrors {
  const language = currentLanguage();
  if (language === 'ru') return errors;

  const walk = (node: unknown): unknown => {
    if (typeof node !== 'object' || node === null) return node;
    const copy: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(node)) {
      // `ref` — DOM-элемент поля, его не обходим и не копируем по частям.
      if (key === 'ref') copy[key] = value;
      else if (key === 'message' && typeof value === 'string') {
        copy[key] = translateMessage(value, language);
      } else copy[key] = walk(value);
    }
    return copy;
  };
  return walk(errors) as FieldErrors;
}
