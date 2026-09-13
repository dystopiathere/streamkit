import type { INestApplication, ModuleMetadata } from '@nestjs/common';
import { Test, type TestingModuleBuilder } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import type { Redis } from 'ioredis';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { REDIS_CLIENT } from '../src/common/redis/redis.module';

export interface TestHarness {
  app: INestApplication;
  prisma: PrismaService;
  redis: Redis;
  reset: () => Promise<void>;
  close: () => Promise<void>;
}

/**
 * Поднимает настоящее приложение поверх настоящих PostgreSQL и Redis.
 *
 * Никаких моков хранилищ: проверяемое поведение — это уникальные индексы,
 * каскадные удаления, транзакции и атомарный SET NX. Мок воспроизводит их
 * неверно, и тест начинает подтверждать не то, что работает в проде.
 *
 * Адреса берутся из окружения (DATABASE_URL, REDIS_URL): локально их даёт
 * compose.dev.yml, в CI — сервисные контейнеры.
 */
export async function createHarness(
  extraImports: NonNullable<ModuleMetadata['imports']> = [],
  configure: (builder: TestingModuleBuilder) => TestingModuleBuilder = (builder) => builder,
): Promise<TestHarness> {
  // Дополнительные модули нужны воркерным тестам: ChatModule в AppModule не
  // входит намеренно — в API он поднимал бы соединение с чатом на каждом
  // инстансе и рвал бы его при каждом деплое.
  //
  // `configure` подменяет внешние системы, которых в прогоне нет, — например,
  // медиасервер комнат. Хранилища не подменяются никогда, см. выше.
  const moduleRef = await configure(
    Test.createTestingModule({ imports: [AppModule, ...extraImports] }),
  ).compile();

  const app = moduleRef.createNestApplication({ rawBody: true });
  app.setGlobalPrefix('api');
  app.use(cookieParser());
  // Глобальный ValidationPipe из Nest здесь не нужен и вреден: он тянет
  // class-validator, которого в проекте нет — валидация идёт схемами Zod
  // прямо в параметрах контроллеров.
  await app.init();

  const prisma = app.get(PrismaService);
  const redis = app.get<Redis>(REDIS_CLIENT);

  return {
    app,
    prisma,
    redis,
    // Чистим и БД, и Redis: оставшийся ключ дедупликации от прошлого теста
    // заставит следующий тест молча отбросить событие.
    reset: async () => {
      await prisma.truncateAll();
      await redis.flushdb();
    },
    close: async () => {
      await app.close();
    },
  };
}

/** Согласия, обязательные при регистрации. */
export const VALID_CONSENTS = { terms: true, privacy: true, personalData: true } as const;

export function registrationPayload(overrides: Record<string, unknown> = {}) {
  return {
    email: `user-${Math.random().toString(36).slice(2, 10)}@example.com`,
    password: 'очень-надёжный-пароль-1',
    displayName: 'Тестовый стример',
    consents: VALID_CONSENTS,
    ...overrides,
  };
}

/** Достаёт значение cookie из заголовков ответа. */
export function extractCookie(setCookie: string[] | undefined, name: string): string | null {
  const header = setCookie?.find((cookie) => cookie.startsWith(`${name}=`));
  if (!header) return null;
  const value = header.split(';')[0]?.split('=')[1];
  return value ? decodeURIComponent(value) : null;
}
