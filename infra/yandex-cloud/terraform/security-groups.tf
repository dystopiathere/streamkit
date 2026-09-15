# Группы безопасности ссылаются друг на друга подсетью, а не идентификатором:
# ВМ приложений и медиасервер ходят друг к другу в обе стороны (API → LiveKit на
# 7880, LiveKit → вебхук API на 3000), и взаимные ссылки на группы замкнулись бы
# в цикл зависимостей Terraform.

resource "yandex_vpc_security_group" "app" {
  name       = "streamkit-app"
  network_id = yandex_vpc_network.main.id

  ingress {
    description    = "HTTP: выпуск сертификатов Let's Encrypt и редирект на HTTPS"
    protocol       = "TCP"
    port           = 80
    v4_cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    description    = "HTTPS: сайт, API, оверлей, сигнализация LiveKit"
    protocol       = "TCP"
    port           = 443
    v4_cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    description    = "Вебхуки LiveKit в API — только из внутренней подсети"
    protocol       = "TCP"
    port           = 3000
    v4_cidr_blocks = [var.vm_subnet_cidr]
  }

  dynamic "ingress" {
    for_each = length(concat(var.admin_ssh_cidrs, var.deploy_ssh_cidrs)) > 0 ? [1] : []
    content {
      description    = "SSH: администратор и выкатка"
      protocol       = "TCP"
      port           = 22
      v4_cidr_blocks = distinct(concat(var.admin_ssh_cidrs, var.deploy_ssh_cidrs))
    }
  }

  egress {
    description    = "Исходящий: базы, реестр, ЮKassa, площадки, Let's Encrypt"
    protocol       = "ANY"
    from_port      = 0
    to_port        = 65535
    v4_cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "yandex_vpc_security_group" "livekit" {
  name       = "streamkit-livekit"
  network_id = yandex_vpc_network.main.id

  ingress {
    description    = "HTTP: выпуск сертификата turn.<домен> через Let's Encrypt"
    protocol       = "TCP"
    port           = 80
    v4_cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    description    = "TURN/TLS на 443: гости из сетей, где закрыто всё, кроме HTTPS"
    protocol       = "TCP"
    port           = 443
    v4_cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    description    = "Медиа по TCP — запасной путь, когда UDP закрыт"
    protocol       = "TCP"
    port           = 7881
    v4_cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    description    = "Медиа по UDP — основной путь"
    protocol       = "UDP"
    port           = 7882
    v4_cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    description    = "Сигнализация и серверный API LiveKit — только изнутри: наружу его отдаёт Caddy с TLS"
    protocol       = "TCP"
    port           = 7880
    v4_cidr_blocks = [var.vm_subnet_cidr]
  }

  dynamic "ingress" {
    for_each = length(concat(var.admin_ssh_cidrs, var.deploy_ssh_cidrs)) > 0 ? [1] : []
    content {
      description    = "SSH: администратор и выкатка"
      protocol       = "TCP"
      port           = 22
      v4_cidr_blocks = distinct(concat(var.admin_ssh_cidrs, var.deploy_ssh_cidrs))
    }
  }

  egress {
    description    = "Исходящий: вебхуки в API, реестр, Let's Encrypt, медиа участникам"
    protocol       = "ANY"
    from_port      = 0
    to_port        = 65535
    v4_cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "yandex_vpc_security_group" "databases" {
  name       = "streamkit-databases"
  network_id = yandex_vpc_network.main.id

  ingress {
    description       = "PostgreSQL — только с ВМ приложений"
    protocol          = "TCP"
    port              = 6432
    security_group_id = yandex_vpc_security_group.app.id
  }

  ingress {
    description       = "Valkey по TLS — только с ВМ приложений"
    protocol          = "TCP"
    port              = 6380
    security_group_id = yandex_vpc_security_group.app.id
  }
}
