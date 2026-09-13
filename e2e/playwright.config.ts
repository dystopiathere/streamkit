import { defineConfig, devices } from '@playwright/test';

const WEB_URL = 'http://localhost:5173';
const OVERLAY_URL = 'http://localhost:5174';
const API_URL = 'http://localhost:3000';

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
