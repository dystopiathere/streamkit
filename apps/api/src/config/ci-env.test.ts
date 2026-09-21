import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { validateEnv } from './env';

/**
 * Окружение CI проверяется тем же валидатором, что и боевое.
 *
 * Появился этот тест после конкретной осечки: в workflow лежал
 * `ENCRYPTION_KEY`, декодировавшийся в 31 байт вместо 32 — причём сама строка
 * внутри гласила «32-bytes». Значение было написано на глаз и не исполнялось
 * месяц, потому что у репозитория не было удалённого и CI не запускался ни
 * разу. Обнаружилось это на первом же прогоне, ценой полного круга «пуш →
 * ожидание → красный прогон».
 *
 * Значения в workflow править руками придётся и дальше — GitHub Actions не
 * умеет подключать файл окружения. Но теперь ошибка в них падает локально, в
 * `pnpm test`, а не через несколько минут после пуша.
 */
const WORKFLOW = resolve(
  import.meta.dirname,
  '..',
  '..',
  '..',
  '..',
  '.github',
  'workflows',
  'ci.yml',
);

/**
 * Окружения приложения, с которыми его запускает workflow.
 *
 * Полноценный разбор YAML тут не нужен и потребовал бы зависимости: блоки
 * плоские, значения простые. Отбираются только блоки приложения — по наличию
 * `DATABASE_URL`, иначе сюда попал бы и служебный блок с `NODE_VERSION`.
 *
 * Шаг видит окружение задания плюс своё, и проверяется именно эта сумма.
 * Секреты стоят на уровне задания, а база — на уровне шага: интеграционные
 * тесты и сквозной сценарий идут одним заданием, но каждый в свою базу. Пока
 * разбор брал блоки по отдельности, блок шага с одной `DATABASE_URL` проверялся
 * без ключей и валился, хотя приложение получало их от задания.
 */
export function extractEnvBlocks(yaml: string): Array<Record<string, string>> {
  const lines = yaml.split(/\r?\n/);
  const blocks: Array<Record<string, string>> = [];
  // Окружение текущего задания: задания — ключи с отступом 2 под `jobs:`, их
  // собственный `env:` — с отступом 4. Всё глубже — окружение шагов и служб.
  let jobEnv: Record<string, string> = {};

  for (let i = 0; i < lines.length; i += 1) {
    if (/^ {2}[A-Za-z0-9_-]+:\s*$/.test(lines[i] ?? '')) {
      jobEnv = {};
      continue;
    }

    const header = /^(\s+)env:\s*$/.exec(lines[i] ?? '');
    if (!header) continue;

    const indent = (header[1] ?? '').length;
    const block: Record<string, string> = {};

    for (let j = i + 1; j < lines.length; j += 1) {
      const line = lines[j] ?? '';
      if (line.trim() === '' || line.trimStart().startsWith('#')) continue;

      const currentIndent = line.length - line.trimStart().length;
      if (currentIndent <= indent) break;

      const pair = /^\s+([A-Z_][A-Z0-9_]*):\s*(.*)$/.exec(line);
      if (!pair) break;

      block[pair[1] as string] = (pair[2] ?? '').trim().replace(/^['"]|['"]$/g, '');
    }

    if (indent === 4) {
      jobEnv = block;
      if ('DATABASE_URL' in block) blocks.push(block);
    } else if ('DATABASE_URL' in block) {
      blocks.push({ ...jobEnv, ...block });
    }
  }

  return blocks;
}

describe('окружение CI', () => {
  const blocks = extractEnvBlocks(readFileSync(WORKFLOW, 'utf8'));

  it('находит блоки окружения в workflow', () => {
    // Утверждение обязательное: если разбор сломается, тест ниже начнёт
    // проходить вхолостую, ничего не проверяя.
    expect(blocks.length).toBeGreaterThanOrEqual(2);
    expect(blocks.every((block) => 'ENCRYPTION_KEY' in block)).toBe(true);
  });

  it('каждый блок проходит ту же проверку, что и боевое окружение', () => {
    for (const block of blocks) {
      expect(() => validateEnv(block)).not.toThrow();
    }
  });

  it('ключ шифрования в CI декодируется ровно в 32 байта', () => {
    for (const block of blocks) {
      const key = block.ENCRYPTION_KEY as string;
      expect(Buffer.from(key, 'base64')).toHaveLength(32);
    }
  });

  it('в CI не утекли боевые секреты', () => {
    // Дешёвая проверка на копипасту из личного .env: тестовые значения
    // помечены словом test, боевые — нет.
    for (const block of blocks) {
      expect(block.JWT_SECRET).toMatch(/test/i);
      expect(block.IP_HASH_PEPPER).toMatch(/test/i);
      expect(block.TOKEN_HASH_PEPPER).toMatch(/test/i);
    }
  });
});
