# StreamKit

Платформа для стримеров: конструктор виджетов-оповещений, агрегация донат-событий
с внешних площадок и дашборд аналитики.

## Что уже работает

Сквозной путь: регистрация → создание виджета → ссылка для браузер-сорса OBS →
приход события → оповещение на экране → запись в истории. Проверено тестами в
реальном браузере.

- аутентификация с ротацией refresh-токенов, детектом кражи и TOTP;
- виджеты оповещений с живым предпросмотром и настройкой шаблонов;
- отзываемые публичные ссылки для OBS (в БД хранится только хэш);
- приём событий через подписанный HMAC-вебхук с защитой от повтора;
- двухслойная дедупликация событий (Redis + уникальный индекс);
- живая лента событий в дашборде;
- раздел приватности: согласия с версиями документов, выгрузка и удаление данных.

## Быстрый старт

Нужны Node 22+, pnpm 11+, Docker.

```bash
pnpm install
cp .env.example .env
```

Сгенерируйте секреты и подставьте их в `.env`:

```bash
node -e "console.log('JWT_SECRET=' + require('crypto').randomBytes(48).toString('base64url'))"
```

```bash
node -e "console.log('ENCRYPTION_KEY=' + require('crypto').randomBytes(32).toString('base64'))"
```

```bash
node -e "console.log('IP_HASH_PEPPER=' + require('crypto').randomBytes(24).toString('base64url'))"
node -e "console.log('TOKEN_HASH_PEPPER=' + require('crypto').randomBytes(24).toString('base64url'))"
```

Поднимите базы и накатите схему:

```bash
docker compose -f infra/docker/compose.dev.yml --env-file .env up -d
```

```bash
pnpm db:migrate
```

Запустите приложения:

```bash
pnpm dev
```

- дашборд — http://localhost:5173
- оверлей — http://localhost:5174
- API — http://localhost:3000/api

## Проверка

```bash
pnpm typecheck
```

```bash
pnpm test
```

```bash
pnpm --filter @streamkit/api test:int
```

```bash
pnpm build && pnpm --filter @streamkit/e2e test
```

## Полный стек в Docker

```bash
docker compose -f infra/docker/compose.yml --env-file .env up --build
```

Дашборд на :8080, оверлей на :8081, API на :3000.

## Структура

| Каталог | Что это |
|---|---|
| `apps/api` | NestJS: HTTP, WebSocket и фоновый процесс |
| `apps/web` | Дашборд стримера (React + Vite) |
| `apps/overlay` | Страница для браузер-сорса OBS |
| `packages/contracts` | Zod-схемы: общий контракт данных |
| `packages/ui` | Рендерер виджета, общий для дашборда и оверлея |
| `e2e` | Сквозные сценарии Playwright |
| `infra/docker` | Образы и compose |
| `docs/adr` | Архитектурные решения и их причины |
| `docs/legal` | Юридический блок |

Подробности по каждому каталогу — в его `CLAUDE.md`. Общие правила и список уже
пойманных граблей — в корневом [CLAUDE.md](CLAUDE.md).

## Важное о юридической части

Тексты в `apps/web/public/legal/` — **черновики, написанные не юристом**.
Публиковать их и принимать по ним пользователей нельзя без проверки. Что сделано
технически и что осталось: [docs/legal/README.md](docs/legal/README.md).

## Дорожная карта

1. ~~Аналитика Twitch и YouTube~~ — сделано.
2. Остальные типы виджетов: цели, таймер, топ-донатеры.
3. Чат площадок. Отдельным этапом, а не вместе с виджетами: это не виджет, а
   новый канал данных — постоянное соединение на стримера со своим жизненным
   циклом. У Twitch он дёшев (анонимный IRC, без OAuth и без квоты), у YouTube
   не влезает в бюджет: `liveChatMessages.list` при обязательном опросе раз в
   пять секунд стоит около 4300 единиц за шестичасовой эфир одного стримера —
   почти половину суточной квоты ВСЕГО проекта (docs/adr/0007).
4. Приватные комнаты на LiveKit и виджет раскладки участников.
5. Собственный приём платежей — отдельный этап со своим анализом рисков.
