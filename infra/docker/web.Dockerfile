# Образ статики: используется и для дашборда, и для overlay.
# Какое приложение собирать, задаётся аргументом APP.
#
#   docker build -f infra/docker/web.Dockerfile --build-arg APP=web .
#   docker build -f infra/docker/web.Dockerfile --build-arg APP=overlay .

FROM node:26-alpine AS base
ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"
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

FROM base AS build
ARG APP=web
# VITE_-переменные попадают в бандл на этапе сборки, а не читаются в рантайме.
# Значит, для другого домена API нужен пересобранный образ — это ограничение
# любой статики, и лучше знать о нём здесь, чем искать причину в проде.
ARG VITE_API_URL=/api
ENV VITE_API_URL=$VITE_API_URL

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/config/package.json packages/config/
COPY packages/contracts/package.json packages/contracts/
COPY packages/ui/package.json packages/ui/
COPY apps/web/package.json apps/web/
COPY apps/overlay/package.json apps/overlay/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile

COPY packages/ packages/
COPY apps/web/ apps/web/
COPY apps/overlay/ apps/overlay/

RUN pnpm --filter @streamkit/contracts build \
    && pnpm --filter @streamkit/ui build \
    && pnpm --filter @streamkit/${APP} build

# Кладём результат в фиксированный путь, чтобы финальный слой не зависел от APP.
RUN cp -r apps/${APP}/dist /dist

FROM nginx:1.27-alpine AS runtime
# ARG не переживает границу стадии и объявляется заново.
ARG APP=web
COPY --from=build /dist /usr/share/nginx/html
COPY infra/docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY infra/docker/security-headers.conf /etc/nginx/snippets/security-headers.conf
COPY infra/docker/permissions-${APP}.conf /etc/nginx/snippets/permissions.conf

# Дополнительные адреса для connect-src — только для локального стека.
#
# В проде API и LiveKit ходят по https:// и wss://, и базовой политики хватает.
# Локальный compose.yml отдаёт API по http://localhost:3000 и LiveKit по ws://,
# и CSP их блокирует. Пока заголовки не доходили до страницы (см. грабли в
# CLAUDE.md про add_header), это работало случайно. Аргумент сборки, а не
# переменная запуска, — по той же причине, что и VITE_API_URL: адреса статики
# всё равно вшиваются при сборке. Пустое значение не меняет политику.
ARG CSP_CONNECT_EXTRA=""
RUN if [ -n "$CSP_CONNECT_EXTRA" ]; then \
      sed -i "s#connect-src 'self' https: wss:#connect-src 'self' https: wss: $CSP_CONNECT_EXTRA#" \
        /etc/nginx/snippets/security-headers.conf; \
    fi

EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
  CMD wget -q --spider http://127.0.0.1/ || exit 1
