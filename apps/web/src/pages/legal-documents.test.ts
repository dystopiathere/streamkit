import { describe, expect, it } from 'vitest';

/**
 * Английские документы — перевод той же редакции, что и русские.
 *
 * Перевод отстаёт от оригинала молча: правят русский текст (новая редакция,
 * новое обещание), а английский продолжает описывать прежние условия. Номер и
 * дату редакции перевод повторяет за оригиналом, так что обновить русский
 * документ без перевода этот тест не даст.
 */
const documents = import.meta.glob<string>('../../public/legal/**/*.md', {
  query: '?raw',
  import: 'default',
  eager: true,
});

const RU_EDITION = /^Редакция № (\d+) от (\d{2}\.\d{2}\.\d{4})$/m;
const EN_EDITION = /^Version No\. (\d+) of (\d{2}\.\d{2}\.\d{4})$/m;

const originals = Object.entries(documents).filter(([path]) => !path.includes('/legal/en/'));

describe('английские юридические документы', () => {
  it('есть для каждого русского', () => {
    expect(originals.length).toBeGreaterThan(0);
    for (const [path] of originals) {
      expect(documents[path.replace('/legal/', '/legal/en/')], path).toBeDefined();
    }
  });

  it.each(originals)('%s: та же редакция, ссылка на русский оригинал', (path, text) => {
    const translation = documents[path.replace('/legal/', '/legal/en/')] ?? '';
    const [, number, date] = RU_EDITION.exec(text) ?? [];
    expect(number, `${path}: нет строки редакции`).toBeDefined();
    expect(EN_EDITION.exec(translation)?.slice(1)).toEqual([number, date]);

    const slug = path.split('/').pop()?.replace('.md', '');
    expect(translation).toContain(`https://stream-kit.ru/legal/${slug}?lang=ru`);
  });

  it.each(originals)('%s: метки реквизитов те же', (path, text) => {
    const translation = documents[path.replace('/legal/', '/legal/en/')] ?? '';
    const tokens = (value: string) => [...new Set(value.match(/\{\{[A-Z_]+\}\}/g) ?? [])].sort();
    expect(tokens(translation)).toEqual(tokens(text));
  });
});
