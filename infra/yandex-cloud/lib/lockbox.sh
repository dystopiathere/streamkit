#!/usr/bin/env bash
# Общие функции выкатки: токен сервисного аккаунта ВМ и секреты из Lockbox.
#
# Статических ключей на ВМ нет: токен выдаёт сервис метаданных, а права —
# сервисный аккаунт, привязанный к ВМ в Terraform. Секреты не лежат ни в GitHub,
# ни в образах. Но любой, у кого есть оболочка на ВМ, получит тот же токен:
# доступ к серверу — это доступ к секретам, и ключ выкатки хранится как секрет.

set -euo pipefail

# IAM-токен сервисного аккаунта ВМ. Живёт до 12 часов — берётся на каждую выкатку.
iam_token() {
  curl -fsS -H 'Metadata-Flavor: Google' \
    'http://169.254.169.254/computeMetadata/v1/instance/service-accounts/default/token' |
    jq -r '.access_token'
}

# Вход в Container Registry тем же токеном: реестр принимает его как пароль
# пользователя «iam».
registry_login() {
  iam_token | docker login --username iam --password-stdin cr.yandex >/dev/null
}

# Содержимое секрета Lockbox строками KEY='value'.
#
# Значения в одинарных кавычках: docker compose читает их буквально, а реквизит
# вида «Иванов Иван Иванович» без кавычек разъехался бы по пробелам. Значение с
# переводом строки или одинарной кавычкой не записывается вовсе — такой .env
# распарсился бы молча не так, как задумано.
lockbox_env() {
  local secret_id=$1
  local token
  token=$(iam_token)
  curl -fsS -H "Authorization: Bearer ${token}" \
    "https://payload.lockbox.api.cloud.yandex.net/lockbox/v1/secrets/${secret_id}/payload" |
    jq -r '.entries[] | "\(.key)\t\(.textValue // "")"' |
    while IFS=$'\t' read -r key value; do
      if [[ ! $key =~ ^[A-Z][A-Z0-9_]*$ ]]; then
        echo "Lockbox ${secret_id}: ключ «${key}» не похож на имя переменной" >&2
        exit 1
      fi
      if [[ $value == *"'"* ]]; then
        echo "Lockbox ${secret_id}: значение ${key} содержит одинарную кавычку" >&2
        exit 1
      fi
      printf "%s='%s'\n" "$key" "$value"
    done
}

# Значение одной переменной из только что собранного файла окружения.
env_value() {
  local file=$1 key=$2
  sed -n "s/^${key}='\(.*\)'$/\1/p" "$file" | tail -n 1
}
