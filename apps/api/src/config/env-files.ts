import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Где искать файл окружения.
 *
 * Единственный файл живёт в корне репозитория — там же, где его ждёт docker
 * compose. Ближний путь оставлен намеренно: он позволяет переопределить
 * настройки для одного приложения, не трогая общие, и именно он используется
 * внутри контейнера, где корневого файла нет.
 *
 * Порядок важен и означает «ближний побеждает»: и `ConfigModule`, и
 * `process.loadEnvFile` не перетирают уже заданные переменные.
 */
export function envFiles(from: string = process.cwd()): string[] {
  return [resolve(from, '.env'), resolve(from, '..', '..', '.env')];
}

/**
 * Загружает окружение для точек входа, которые поднимаются без NestJS:
 * seed-скрипта и харнесса тестов. Отсутствующий файл пропускается.
 */
export function loadEnvFiles(from?: string): void {
  for (const file of envFiles(from)) {
    if (existsSync(file)) {
      process.loadEnvFile(file);
    }
  }
}
