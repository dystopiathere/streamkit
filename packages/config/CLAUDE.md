# @streamkit/config

## Назначение
Общие пресеты конфигурации для всех воркспейсов монорепо. Кода не содержит — только
JSON-пресеты, от которых наследуются `tsconfig.json` приложений и пакетов.

## Содержимое
| Файл | Для чего |
|---|---|
| `tsconfig/node.json` | NestJS-приложения (`apps/api`, `apps/worker`): CommonJS, декораторы, `types: ["node"]` |
| `tsconfig/react.json` | Vite-приложения (`apps/web`, `apps/overlay`): JSX, DOM-библиотеки, `noEmit` |
| `tsconfig/lib.json` | Публикуемые пакеты (`packages/contracts`, `packages/ui`): ESM, эмит в `dist` |

Все три наследуются от `tsconfig/base.json` в этом же пакете, где включён `strict`,
`noUncheckedIndexedAccess` и `noImplicitOverride`.

## Правила
- Менять строгость TypeScript только здесь и только вверх. Ослабление правил в
  отдельном приложении (`tsconfig.json` с переопределением) запрещено — если правило
  мешает, обсуждаем и меняем централизованно.
- Никаких зависимостей: пакет должен оставаться нулевым по весу.
- `paths`-алиасы тут не задаём: резолв между воркспейсами делает pnpm через
  `workspace:*`, а не маппинг путей.
