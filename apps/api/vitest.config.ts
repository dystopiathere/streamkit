import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

/**
 * Юнит-тесты.
 *
 * Трансформируем SWC, а не esbuild: esbuild не эмитит метаданные декораторов,
 * без которых DI Nest не может определить типы конструктора. Симптом — «Nest
 * can't resolve dependencies» в тестах при рабочем проде.
 */
export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    environment: 'node',
    globals: false,
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/main.ts', 'src/**/*.module.ts'],
      thresholds: {
        statements: 70,
        branches: 70,
        functions: 70,
        lines: 70,
      },
    },
  },
});
