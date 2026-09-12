import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  esbuild: { jsx: 'automatic' },
  // Алиас приходится объявлять повторно: при наличии собственного
  // vitest.config.ts vitest не читает vite.config.ts, и импорты вида '@/lib/api'
  // не резолвятся. Ошибка при этом выглядит как поломка теста, а не конфигурации.
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    // Нужно для автоочистки DOM у Testing Library: она вешается на глобальный
    // afterEach, и без globals соседние тесты находят чужую разметку.
    globals: true,
  },
});
