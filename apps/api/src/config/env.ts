import { z } from 'zod';

/**
 * Схема окружения. Приложение падает на старте, если чего-то не хватает или
 * значение бессмысленно — это лучше, чем узнать о пустом секрете в проде через
 * неделю. Значения по умолчанию заданы только для того, что безопасно по умолчанию.
 */
/**
 * Необязательная переменная, у которой пустая строка означает «не задана».
 *
 * Обычный `.optional()` этого не делает: `FOO=` в файле окружения — это
 * присутствующее значение, просто пустое, и проверка `min(1)` на нём падает.
 * Ровно так и вышло: в `.env.example` ключи площадок стоят пустыми, и
 * приложение, прочитав такой файл, отказывалось стартовать целиком — вместо
 * того чтобы просто не предлагать ненастроенную площадку.
 *
 * Пробелы срезаются заодно: значение, скопированное из консоли площадки,
 * регулярно приезжает с хвостовым пробелом, а секрет с пробелом не сходится
 * молча и необъяснимо.
 */
function optionalValue() {
  return z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
    z.string().trim().min(1).optional(),
  );
}

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
  COOKIE_DOMAIN: optionalValue(),

  /** Базовый публичный URL overlay-приложения: из него собираются ссылки для OBS. */
  OVERLAY_BASE_URL: z.string().url(),

  /** Куда возвращать пользователя после OAuth площадки. */
  WEB_BASE_URL: z.string().url().default('http://localhost:5173'),

  /**
   * Базовый адрес самого API — из него собирается redirect_uri.
   *
   * Отдельно от WEB_BASE_URL: callback принимает бэкенд, и адрес обязан
   * посимвольно совпадать с зарегистрированным в приложении площадки.
   */
  OAUTH_REDIRECT_BASE_URL: z.string().url().default('http://localhost:3000'),

  // Учётные данные площадок необязательны: без них площадка просто не
  // предлагается к подключению. Требовать их означало бы, что ни одно
  // существующее окружение и ни один прогон CI больше не стартует.
  TWITCH_CLIENT_ID: optionalValue(),
  TWITCH_CLIENT_SECRET: optionalValue(),
  YOUTUBE_CLIENT_ID: optionalValue(),
  YOUTUBE_CLIENT_SECRET: optionalValue(),

  /**
   * Суточный бюджет запросов к YouTube Data API.
   *
   * Лимит Google — 10 000 единиц на проект в сутки, и это лимит НА ВСЕХ
   * пользователей сразу, а не на каждого. Делится на два бюджета — метрики и
   * чат, — чтобы чат одного длинного эфира не остановил аналитику всем. Сумма
   * держится с запасом: остаток нужен на подключение каналов и ручные проверки.
   * После повышения квоты Google оба числа поднимаются здесь.
   */
  YOUTUBE_DAILY_QUOTA: z.coerce.number().int().min(0).default(7000),
  /** Бюджет чата YouTube из того же лимита проекта (docs/adr/0014). */
  YOUTUBE_CHAT_DAILY_QUOTA: z.coerce.number().int().min(0).default(2000),
  /**
   * Сколько единиц резервировать на открытие потока чата `streamList`.
   *
   * Google эту цену не публикует. 5 — осторожная оценка, пока она не измерена
   * на живом эфире по графику квоты в Google Cloud Console.
   */
  YOUTUBE_CHAT_STREAM_COST: z.coerce.number().int().min(0).default(5),

  /**
   * Адрес IRC-шлюза Twitch. Переопределяется только в тестах.
   *
   * Чат читается анонимно, поэтому ни ключа, ни секрета здесь нет: достаточно
   * логина канала в настройках виджета. Переменная существует ради
   * интеграционного теста, который поднимает поддельный сервер вместо сети —
   * иначе проверить весь путь «соединение → JOIN → сообщение» было бы нечем.
   */
  TWITCH_IRC_URL: optionalValue(),

  /**
   * Адреса Twitch: вход (OAuth), Helix и сокет EventSub. Переопределяются только
   * в тестах — интеграционный и сквозной прогоны поднимают поддельный Twitch,
   * как поддельный DonationAlerts.
   */
  TWITCH_AUTH_URL: optionalValue(),
  TWITCH_API_URL: optionalValue(),
  TWITCH_EVENTSUB_URL: optionalValue(),

  /**
   * Адреса Google: вход, обмен кода, YouTube Data API и gRPC-сервис чата
   * (`хост:порт`). Переопределяются только в тестах — прогоны поднимают
   * поддельный YouTube, как поддельный Twitch.
   */
  YOUTUBE_AUTH_URL: optionalValue(),
  YOUTUBE_TOKEN_URL: optionalValue(),
  YOUTUBE_API_URL: optionalValue(),
  YOUTUBE_CHAT_GRPC_URL: optionalValue(),
  /**
   * gRPC без TLS — только для поддельного сервера в тестах. В production
   * конфигурация с этим флагом не стартует: токен стримера ушёл бы открытым текстом.
   */
  YOUTUBE_CHAT_GRPC_INSECURE: optionalValue(),

  /**
   * Приложение DonationAlerts (`donationalerts.com/application/clients`).
   * Без него сервис не предлагается к подключению — как и площадки.
   */
  DONATIONALERTS_CLIENT_ID: optionalValue(),
  DONATIONALERTS_CLIENT_SECRET: optionalValue(),
  /**
   * Адреса DonationAlerts: сайт (OAuth и API) и сокет Centrifugo. Переопределяются
   * только в тестах — те поднимают поддельный сервер вместо сети, как для чата.
   */
  DONATIONALERTS_BASE_URL: optionalValue(),
  DONATIONALERTS_SOCKET_URL: optionalValue(),

  /**
   * LiveKit — медиасервер приватных комнат. Все четыре необязательны: без них
   * приложение стартует, а комнаты отвечают «не настроены».
   *
   * Адресов ДВА, и это разные значения. `LIVEKIT_URL` — откуда API ходит в
   * серверный API LiveKit (внутри сети: `http://livekit:7880`). `LIVEKIT_PUBLIC_URL`
   * — куда подключаются браузеры (`wss://rtc.example.ru`). Перепутать их легко, и
   * проявится это только в собранном окружении: локально оба указывают на один
   * localhost.
   */
  LIVEKIT_URL: optionalValue(),
  LIVEKIT_PUBLIC_URL: optionalValue(),
  LIVEKIT_API_KEY: optionalValue(),
  LIVEKIT_API_SECRET: optionalValue(),

  /**
   * ЮKassa — приём оплаты подписки. Без идентификатора магазина и ключа оплата
   * не настроена, и приватные комнаты бесплатны (docs/adr/0011).
   *
   * `YOOKASSA_API_URL` задают только тесты: сквозной прогон ходит в фальшивый
   * сервер. `YOOKASSA_VAT_CODE` зависит от налогового режима юрлица и
   * выбирается бухгалтером, а не кодом: 1 — без НДС.
   */
  YOOKASSA_SHOP_ID: optionalValue(),
  YOOKASSA_SECRET_KEY: optionalValue(),
  YOOKASSA_API_URL: z.string().url().default('https://api.yookassa.ru/v3'),
  /**
   * Кто формирует чек. `none` — самозанятый: доход регистрирует и чек формирует
   * сама ЮKassa, объект `receipt` не нужен, а без
   * подключённых «Чеков от ЮKassa» платёж с ним отклоняется. `fiscal` — ИП или
   * юрлицо: чек 54-ФЗ формирует касса ЮKassa по `receipt`, со ставкой НДС и
   * системой налогообложения ниже.
   */
  YOOKASSA_RECEIPTS: z.enum(['none', 'fiscal']).default('none'),
  YOOKASSA_VAT_CODE: z.coerce.number().int().min(1).max(12).default(1),
  // Через optionalValue: пустое `YOOKASSA_TAX_SYSTEM_CODE=` в .env иначе стало
  // бы нулём и уронило старт (грабля с пустыми значениями в CLAUDE.md).
  YOOKASSA_TAX_SYSTEM_CODE: optionalValue().pipe(
    z
      .string()
      .regex(/^[1-6]$/, 'Система налогообложения в чеке — число от 1 до 6')
      .transform(Number)
      .optional(),
  ),

  /**
   * Реквизиты продавца — на публичной странице, в оферте и в документах.
   *
   * ЮKassa проверяет сайт до подключения: цены, порядок получения услуги,
   * оферта и реквизиты должны быть видны без входа в аккаунт. В переменных, а не
   * в коде: это персональные данные владельца, и в репозитории им не место.
   */
  SELLER_NAME: optionalValue(),
  SELLER_INN: optionalValue().pipe(
    z
      .string()
      .regex(/^(\d{10}|\d{12})$/, 'ИНН — 10 цифр у организации или 12 у физического лица')
      .optional(),
  ),
  SELLER_EMAIL: optionalValue().pipe(z.string().email().optional()),
  SELLER_PHONE: optionalValue(),

  /**
   * Почта: SMTP-сервер, через который уходят служебные письма (предупреждение
   * о списании за подписку). В проде — Yandex Cloud Postbox, в разработке —
   * Mailpit из compose.dev.yml. Без хоста и отправителя почта не настроена, и
   * продление подписки НЕ списывается: оферта обещает письмо за три дня.
   */
  SMTP_HOST: optionalValue(),
  SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(587),
  SMTP_USER: optionalValue(),
  SMTP_PASSWORD: optionalValue(),
  /** `StreamKit <noreply@stream-kit.ru>`. Домен должен быть подтверждён в Postbox. */
  MAIL_FROM: optionalValue(),

  /**
   * Статистика посещений (Umami на своём сервере). Идентификатор сайта
   * выдаёт интерфейс Umami после первого входа; без него скрипт не грузится.
   * Адрес базы Umami нужен воркеру: срок хранения статистики держим мы, у
   * самого Umami удаления старых данных нет.
   */
  UMAMI_WEBSITE_ID: optionalValue().pipe(z.string().uuid().optional()),
  UMAMI_DATABASE_URL: optionalValue().pipe(z.string().url().optional()),

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
