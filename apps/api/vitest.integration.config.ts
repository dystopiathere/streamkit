import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

/**
 * Интеграционные (feature) тесты: поднимают настоящее приложение Nest поверх
 * настоящих PostgreSQL и Redis в Testcontainers.
 *
 * Моки БД здесь намеренно не используются: половина логики, которую надо
 * проверить, — это уникальные индексы, каскады и транзакции, то есть ровно то,
 * что мок не воспроизводит.
 */
export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    environment: 'node',
    globals: false,
    include: ['test/**/*.int.test.ts'],
    setupFiles: ['test/setup.ts'],
    // Поднятие контейнеров и миграции занимают время — короткий таймаут даст
    // ложные падения на холодном запуске.
    testTimeout: 120_000,
    hookTimeout: 180_000,
    // Один воркер: тесты делят одну БД и чистят её между кейсами.
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
  },
});
