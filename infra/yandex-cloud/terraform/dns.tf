# Публичная зона. У регистратора домена NS-серверы меняются на
# ns1.yandexcloud.net и ns2.yandexcloud.net — без этого записи ниже никто не
# увидит, и Let's Encrypt не выпустит сертификаты.
resource "yandex_dns_zone" "main" {
  name   = replace(var.domain, ".", "-")
  zone   = "${var.domain}."
  public = true
}

locals {
  # Всё, что отдаёт Caddy на ВМ приложений. Сигнализация LiveKit (rtc) тоже
  # здесь: Caddy проксирует её с TLS на внутренний адрес медиасервера.
  app_records = {
    "${var.domain}."         = local.app_public_ip
    "www.${var.domain}."     = local.app_public_ip
    "api.${var.domain}."     = local.app_public_ip
    "overlay.${var.domain}." = local.app_public_ip
    "rtc.${var.domain}."     = local.app_public_ip
  }
}

resource "yandex_dns_recordset" "app" {
  for_each = local.app_records

  zone_id = yandex_dns_zone.main.id
  name    = each.key
  type    = "A"
  ttl     = 300
  data    = [each.value]
}

# TURN — на своём адресе: он занимает там порт 443.
resource "yandex_dns_recordset" "turn" {
  zone_id = yandex_dns_zone.main.id
  name    = "turn.${var.domain}."
  type    = "A"
  ttl     = 300
  data    = [local.livekit_public_ip]
}
