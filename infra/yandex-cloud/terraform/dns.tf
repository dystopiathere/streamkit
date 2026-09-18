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
    # Интерфейс статистики посещений (Umami) за паролем Caddy.
    "stats.${var.domain}." = local.app_public_ip
    # Административная панель, тоже за паролем Caddy.
    "admin.${var.domain}." = local.app_public_ip
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

# Подпись DKIM домена отправителя для Postbox. Адрес создаётся в консоли Postbox
# (../README.md), и консоль показывает запись — её имя и значение переносятся в
# terraform.tfvars. Без подтверждённого домена Postbox писем не отправляет.
#
# Значение записывается строками в кавычках по 255 символов. Без кавычек DNS
# разбирает его как текст зоны, где `;` начинает комментарий: опубликовано было
# одно «v=DKIM1», ключ отброшен, и Postbox двое суток не подтверждал домен. А
# одна строка TXT длиннее 255 символов быть не может, ключ RSA 2048 — около 400.
#
# Имя — всегда полное, с точкой. Консоль Postbox показывает его без точки, а
# Cloud DNS считает такое имя относительным и дописывает зону: запись с верным
# ключом ушла на postbox._domainkey.stream-kit.ru.stream-kit.ru, а по нужному
# адресу Postbox ничего не нашёл.
resource "yandex_dns_recordset" "postbox_dkim" {
  count = var.postbox_dkim == null ? 0 : 1

  zone_id = yandex_dns_zone.main.id
  name    = "${trimsuffix(var.postbox_dkim.name, ".")}."
  type    = "TXT"
  ttl     = 3600
  data = [
    join(" ", [
      for chunk in regexall(".{1,255}", var.postbox_dkim.value) : "\"${chunk}\""
    ])
  ]

  lifecycle {
    # Короткое имя вида «postbox._domainkey» после добавления точки стало бы
    # записью в корне DNS, вне зоны.
    precondition {
      condition     = endswith(trimsuffix(var.postbox_dkim.name, "."), ".${var.domain}")
      error_message = "postbox_dkim.name — полное имя из консоли Postbox, например postbox._domainkey.${var.domain}"
    }
  }
}

# TXT в корне домена: подтверждение владения для Google Search Console, без
# которого Google не публикует OAuth-приложение YouTube («home page URL is not
# registered to you»). Все значения корня — одной записью: Cloud DNS хранит набор
# записей по имени и типу, и вторая такая же запись, заведённая руками в консоли,
# перетёрлась бы при следующем apply.
resource "yandex_dns_recordset" "root_txt" {
  count = length(var.root_txt_records) == 0 ? 0 : 1

  zone_id = yandex_dns_zone.main.id
  name    = "${var.domain}."
  type    = "TXT"
  ttl     = 3600
  # Кавычки обязательны по той же причине, что у DKIM: без них пробел или «;»
  # в значении разбирается как синтаксис зоны.
  data = [for value in var.root_txt_records : "\"${value}\""]
}

# TURN — на своём адресе: он занимает там порт 443.
resource "yandex_dns_recordset" "turn" {
  zone_id = yandex_dns_zone.main.id
  name    = "turn.${var.domain}."
  type    = "A"
  ttl     = 300
  data    = [local.livekit_public_ip]
}
