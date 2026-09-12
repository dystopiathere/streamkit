import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'prisma/config';

/**
 * Конфигурация CLI Prisma.
 *
 * Нужна ради одной вещи: сказать Prisma, где брать переменные окружения.
 * Сам по себе CLI ищет `.env` только рядом со схемой и в текущем каталоге, то
 * есть в `apps/api` — и из-за этого в проекте приходилось держать второй файл
 * с теми же секретами, что и в корневом. Наличие этого файла отключает
 * автозагрузку `.env`, так что порядок задаём сами: ближний, затем корневой.
 */
for (const file of [resolve(process.cwd(), '.env'), resolve(process.cwd(), '..', '..', '.env')]) {
  if (existsSync(file)) {
    process.loadEnvFile(file);
  }
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  // Адрес БД переехал сюда из схемы в Prisma 7. Читается он уже после
  // загрузки .env выше — порядок здесь существенен.
  datasource: { url: process.env.DATABASE_URL ?? '' },
});
