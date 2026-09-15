import { defineConfig, devices } from '@playwright/test';

// Адреса переопределяются окружением только для локального прогона рядом с
// запущенным `pnpm dev`: тот уже занял стандартные порты, а сборка для прогона
// должна знать свой адрес API. В CI — всегда значения по умолчанию.
const WEB_URL = process.env.E2E_WEB_URL ?? 'http://localhost:5173';
const OVERLAY_URL = process.env.E2E_OVERLAY_URL ?? 'http://localhost:5174';
const API_URL = process.env.E2E_API_URL ?? 'http://localhost:3000';
const FAKE_YOOKASSA_PORT = process.env.FAKE_YOOKASSA_PORT ?? '3099';

/**
 * Сквозные тесты гоняются по СОБРАННЫМ приложениям, а не по dev-серверам.
 *
 * Причина: в overlay и дашборде переменные `VITE_*` вшиваются в бандл при
 * сборке. Проверять надо именно тот артефакт, который поедет в прод, иначе
 * ошибка конфигурации сборки обнаружится уже после деплоя.
 */
export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  // Тесты делят одну базу, параллельный прогон сделает результат случайным.
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['html'], ['list']] : 'list',

  use: {
    baseURL: WEB_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    // Приватные комнаты: камера и микрофон — фальшивые устройства Chromium
    // (цветная тестовая картинка и тон), разрешение выдано заранее. Без первого
    // флага в CI нет ни одного устройства, без второго — висит диалог разрешения.
    permissions: ['camera', 'microphone'],
    launchOptions: {
      args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
    },
  },

  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],

  webServer: [
    {
      command: 'pnpm --filter @streamkit/api start',
      url: `${API_URL}/api/healthz`,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      env: {
        NODE_ENV: 'production',
        PORT: '3000',
        LOG_LEVEL: 'error',
        CORS_ORIGINS: `${WEB_URL},${OVERLAY_URL}`,
        OVERLAY_BASE_URL: OVERLAY_URL,
        // Лимит не отключён, а поднят — как в интеграционных тестах. Боевые
        // десять запросов к /auth в минуту с одного IP прогон исчерпывает сам:
        // каждый тест регистрирует пользователя, а перезагрузка страницы тратит
        // ещё одно обновление токена. Упавшее обновление выглядит как вылет на
        // страницу входа посреди теста, то есть как ошибка сессии, а не лимита.
        THROTTLE_LIMIT: '100000',
        THROTTLE_AUTH_LIMIT: '100000',
        // LiveKit в сквозном прогоне НАСТОЯЩИЙ — в режиме --dev с его встроенными
        // ключами: локально из compose.dev.yml, в CI отдельным контейнером.
        LIVEKIT_URL: process.env.LIVEKIT_URL ?? 'http://127.0.0.1:7880',
        LIVEKIT_PUBLIC_URL: process.env.LIVEKIT_PUBLIC_URL ?? 'ws://127.0.0.1:7880',
        LIVEKIT_API_KEY: process.env.LIVEKIT_API_KEY ?? 'devkey',
        LIVEKIT_API_SECRET: process.env.LIVEKIT_API_SECRET ?? 'secret',
        // Оплата — через фальшивую ЮKassa ниже: настоящая требует доступа к
        // api.yookassa.ru и уведомлений на публичный адрес.
        WEB_BASE_URL: WEB_URL,
        YOOKASSA_SHOP_ID: 'e2e-shop',
        YOOKASSA_SECRET_KEY: 'e2e-secret',
        YOOKASSA_API_URL: `http://127.0.0.1:${FAKE_YOOKASSA_PORT}/v3`,
        // Реквизиты продавца — выдуманные, но в формате настоящих: главная и
        // оферта показывают их, и сценарий проверяет, что они там есть.
        SELLER_NAME: 'Тестов Тест Тестович',
        SELLER_INN: '500100732259',
        SELLER_EMAIL: 'support@streamkit.test',
      },
    },
    {
      command: 'node fake-yookassa.mjs',
      url: `http://127.0.0.1:${FAKE_YOOKASSA_PORT}/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 10_000,
      env: {
        FAKE_YOOKASSA_PORT,
        FAKE_YOOKASSA_WEBHOOK_URL: `${API_URL}/api/billing/yookassa/webhook`,
      },
    },
    {
      command: 'pnpm --filter @streamkit/web preview',
      url: WEB_URL,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
    {
      command: 'pnpm --filter @streamkit/overlay preview',
      url: OVERLAY_URL,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
  ],
});
