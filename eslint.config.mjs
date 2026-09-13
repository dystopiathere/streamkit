import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/**
 * Единый конфиг на всё монорепо.
 *
 * Проверка типов у нас отдельной командой (`tsc --noEmit`), поэтому ESLint здесь
 * отвечает за то, что компилятор не ловит: забытые await, небезопасные шаблоны,
 * нарушенные правила хуков. Дублировать работу tsc правилами с типовой
 * информацией дорого по времени и не добавляет ценности.
 */
export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/dist-worker/**',
      '**/build/**',
      '**/coverage/**',
      '**/.turbo/**',
      '**/node_modules/**',
      '**/playwright-report/**',
      '**/test-results/**',
      'apps/web/public/**',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    languageOptions: {
      globals: { ...globals.node, ...globals.es2023 },
    },
    rules: {
      // Неиспользуемое с префиксом `_` — осознанно оставленный параметр
      // (например, тело запроса, которое читает не контроллер, а сервис).
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // `any` в проекте с деньгами и токенами — почти всегда пропущенная ошибка.
      '@typescript-eslint/no-explicit-any': 'error',
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-implicit-coercion': 'error',
    },
  },

  // Фронтенд: браузерные глобальные объекты и правила хуков React.
  {
    files: ['apps/web/**/*.{ts,tsx}', 'apps/overlay/**/*.{ts,tsx}', 'packages/ui/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    languageOptions: {
      globals: { ...globals.browser },
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
    },
  },

  // NestJS: значение, использованное только внутри декоратора параметра,
  // ESLint не видит в потоке выполнения и считает присваивание бесполезным.
  // Ложное срабатывание — схема действительно используется.
  {
    files: ['apps/api/**/*.ts'],
    rules: { 'no-useless-assignment': 'off' },
  },

  // Скрипты и сиды печатают в консоль по назначению.
  {
    files: ['**/prisma/seed.ts', '**/*.config.{ts,mjs}', 'e2e/**/*.ts'],
    rules: { 'no-console': 'off' },
  },

  // В тестах разрешаем приведения: мы сознательно подсовываем моки под типы
  // библиотек, и требовать точного соответствия — значит писать мок ради типа.
  {
    files: ['**/*.test.ts', '**/*.test.tsx', '**/test/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unsafe-function-type': 'off',
    },
  },
);
