import { defineConfig } from 'vitest/config';

export default defineConfig({
  esbuild: { jsx: 'automatic' },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    // Нужно для автоочистки DOM у Testing Library: она вешается на глобальный
    // afterEach, и без globals соседние тесты находят чужую разметку.
    globals: true,
  },
});
