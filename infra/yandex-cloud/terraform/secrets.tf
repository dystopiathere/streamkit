# Секреты приложения живут в Lockbox, а не в GitHub и не в образах. ВМ читает
# их при каждой выкатке своим сервисным аккаунтом (app/deploy.sh).
#
# Три секрета — по тому, кто их читает и кто их заводит:
# - streamkit-app      — генерирует Terraform, читает ВМ приложений;
# - streamkit-livekit  — генерирует Terraform, читают обе ВМ;
# - streamkit-external — заводит владелец руками (ЮKassa, площадки, реквизиты):
#   Terraform создаёт только сам секрет, значения в его состояние не попадают.
#
# Сгенерированные значения лежат и в состоянии Terraform — поэтому состояние в
# закрытом бакете, а не в репозитории и не на ноутбуке.

resource "random_password" "jwt_secret" {
  length  = 64
  special = false
}

resource "random_id" "encryption_key" {
  # Ровно 32 байта в base64 — иначе API не стартует (config/env.ts).
  byte_length = 32
}

resource "random_password" "ip_hash_pepper" {
  length  = 32
  special = false
}

resource "random_password" "token_hash_pepper" {
  length  = 32
  special = false
}

resource "random_password" "livekit_api_key" {
  length  = 16
  special = false
}

resource "random_password" "livekit_api_secret" {
  # LiveKit без --dev не стартует с секретом короче 32 символов.
  length  = 48
  special = false
}

resource "yandex_lockbox_secret" "app" {
  name        = "streamkit-app"
  description = "Сгенерированные секреты приложения"
}

resource "yandex_lockbox_secret_version" "app" {
  secret_id = yandex_lockbox_secret.app.id

  entries {
    key        = "JWT_SECRET"
    text_value = random_password.jwt_secret.result
  }
  entries {
    key        = "ENCRYPTION_KEY"
    text_value = random_id.encryption_key.b64_std
  }
  entries {
    key        = "IP_HASH_PEPPER"
    text_value = random_password.ip_hash_pepper.result
  }
  entries {
    key        = "TOKEN_HASH_PEPPER"
    text_value = random_password.token_hash_pepper.result
  }
  entries {
    key        = "POSTGRES_PASSWORD"
    text_value = random_password.postgresql.result
  }
  entries {
    key        = "VALKEY_PASSWORD"
    text_value = random_password.valkey.result
  }
  # SMTP Postbox: логин — идентификатор API-ключа, пароль — его секрет.
  entries {
    key        = "SMTP_USER"
    text_value = yandex_iam_service_account_api_key.mail_sender.id
  }
  entries {
    key        = "SMTP_PASSWORD"
    text_value = yandex_iam_service_account_api_key.mail_sender.secret_key
  }
}

resource "yandex_lockbox_secret" "livekit" {
  name        = "streamkit-livekit"
  description = "Ключ и секрет LiveKit: подписывают токены комнат и вебхуки"
}

resource "yandex_lockbox_secret_version" "livekit" {
  secret_id = yandex_lockbox_secret.livekit.id

  entries {
    key        = "LIVEKIT_API_KEY"
    text_value = "streamkit${random_password.livekit_api_key.result}"
  }
  entries {
    key        = "LIVEKIT_API_SECRET"
    text_value = random_password.livekit_api_secret.result
  }
}

resource "yandex_lockbox_secret" "external" {
  name        = "streamkit-external"
  description = "Заводится владельцем: YOOKASSA_*, TWITCH_*, YOUTUBE_*, SELLER_*"
}

resource "yandex_lockbox_secret_iam_binding" "app_viewers" {
  secret_id = yandex_lockbox_secret.app.id
  role      = "lockbox.payloadViewer"
  members   = ["serviceAccount:${yandex_iam_service_account.app_vm.id}"]
}

resource "yandex_lockbox_secret_iam_binding" "external_viewers" {
  secret_id = yandex_lockbox_secret.external.id
  role      = "lockbox.payloadViewer"
  members   = ["serviceAccount:${yandex_iam_service_account.app_vm.id}"]
}

resource "yandex_lockbox_secret_iam_binding" "livekit_viewers" {
  secret_id = yandex_lockbox_secret.livekit.id
  role      = "lockbox.payloadViewer"
  members = [
    "serviceAccount:${yandex_iam_service_account.app_vm.id}",
    "serviceAccount:${yandex_iam_service_account.livekit_vm.id}",
  ]
}
