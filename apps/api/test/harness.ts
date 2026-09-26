import type { INestApplication, ModuleMetadata } from '@nestjs/common';
import { Test, type TestingModuleBuilder } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import type { Redis } from 'ioredis';
import { AppModule } from '../src/app.module';
import { registerBodyParsers } from '../src/common/http/body-parsers';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { REDIS_CLIENT } from '../src/common/redis/redis.module';
import type { MailMessage } from '../src/common/mail/mailer';

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

  const app = moduleRef.createNestApplication<NestExpressApplication>({ rawBody: true });
  registerBodyParsers(app);
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

/** Принятие документов сервиса: одно поле, см. registerSchema. */
export const ACCEPT_DOCUMENTS = true;

export function registrationPayload(overrides: Record<string, unknown> = {}) {
  return {
    email: `user-${Math.random().toString(36).slice(2, 10)}@example.com`,
    password: 'очень-надёжный-пароль-1',
    displayName: 'Тестовый стример',
    acceptDocuments: ACCEPT_DOCUMENTS,
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

const VERIFICATION_SUBJECTS = ['StreamKit: подтвердите почту', 'StreamKit: confirm your email'];

/**
 * Письмо подтверждения, которое регистрация шлёт без ожидания, — дождаться и
 * забрать из почты теста. Без этого оно приходит посреди теста и путает счёт
 * писем, которые тест проверяет.
 */
export async function takeVerificationLetter(
  sent: MailMessage[],
  email: string,
): Promise<MailMessage> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const index = sent.findIndex(
      (letter) => letter.to === email && VERIFICATION_SUBJECTS.includes(letter.subject),
    );
    if (index >= 0) return sent.splice(index, 1)[0]!;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('Нет письма подтверждения почты');
}

/** Почта подтверждена — как будто открыли ссылку из письма. */
export async function markEmailVerified(harness: TestHarness, userId: string): Promise<void> {
  await harness.prisma.user.update({
    where: { id: userId },
    data: { emailVerifiedAt: new Date() },
  });
}

/** Токен из ссылки письма: он во фрагменте адреса. */
export function linkTokenFrom(letter: MailMessage): string {
  const match = /#token=([A-Za-z0-9_-]{43})/.exec(letter.text);
  if (!match) throw new Error('В письме нет ссылки');
  return match[1]!;
}
