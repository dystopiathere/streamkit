#!/usr/bin/env bash
# Продление сертификата TURN по расписанию (cron ставит deploy.sh).
set -euo pipefail

cd "$(dirname "$0")"
# shellcheck source-path=SCRIPTDIR/../lib
source ./lockbox.sh
# shellcheck disable=SC1091
set -a && source ./infra.env && set +a

LEGO_VERSION=v4.21.0
TURN_DOMAIN="turn.${DOMAIN}"
CERT="lego/certificates/${TURN_DOMAIN}.crt"

before=$(sha256sum "$CERT" | cut -d' ' -f1)

registry_login
docker run --rm -p 80:80 -v "$PWD/lego:/data" \
  "${REGISTRY}/mirror/lego:${LEGO_VERSION}" \
  --accept-tos --email "$ACME_EMAIL" --domains "$TURN_DOMAIN" --http --path /data \
  renew --days 30

after=$(sha256sum "$CERT" | cut -d' ' -f1)
if [[ $before != "$after" ]]; then
  echo "$(date -u +%FT%TZ) сертификат обновлён, перезапуск LiveKit"
  docker compose --env-file infra.env --env-file release.env restart livekit
else
  echo "$(date -u +%FT%TZ) продлевать рано"
fi
