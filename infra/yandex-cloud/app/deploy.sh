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
UMAMI_VERSION=3.3.1

echo "==> Окружение из Lockbox"
umask 077
# Ключи статистики посещений лежат в секрете приложения, но API они не нужны:
# их получают только Umami, Caddy (хэш пароля) и воркер (адрес базы Umami).
STATS_KEYS='^(UMAMI_DB_PASSWORD|UMAMI_APP_SECRET|STATS_PASSWORD)='
lockbox_env "$LOCKBOX_APP_SECRET_ID" >.app-secret.next
{
  echo "# Собрано deploy.sh $(date -u +%FT%TZ). Не редактировать: перезапишется."
  grep -Ev "$STATS_KEYS" .app-secret.next
  lockbox_env "$LOCKBOX_LIVEKIT_SECRET_ID"
  lockbox_env "$LOCKBOX_EXTERNAL_SECRET_ID"
} >.env.next
UMAMI_DB_PASSWORD=$(env_value .app-secret.next UMAMI_DB_PASSWORD)
UMAMI_APP_SECRET=$(env_value .app-secret.next UMAMI_APP_SECRET)
STATS_PASSWORD=$(env_value .app-secret.next STATS_PASSWORD)
rm -f .app-secret.next
# Без них Umami не стартует, а хэш пустого пароля открыл бы stats.<домен> любому.
if [[ -z $UMAMI_DB_PASSWORD || -z $UMAMI_APP_SECRET || -z $STATS_PASSWORD ]]; then
  echo "В секрете приложения нет ключей статистики — выполните terraform apply" >&2
  exit 1
fi

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
# Postbox: логин и пароль SMTP — API-ключ сервисного аккаунта из секрета
# приложения (SMTP_USER и SMTP_PASSWORD уже в файле). Домен отправителя
# подтверждается в Postbox записью DKIM (terraform/dns.tf).
SMTP_HOST='postbox.cloud.yandex.net'
SMTP_PORT='587'
MAIL_FROM='StreamKit <noreply@${DOMAIN}>'
# Воркер удаляет статистику старше срока хранения — у Umami этого нет.
UMAMI_DATABASE_URL='postgresql://umami:${UMAMI_DB_PASSWORD}@${POSTGRES_HOST}:6432/umami?sslmode=verify-full'
EOF
mv .env.next .env

# Umami подключается к базе двумя путями. Миграции при старте идут через CLI
# Prisma, и сертификат ему без sslcert не проверить — там шифрование без проверки
# (sslaccept=accept_invalid_certs), по внутренней сети облака. Сам сервер — через
# node-postgres, который сертификат проверяет по NODE_EXTRA_CA_CERTS.
cat >umami.env <<UMAMI_ENV
DATABASE_URL='postgresql://umami:${UMAMI_DB_PASSWORD}@${POSTGRES_HOST}:6432/umami?sslmode=require&sslaccept=accept_invalid_certs'
APP_SECRET='${UMAMI_APP_SECRET}'
NODE_EXTRA_CA_CERTS='/etc/streamkit/yandex-ca.pem'
UMAMI_ENV

# Движок миграций Prisma читает из sslcert только ПЕРВЫЙ сертификат, а в CA.pem
# Yandex Cloud первым идёт промежуточный YandexCLCA, корень — вторым. С полным
# файлом миграции падают на «unable to get issuer certificate», хотя openssl с
# ним цепочку проверяет. Движку — отдельный файл с одним корнем, найденным по
# самоподписи, а не по порядку в файле.
echo "==> Корневой сертификат для миграций"
certs=$(mktemp -d)
awk -v dir="$certs" '/BEGIN CERTIFICATE/ { n++ } n { print > (dir "/" n ".pem") }' yandex-ca.pem
rm -f yandex-root-ca.pem
for cert in "$certs"/*.pem; do
  if [[ $(openssl x509 -in "$cert" -noout -subject -nameopt RFC2253) == \
    "subject=$(openssl x509 -in "$cert" -noout -issuer -nameopt RFC2253 | cut -d= -f2-)" ]]; then
    cp "$cert" yandex-root-ca.pem
  fi
done
rm -rf "$certs"
if [[ ! -s yandex-root-ca.pem ]]; then
  echo "В yandex-ca.pem нет самоподписанного корневого сертификата" >&2
  exit 1
fi
# umask 077 выше закрыл бы файл от пользователя node в контейнере миграций.
chmod 644 yandex-root-ca.pem

# Переменные подстановки в compose.yml — отдельно от окружения контейнеров:
# пароль попадает сюда только в адресе для миграций.
cat >release.env <<EOF
IMAGE_TAG=${TAG}
CADDY_VERSION=${CADDY_VERSION}
UMAMI_VERSION=${UMAMI_VERSION}
MIGRATE_DATABASE_URL=postgresql://${DATABASE}?sslmode=require&sslaccept=strict&sslcert=/etc/streamkit/yandex-root-ca.pem
EOF

compose() {
  docker compose --env-file infra.env --env-file release.env --env-file stats.env "$@"
}

echo "==> Образы ${TAG}"
registry_login

# Хэш пароля stats.<домен> для Caddy. Считается заново только при смене пароля:
# новый хэш на каждой выкатке пересоздавал бы Caddy и рвал соединения оверлеев.
# Значение в одинарных кавычках: в bcrypt-хэше знаки $, и compose иначе принял
# бы их за подстановку переменных.
#
# Рядом — значение cookie-пропуска, который Caddy выдаёт после пароля (см.
# Caddyfile). Оно выводится из пароля: смена пароля гасит выданные пропуски, а
# сам пароль из cookie не восстановить.
STATS_FINGERPRINT=$(printf '%s' "$STATS_PASSWORD" | sha256sum | cut -d' ' -f1)
if [[ ! -f stats.env ]] || ! grep -qx "# ${STATS_FINGERPRINT}" stats.env ||
  ! grep -q '^STATS_GATE_TOKEN=' stats.env; then
  STATS_BASIC_HASH=$(docker run --rm "${REGISTRY}/mirror/caddy:${CADDY_VERSION}" \
    caddy hash-password --plaintext "$STATS_PASSWORD")
  STATS_GATE_TOKEN=$(printf 'stats-gate:%s' "$STATS_PASSWORD" | sha256sum | cut -d' ' -f1)
  printf "# %s\nSTATS_BASIC_HASH='%s'\nSTATS_GATE_TOKEN='%s'\n" \
    "$STATS_FINGERPRINT" "$STATS_BASIC_HASH" "$STATS_GATE_TOKEN" >stats.env
fi
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
