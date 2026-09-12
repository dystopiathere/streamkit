import { Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

/**
 * Единственная точка доступа к БД. Сервисы инжектят её, а не создают клиента сами —
 * иначе в тестах и в проде расползаются независимые пулы соединений.
 *
 * С Prisma 7 клиент подключается через драйвер-адаптер: собственный движок на
 * Rust из клиента убрали, и адрес БД теперь приходит сюда, а не из схемы.
 * Читаем его из окружения напрямую, а не через AppConfig: этот сервис поднимают
 * и точки входа без Nest — seed и интеграционные тесты.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error('DATABASE_URL не задан: подключиться к базе нечем');
    }
    super({ adapter: new PrismaPg({ connectionString }) });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  /**
   * Очистка всех таблиц. Только для интеграционных тестов: в проде вызов
   * бессмысленен и опасен, поэтому на NODE_ENV=production бросаем исключение.
   */
  async truncateAll(): Promise<void> {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('truncateAll недопустим в production');
    }
    const tables = await this.$queryRaw<Array<{ tablename: string }>>`
      SELECT tablename FROM pg_tables
      WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
    `;
    if (tables.length === 0) return;
    const list = tables.map((table) => `"public"."${table.tablename}"`).join(', ');
    await this.$executeRawUnsafe(`TRUNCATE TABLE ${list} CASCADE`);
  }
}
