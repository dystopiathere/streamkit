#!/usr/bin/env bash
# Выкатка выпуска на ВМ приложений: ./deploy.sh <sha коммита>
#
# Порядок не случайный:
#   1. окружение из Lockbox — до всего, чтобы не выкатить образ без секретов;
#   2. образы скачиваются заранее — простой начинается только после них;
#   3. миграции до нового кода — новый код рассчитывает на новую схему, а
#      старый продолжает работать на ней, пока идёт пересоздание: миграции
#      только добавляющие (ломающие изменения — в два выпуска);
#   4. api, worker, статика и Caddy;
#   5. ожидание готовности API — выкатка не считается успешной, пока /readyz
#      не ответил.
set -euo pipefail

TAG=${1:?Укажите тег выпуска: полный sha коммита}
if [[ ! $TAG =~ ^[0-9a-f]{40}$ ]]; then
  echo "Тег должен быть полным sha коммита, получено: ${TAG}" >&2
  exit 1
fi

cd "$(dirname "$0")"
# shellcheck source-path=SCRIPTDIR/../lib
source ./lockbox.sh
# shellcheck disable=SC1091
set -a && source ./infra.env && set +a

# Версии сторонних образов: те же, что зеркалирует выпуск (release.yml).
CADDY_VERSION=2.10.0

echo "==> Окружение из Lockbox"
umask 077
{
  echo "# Собрано deploy.sh $(date -u +%FT%TZ). Не редактировать: перезапишется."
  lockbox_env "$LOCKBOX_APP_SECRET_ID"
  lockbox_env "$LOCKBOX_LIVEKIT_SECRET_ID"
  lockbox_env "$LOCKBOX_EXTERNAL_SECRET_ID"
} >.env.next

POSTGRES_PASSWORD=$(env_value .env.next POSTGRES_PASSWORD)
VALKEY_PASSWORD=$(env_value .env.next VALKEY_PASSWORD)
DATABASE="${POSTGRES_USER}:${POSTGRES_PASSWORD}@${POSTGRES_HOST}:6432/${POSTGRES_DB}"

cat >>.env.next <<EOF
NODE_ENV='production'
LOG_LEVEL='info'
# node-postgres и ioredis проверяют сертификат управляемых баз по корневому
# сертификату Yandex Cloud: он добавляется к системным.
NODE_EXTRA_CA_CERTS='/etc/streamkit/yandex-ca.pem'
DATABASE_URL='postgresql://${DATABASE}?sslmode=verify-full'
REDIS_URL='rediss://:${VALKEY_PASSWORD}@${VALKEY_HOST}:6380'
CORS_ORIGINS='https://${DOMAIN},https://overlay.${DOMAIN}'
WEB_BASE_URL='https://${DOMAIN}'
OVERLAY_BASE_URL='https://overlay.${DOMAIN}'
OAUTH_REDIRECT_BASE_URL='https://api.${DOMAIN}'
LIVEKIT_URL='http://${LIVEKIT_PRIVATE_IP}:7880'
LIVEKIT_PUBLIC_URL='wss://rtc.${DOMAIN}'
EOF
mv .env.next .env

# Переменные подстановки в compose.yml — отдельно от окружения контейнеров:
# пароль попадает сюда только в адресе для миграций.
cat >release.env <<EOF
IMAGE_TAG=${TAG}
CADDY_VERSION=${CADDY_VERSION}
MIGRATE_DATABASE_URL=postgresql://${DATABASE}?sslmode=require&sslaccept=strict&sslcert=/etc/streamkit/yandex-ca.pem
EOF

compose() {
  docker compose --env-file infra.env --env-file release.env "$@"
}

echo "==> Образы ${TAG}"
registry_login
compose --profile migrate pull --quiet

echo "==> Миграции"
compose run --rm migrate

echo "==> Запуск"
compose up -d --remove-orphans

echo "==> Ожидание готовности API"
for attempt in $(seq 1 60); do
  if curl -fsS "http://${APP_PRIVATE_IP}:3000/api/readyz" >/dev/null 2>&1; then
    echo "API готов (попытка ${attempt})"
    echo "$TAG" >DEPLOYED_TAG
    docker image prune -f >/dev/null
    exit 0
  fi
  sleep 2
done

echo "API не ответил на /readyz за две минуты" >&2
compose ps
compose logs --tail 80 api
exit 1
