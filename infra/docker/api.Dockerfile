# Образ API и worker-процесса: один и тот же код, разные команды запуска.
# Собирается из корня монорепо: docker build -f infra/docker/api.Dockerfile .

FROM node:24-alpine AS base
ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable
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
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter @streamkit/api...

# --- Сборка ----------------------------------------------------------------
FROM deps AS build
COPY tsconfig.base.json ./
COPY packages/ packages/
COPY apps/api/ apps/api/
RUN pnpm --filter @streamkit/contracts build \
    && pnpm --filter @streamkit/api exec prisma generate \
    && pnpm --filter @streamkit/api build

# Выкидываем devDependencies: в рантайме нужны только production-зависимости.
RUN pnpm --filter @streamkit/api --prod deploy /deploy

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
