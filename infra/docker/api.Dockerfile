# Образ API и worker-процесса: один и тот же код, разные команды запуска.
# Собирается из корня монорепо: docker build -f infra/docker/api.Dockerfile .

FROM node:26-alpine AS base
ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"

# Системные пакеты базового образа. node:26-alpine собирается не каждый день и
# отстаёт от alpine на свежие патчи — сканер образа справедливо находит в нём
# libssl и libcrypto с известными уязвимостями.
RUN apk upgrade --no-cache

# corepack в образ Node больше не входит: начиная с 25-й версии его вынесли из
# дистрибутива, и `corepack enable` падает с «not found». Ставим его отдельно —
# он читает версию pnpm из поля packageManager, то есть версия остаётся
# зафиксированной в одном месте, а не дублируется в Dockerfile.
#
# Тем же шагом удаляется npm: пакетами здесь управляет pnpm, а собственные
# вложенные зависимости npm (tar, ip-address, brace-expansion) попадают в отчёт
# сканера как уязвимости ОБРАЗА. Чинить их нечем — это чужой код внутри базового
# образа, — а не использовать и держать незачем.
RUN npm install -g corepack@latest \
    && corepack enable \
    && rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx

WORKDIR /app

# --- Зависимости -----------------------------------------------------------
# Копируем только манифесты: слой с node_modules переиспользуется, пока не
# изменились зависимости. Копирование всего исходника до install ломает кэш
# на каждую правку кода.
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/config/package.json packages/config/
COPY packages/contracts/package.json packages/contracts/
COPY packages/ui/package.json packages/ui/
COPY apps/api/package.json apps/api/
# corepack скачивает pnpm лениво — при первом вызове `pnpm` — и без повторов:
# один обрыв связи с registry.npmjs.org (ECONNRESET) уронил выпуск всех образов.
# Качаем явно, до install, с паузами между попытками.
RUN for attempt in 1 2 3 4 5; do \
      corepack install && break; \
      [ "$attempt" = 5 ] && exit 1; \
      sleep $((attempt * 10)); \
    done
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter @streamkit/api...

# --- Сборка ----------------------------------------------------------------
FROM deps AS build
COPY packages/ packages/
COPY apps/api/ apps/api/
RUN pnpm --filter @streamkit/contracts build \
    && pnpm --filter @streamkit/api exec prisma generate \
    && pnpm --filter @streamkit/api build

# Выкидываем devDependencies: в рантайме нужны только production-зависимости.
# Флаг `--legacy` обязателен начиная с pnpm 10: по умолчанию `deploy` работает
# только в воркспейсах с `inject-workspace-packages=true`. Включать это ради
# сборки образа — значит поменять способ связывания пакетов и в разработке:
# рабочие зависимости начнут копироваться вместо симлинков.
RUN pnpm --filter @streamkit/api --prod deploy --legacy /deploy

# Клиент Prisma генерируется ПОВТОРНО, уже внутри /deploy.
#
# `pnpm deploy` собирает node_modules заново из store, а сгенерированный клиент
# в store не попадает — он появляется рядом с пакетом @prisma/client после
# `prisma generate`. Без этого шага образ собирается, но приложение падает при
# старте на «Cannot find module '.prisma/client/default'», и узнать об этом
# можно только запустив контейнер.
COPY apps/api/prisma /deploy/prisma
RUN cd /deploy     && /app/apps/api/node_modules/.bin/prisma generate --schema /deploy/prisma/schema.prisma

# --- Миграции --------------------------------------------------------------
# Отдельный образ для одноразовой задачи `prisma migrate deploy`.
#
# В рантайм-образ CLI Prisma не попадает: он в devDependencies и выкидывается
# `pnpm deploy --prod`, а npx удалён из базового образа вместе с npm. Команда
# `npx prisma migrate deploy` в compose поэтому не работала бы вовсе — узнали бы
# об этом на первой выкатке. Образ миграций берёт сборочную стадию, где CLI есть,
# и запускает его напрямую через node, без npx и pnpm.
FROM build AS migrate
WORKDIR /app/apps/api
USER node
CMD ["node", "node_modules/prisma/build/index.js", "migrate", "deploy"]

# --- Рантайм ---------------------------------------------------------------
FROM base AS runtime
ENV NODE_ENV=production

# Запуск от непривилегированного пользователя: образ node уже содержит `node`
# с uid 1000, отдельного создавать не нужно.
COPY --from=build --chown=node:node /deploy /app
COPY --from=build --chown=node:node /app/apps/api/dist /app/dist
COPY --from=build --chown=node:node /app/apps/api/prisma /app/prisma

USER node
EXPOSE 3000

# Проверка живости бьёт в /healthz — он намеренно не трогает БД и Redis,
# иначе падение базы приводило бы к перезапуску всех контейнеров API.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/main.js"]
