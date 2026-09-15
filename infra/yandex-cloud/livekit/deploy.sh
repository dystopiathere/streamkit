#!/usr/bin/env bash
# Выкатка медиасервера: ./deploy.sh
#
# Тег выпуска LiveKit не нужен: версия сервера зафиксирована здесь и меняется
# коммитом, а не каждым выпуском приложения.
set -euo pipefail

cd "$(dirname "$0")"
# shellcheck source-path=SCRIPTDIR/../lib
source ./lockbox.sh
# shellcheck disable=SC1091
set -a && source ./infra.env && set +a

# Версии сторонних образов: те же, что зеркалирует выпуск (release.yml).
LIVEKIT_VERSION=v1.13.6
LEGO_VERSION=v4.21.0
TURN_DOMAIN="turn.${DOMAIN}"

compose() {
  docker compose --env-file infra.env --env-file release.env "$@"
}

echo "==> Образы"
registry_login
cat >release.env <<EOF
LIVEKIT_VERSION=${LIVEKIT_VERSION}
EOF
compose pull --quiet
docker pull --quiet "${REGISTRY}/mirror/lego:${LEGO_VERSION}" >/dev/null

echo "==> Сертификат ${TURN_DOMAIN}"
# TURN на 443 держит TLS сам, и сертификат ему нужен файлом. Выпускает его lego
# по HTTP на 80-м порту: на этой ВМ его больше никто не занимает.
lego() {
  docker run --rm -p 80:80 -v "$PWD/lego:/data" \
    "${REGISTRY}/mirror/lego:${LEGO_VERSION}" \
    --accept-tos --email "$ACME_EMAIL" --domains "$TURN_DOMAIN" --http --path /data "$@"
}
if [[ -f "lego/certificates/${TURN_DOMAIN}.crt" ]]; then
  lego renew --days 30
else
  lego run
fi

echo "==> Окружение из Lockbox"
umask 077
lockbox_env "$LOCKBOX_LIVEKIT_SECRET_ID" >.env.next
LIVEKIT_API_KEY=$(env_value .env.next LIVEKIT_API_KEY)
LIVEKIT_API_SECRET=$(env_value .env.next LIVEKIT_API_SECRET)

# Конфигурация целиком в LIVEKIT_CONFIG: файл LiveKit не шаблонизирует, а ключ
# вебхука берётся по имени из окружения (infra/livekit/README.md).
{
  echo "LIVEKIT_CONFIG='"
  cat <<EOF
port: 7880
keys:
  ${LIVEKIT_API_KEY}: ${LIVEKIT_API_SECRET}
rtc:
  tcp_port: 7881
  udp_port: 7882
  use_external_ip: false
room:
  max_participants: 20
  empty_timeout: 300
turn:
  # Гости из корпоративных сетей и части мобильных операторов проходят только
  # по TLS на 443: без TURN они «входят» и остаются без медиа.
  enabled: true
  domain: ${TURN_DOMAIN}
  tls_port: 443
  cert_file: /certs/${TURN_DOMAIN}.crt
  key_file: /certs/${TURN_DOMAIN}.key
webhook:
  # Внутренний адрес API: проверка входа в комнату не должна зависеть от
  # сертификатов и публичного DNS. Без вебхука отозванный гость входит обратно.
  api_key: ${LIVEKIT_API_KEY}
  urls:
    - http://${APP_PRIVATE_IP}:3000/api/livekit/webhook
logging:
  level: info
EOF
  echo "'"
} >.env
rm -f .env.next

echo "==> Запуск"
compose up -d --remove-orphans

echo "==> Продление сертификата по расписанию"
# Раз в неделю ночью: lego продлевает за 30 дней до конца и перезапускает
# LiveKit, только если сертификат обновился — сервер читает его при старте.
# Перезапуск рвёт идущие созвоны, поэтому ночь и поэтому не чаще раза в два месяца.
CRON_LINE="17 0 * * 1 cd $PWD && ./renew-cert.sh >>renew-cert.log 2>&1"
(crontab -l 2>/dev/null | grep -v 'renew-cert.sh' || true; echo "$CRON_LINE") | crontab -

echo "==> Ожидание LiveKit"
for attempt in $(seq 1 30); do
  if curl -fsS http://127.0.0.1:7880/ >/dev/null 2>&1; then
    echo "LiveKit отвечает (попытка ${attempt})"
    exit 0
  fi
  sleep 2
done
echo "LiveKit не ответил за минуту" >&2
compose logs --tail 80 livekit
exit 1
