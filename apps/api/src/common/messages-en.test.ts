import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { MESSAGES_EN } from '@streamkit/contracts';
import { describe, expect, it } from 'vitest';

/**
 * Словарь английских сообщений (`MESSAGES_EN` в contracts) полон и не устарел.
 *
 * Дашборд показывает ошибки API и тексты проверок из схем как есть, а на
 * английском подменяет их по словарю. Новое исключение без перевода не
 * сломалось бы — английский интерфейс просто показал бы русскую фразу, и
 * заметил бы это только англоязычный пользователь. Поэтому сообщения
 * собираются из исходников:
 *
 * - исключения API (`new XxxException(...)`, `super(...)` у своих исключений)
 *   и константы, которые в них передаются;
 * - исключения клиента API в `app-kit` (`new ApiError(...)`);
 * - строки схем в contracts, кроме значений `.default(...)`: это данные
 *   виджета, а не сообщение.
 *
 * Админка, её схемы и скрипты для консоли ВМ — только на русском и не входят.
 */
const REPO = resolve(import.meta.dirname, '..', '..', '..', '..');
const CYRILLIC = /[А-Яа-яЁё]/;
const LITERAL = /'((?:[^'\\\n]|\\.)*)'/g;

function sourceFiles(dir: string, files: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) sourceFiles(path, files);
    else if (/\.tsx?$/.test(entry.name) && !entry.name.includes('.test.')) files.push(path);
  }
  return files;
}

/** Содержимое скобок от открывающей в `open` до парной, строки в кавычках пропускаются. */
function parenthesized(source: string, open: number): string {
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    const char = source[i];
    if (char === "'") {
      for (i++; i < source.length && source[i] !== "'"; i++) {
        if (source[i] === '\\') i++;
      }
      continue;
    }
    if (char === '(') depth++;
    if (char === ')' && --depth === 0) return source.slice(open + 1, i);
  }
  return '';
}

function russianLiterals(text: string): string[] {
  return [...text.matchAll(LITERAL)]
    .map((match) => match[1] ?? '')
    .filter((value) => CYRILLIC.test(value));
}

function thrownMessages(root: string): Set<string> {
  const messages = new Set<string>();
  for (const file of sourceFiles(root)) {
    const parts = file.split(sep);
    if (parts.includes('admin') || parts.includes('scripts') || file.endsWith('admin.guard.ts')) {
      continue;
    }
    const source = readFileSync(file, 'utf8');
    const constants = new Map(
      [...source.matchAll(/const ([A-Z][A-Z0-9_]+)\s*=\s*'((?:[^'\\]|\\.)*)'/g)].map((match) => [
        match[1] ?? '',
        match[2] ?? '',
      ]),
    );
    const ownException = /extends \w*Exception/.test(source);
    for (const match of source.matchAll(/new \w*(?:Exception|ApiError)\(|super\(/g)) {
      if (match[0] === 'super(' && !ownException) continue;
      const args = parenthesized(source, (match.index ?? 0) + match[0].length - 1);
      for (const value of russianLiterals(args)) messages.add(value);
      for (const name of args.match(/\b[A-Z][A-Z0-9_]{2,}\b/g) ?? []) {
        const value = constants.get(name);
        if (value && CYRILLIC.test(value)) messages.add(value);
      }
    }
  }
  return messages;
}

function schemaMessages(root: string): Set<string> {
  const messages = new Set<string>();
  for (const file of sourceFiles(root)) {
    if (file.endsWith('admin.ts')) continue;
    const code = readFileSync(file, 'utf8')
      .split('\n')
      .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
      .join('\n');
    for (const match of code.matchAll(/(\.default\(\s*)?'((?:[^'\\\n]|\\.)*)'/g)) {
      const value = match[2] ?? '';
      if (!match[1] && CYRILLIC.test(value)) messages.add(value);
    }
  }
  return messages;
}

const found = new Set([
  ...thrownMessages(join(REPO, 'apps', 'api', 'src')),
  ...thrownMessages(join(REPO, 'packages', 'app-kit', 'src')),
  ...schemaMessages(join(REPO, 'packages', 'contracts', 'src')),
]);

describe('MESSAGES_EN', () => {
  it('сборщик сообщений что-то находит', () => {
    // Сломанный разбор нашёл бы ноль сообщений, и проверки ниже прошли бы впустую.
    expect(found.size).toBeGreaterThan(40);
    expect(found).toContain('Неверный email или пароль');
    expect(found).toContain('Минимум 12 символов');
  });

  it('у каждого сообщения интерфейса есть перевод', () => {
    const missing = [...found].filter((message) => !Object.hasOwn(MESSAGES_EN, message));
    expect(missing).toEqual([]);
  });

  it('в словаре нет сообщений, которых больше нет в коде', () => {
    const stale = Object.keys(MESSAGES_EN).filter((message) => !found.has(message));
    expect(stale).toEqual([]);
  });
});
