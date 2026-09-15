resource "yandex_container_registry" "main" {
  name = "streamkit"
}

# Сервисный аккаунт ВМ приложений: скачивает образы и читает секреты
# приложения. Ключей у него нет вовсе — ВМ получает токен из метаданных.
resource "yandex_iam_service_account" "app_vm" {
  name        = "streamkit-app-vm"
  description = "ВМ приложений: образы из реестра и секреты из Lockbox"
}

# Сервисный аккаунт медиасервера: только его образ и только ключи LiveKit.
# Пароли баз ему не нужны, и читать их он не может.
resource "yandex_iam_service_account" "livekit_vm" {
  name        = "streamkit-livekit-vm"
  description = "ВМ LiveKit: образы из реестра и ключи LiveKit из Lockbox"
}

# Публикация образов из GitHub Actions. Ключ для неё создаётся командой yc
# (../README.md), а не здесь: созданный Terraform ключ лёг бы в состояние.
resource "yandex_iam_service_account" "ci_pusher" {
  name        = "streamkit-ci-pusher"
  description = "GitHub Actions: публикация образов в реестр"
}

# Отправка писем через Postbox. Отдельный аккаунт с одной ролью: утёкший ключ
# SMTP даёт только слать письма с подтверждённого домена, но не образы и не
# секреты. Ключ создаётся здесь, а не командой yc, как у ci_pusher: он нужен ВМ,
# а не GitHub, и попадает в Lockbox вместе с остальными секретами приложения.
resource "yandex_iam_service_account" "mail_sender" {
  name        = "streamkit-mail"
  description = "Postbox: письма о списании за подписку"
}

resource "yandex_resourcemanager_folder_iam_member" "mail_sender" {
  folder_id = var.folder_id
  role      = "postbox.sender"
  member    = "serviceAccount:${yandex_iam_service_account.mail_sender.id}"
}

resource "yandex_iam_service_account_api_key" "mail_sender" {
  service_account_id = yandex_iam_service_account.mail_sender.id
  description        = "SMTP Postbox для API и воркера"
  # Ключ годен только для отправки писем, даже если роль когда-нибудь расширят.
  scopes = ["yc.postbox.send"]
}

resource "yandex_container_registry_iam_binding" "pullers" {
  registry_id = yandex_container_registry.main.id
  role        = "container-registry.images.puller"
  members = [
    "serviceAccount:${yandex_iam_service_account.app_vm.id}",
    "serviceAccount:${yandex_iam_service_account.livekit_vm.id}",
  ]
}

resource "yandex_container_registry_iam_binding" "pushers" {
  registry_id = yandex_container_registry.main.id
  role        = "container-registry.images.pusher"
  members     = ["serviceAccount:${yandex_iam_service_account.ci_pusher.id}"]
}
