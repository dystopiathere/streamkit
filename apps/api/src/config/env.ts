import { z } from 'zod';

/**
 * Схема окружения. Приложение падает на старте, если чего-то не хватает или
 * значение бессмысленно — это лучше, чем узнать о пустом секрете в проде через
 * неделю. Значения по умолчанию заданы только для того, что безопасно по умолчанию.
 */
export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),

  /** Секрет подписи access-токенов. Минимум 32 символа. */
  JWT_SECRET: z.string().min(32, 'JWT_SECRET должен быть не короче 32 символов'),
  /** Время жизни access-токена в секундах. Короткое — компенсируется refresh-ротацией. */
  JWT_ACCESS_TTL: z.coerce.number().int().min(60).max(3600).default(900),
  /** Время жизни refresh-токена в днях. */
  REFRESH_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(30),

  /**
   * Ключ шифрования полей БД: 32 байта в base64.
   * Сгенерировать: node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
   */
  ENCRYPTION_KEY: z
    .string()
    .refine(
      (value) => Buffer.from(value, 'base64').length === 32,
      'ENCRYPTION_KEY должен быть 32 байтами в base64',
    ),

  /** Отдельный перец для хэширования IP. Позволяет менять его, не трогая шифрование. */
  IP_HASH_PEPPER: z.string().min(16),

  // Отдельный ключ для хэшей наших токенов. Не переиспользуем ENCRYPTION_KEY:
  // один ключ на два примитива связывает ротацию шифрования с обнулением всех
  // сессий и всех ссылок для OBS разом.
  TOKEN_HASH_PEPPER: z.string().min(16),

  /** Разрешённые Origin через запятую. Пустого значения быть не должно. */
  CORS_ORIGINS: z
    .string()
    .min(1)
    .transform((value) =>
      value
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean),
    ),

  /** Домен для cookie. Пусто — cookie для текущего хоста (так и надо на localhost). */
  COOKIE_DOMAIN: z.string().optional(),

  /** Базовый публичный URL overlay-приложения: из него собираются ссылки для OBS. */
  OVERLAY_BASE_URL: z.string().url(),

  /** Лимит запросов в минуту на IP для обычных ручек. */
  THROTTLE_LIMIT: z.coerce.number().int().min(1).default(120),
  /** Лимит попыток логина в минуту на IP. Жёстче общего. */
  THROTTLE_AUTH_LIMIT: z.coerce.number().int().min(1).default(10),
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(raw: Record<string, unknown>): Env {
  const result = envSchema.safeParse(raw);
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `  ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Некорректное окружение:\n${details}`);
  }
  return result.data;
}

/** Типизированный доступ к конфигу: config.get('JWT_SECRET') вместо строк наугад. */
export type TypedConfig = {
  get<K extends keyof Env>(key: K): Env[K];
};
