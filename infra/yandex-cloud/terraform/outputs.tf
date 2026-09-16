output "app_public_ip" {
  description = "Адрес ВМ приложений — переменная APP_HOST в окружении production на GitHub"
  value       = local.app_public_ip
}

output "livekit_public_ip" {
  description = "Адрес ВМ медиасервера — переменная LIVEKIT_HOST в окружении production на GitHub"
  value       = local.livekit_public_ip
}

output "registry" {
  description = "Префикс образов — переменная YC_REGISTRY в окружении production на GitHub"
  value       = local.registry
}

output "ci_pusher_service_account_id" {
  description = "Для ключа публикации образов: yc iam key create --service-account-id <это> -o key.json"
  value       = yandex_iam_service_account.ci_pusher.id
}

output "external_secret_id" {
  description = "Секрет, в который владелец заводит ЮKassa, ключи площадок и реквизиты"
  value       = yandex_lockbox_secret.external.id
}

output "app_secret_id" {
  description = "Сгенерированные секреты приложения, в том числе пароль stats.<домен> (STATS_PASSWORD)"
  value       = yandex_lockbox_secret.app.id
}

output "dns_name_servers" {
  description = "NS-серверы, которые нужно указать у регистратора домена"
  value       = ["ns1.yandexcloud.net.", "ns2.yandexcloud.net."]
}
