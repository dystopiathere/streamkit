import { defineConfig } from 'vitest/config';

export default defineConfig({
  esbuild: { jsx: 'automatic' },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.tsx', 'src/**/*.test.ts'],
    // Обязательно для React Testing Library: её автоочистка DOM вешается на
    // глобальный afterEach. Без globals разметка предыдущего теста остаётся в
    // документе, и соседние тесты начинают находить чужие элементы.
    globals: true,
  },
});
