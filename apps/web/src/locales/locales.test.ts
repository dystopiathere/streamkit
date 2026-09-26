import { describe, expect, it } from 'vitest';
import en from './en.json';
import ru from './ru.json';

/**
 * Английский словарь повторяет русский.
 *
 * Забытый ключ i18next не роняет: на английском он молча покажет русскую
 * строку, а забытая переменная — буквальное «{{amount}}» в кнопке оплаты.
 * Ни то ни другое не видно тому, кто правит интерфейс по-русски.
 *
 * Формы множественного числа у языков разные (`_few` и `_many` есть только у
 * русского), поэтому ключи сравниваются без суффикса формы.
 */
const PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/;

type Tree = { [key: string]: string | Tree };

function flatten(tree: Tree, prefix = ''): Map<string, string> {
  const result = new Map<string, string>();
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'string') result.set(path, value);
    else for (const [nested, text] of flatten(value, path)) result.set(nested, text);
  }
  return result;
}

function byBaseKey(entries: Map<string, string>): Map<string, string[]> {
  const result = new Map<string, string[]>();
  for (const [key, text] of entries) {
    const base = key.replace(PLURAL_SUFFIX, '');
    result.set(base, [...(result.get(base) ?? []), text]);
  }
  return result;
}

const variables = (texts: string[]): string[] =>
  [
    ...new Set(
      texts.flatMap((text) => [...text.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1] ?? '')),
    ),
  ].sort();

const ruKeys = byBaseKey(flatten(ru as Tree));
const enKeys = byBaseKey(flatten(en as Tree));

describe('словари интерфейса', () => {
  it('у английского те же ключи, что у русского', () => {
    expect([...enKeys.keys()].sort()).toEqual([...ruKeys.keys()].sort());
  });

  it('переменные в переводе те же, что в оригинале', () => {
    const mismatched = [...ruKeys]
      .filter(([key, texts]) => {
        const translated = enKeys.get(key);
        return translated && variables(translated).join() !== variables(texts).join();
      })
      .map(([key]) => key);
    expect(mismatched).toEqual([]);
  });

  it('у английских множественных форм есть one и other', () => {
    const plurals = [...flatten(en as Tree).keys()].filter((key) => PLURAL_SUFFIX.test(key));
    for (const key of plurals) {
      const base = key.replace(PLURAL_SUFFIX, '');
      expect(plurals).toContain(`${base}_one`);
      expect(plurals).toContain(`${base}_other`);
    }
  });

  it('в английском нет кириллицы, кроме названия русского языка', () => {
    const cyrillic = [...flatten(en as Tree)]
      .filter(([key, text]) => key !== 'language.switch' && /[А-Яа-яЁё]/.test(text))
      .map(([key]) => key);
    expect(cyrillic).toEqual([]);
  });

  it('каждый ключ, который код передаёт в t() строкой, есть в словаре', () => {
    // Ключа нет ни в одном словаре — i18next молча показывает сам ключ, и
    // сравнение словарей между собой этого не видит: у обоих его нет.
    const sources = import.meta.glob<string>(['../**/*.{ts,tsx}', '!../**/*.test.{ts,tsx}'], {
      query: '?raw',
      import: 'default',
      eager: true,
    });
    const missing = Object.entries(sources).flatMap(([file, code]) =>
      [...code.matchAll(/\bt\(\s*'([\w.]+)'/g)]
        .map((match) => match[1] ?? '')
        .filter(
          (key) =>
            !ruKeys.has(key) && ![...ruKeys.keys()].some((known) => known.startsWith(`${key}.`)),
        )
        .map((key) => `${file}: ${key}`),
    );
    expect(missing).toEqual([]);
  });
});
