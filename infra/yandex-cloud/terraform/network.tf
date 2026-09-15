resource "yandex_vpc_network" "main" {
  name = "streamkit"
}

resource "yandex_vpc_subnet" "main" {
  name           = "streamkit-${var.zone}"
  zone           = var.zone
  network_id     = yandex_vpc_network.main.id
  v4_cidr_blocks = [var.subnet_cidr]
}

# Адреса статические: на них смотрят DNS-записи и сертификаты, и адрес,
# сменившийся при пересоздании ВМ, означал бы простой до обновления DNS.
resource "yandex_vpc_address" "app" {
  name = "streamkit-app"
  external_ipv4_address {
    zone_id = var.zone
  }
}

# Свой адрес у медиасервера — не экономия, а необходимость. LiveKit сообщает
# браузерам этот адрес для медиа (--node-ip), а TURN занимает на нём порт 443:
# на одном адресе с Caddy он бы не поместился.
resource "yandex_vpc_address" "livekit" {
  name = "streamkit-livekit"
  external_ipv4_address {
    zone_id = var.zone
  }
}

locals {
  app_public_ip     = yandex_vpc_address.app.external_ipv4_address[0].address
  livekit_public_ip = yandex_vpc_address.livekit.external_ipv4_address[0].address

  # Внутренние адреса фиксированы: по ним API ходит в LiveKit, а LiveKit шлёт
  # вебхуки в API, и оба адреса записываются в конфигурацию при создании ВМ.
  app_private_ip     = cidrhost(var.subnet_cidr, 10)
  livekit_private_ip = cidrhost(var.subnet_cidr, 20)
}
