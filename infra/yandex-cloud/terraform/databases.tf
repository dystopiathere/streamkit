# Пароли — без спецсимволов: они подставляются в DATABASE_URL и REDIS_URL, а
# символ из набора «@:/?#» в пароле ломает разбор адреса молча — приложение
# стучится не туда. Длина компенсирует алфавит.
resource "random_password" "postgresql" {
  length  = 40
  special = false
}

resource "random_password" "valkey" {
  length  = 40
  special = false
}

resource "yandex_mdb_postgresql_cluster" "main" {
  name                = "streamkit"
  environment         = "PRODUCTION"
  network_id          = yandex_vpc_network.main.id
  security_group_ids  = [yandex_vpc_security_group.databases.id]
  deletion_protection = true

  config {
    version = "17"
    resources {
      resource_preset_id = var.postgresql.resource_preset_id
      disk_type_id       = "network-ssd"
      disk_size          = var.postgresql.disk_gb
    }

    # Резервная копия в 03:00 по Москве (время здесь — UTC), когда стримов
    # меньше всего.
    backup_window_start {
      hours   = 0
      minutes = 0
    }
  }

  host {
    zone      = var.zone
    subnet_id = yandex_vpc_subnet.main.id
    # Наружу база не смотрит: подключаются только ВМ приложений изнутри сети.
    assign_public_ip = false
  }
}

resource "yandex_mdb_postgresql_user" "app" {
  cluster_id = yandex_mdb_postgresql_cluster.main.id
  name       = "streamkit"
  password   = random_password.postgresql.result
}

resource "yandex_mdb_postgresql_database" "app" {
  cluster_id = yandex_mdb_postgresql_cluster.main.id
  name       = "streamkit"
  owner      = yandex_mdb_postgresql_user.app.name
}

# Статистика посещений (Umami) — своя база и свой пользователь в том же
# кластере. Отдельный пользователь не видит базу приложения: утечка ключей
# Umami не даёт доступа к учётным записям и платежам.
resource "random_password" "umami_db" {
  length  = 40
  special = false
}

resource "yandex_mdb_postgresql_user" "umami" {
  cluster_id = yandex_mdb_postgresql_cluster.main.id
  name       = "umami"
  password   = random_password.umami_db.result
}

resource "yandex_mdb_postgresql_database" "umami" {
  cluster_id = yandex_mdb_postgresql_cluster.main.id
  name       = "umami"
  owner      = yandex_mdb_postgresql_user.umami.name
}

# Valkey — управляемый Redis-совместимый кластер. Приложению нужны обычные
# команды, pub/sub (шина реального времени) и блокировки; всё это Valkey держит.
resource "yandex_mdb_redis_cluster" "main" {
  name                = "streamkit"
  environment         = "PRODUCTION"
  network_id          = yandex_vpc_network.main.id
  security_group_ids  = [yandex_vpc_security_group.databases.id]
  deletion_protection = true
  tls_enabled         = true
  # Счётчики лимитов запросов и ключи дедупликации событий переживают
  # перезапуск: без этого рестарт кластера пропустил бы дубль доната в эфир.
  persistence_mode = "ON"

  config {
    password = random_password.valkey.result
    version  = var.valkey.version
  }

  resources {
    resource_preset_id = var.valkey.resource_preset_id
    disk_type_id       = "network-ssd"
    disk_size          = var.valkey.disk_gb
  }

  host {
    zone      = var.zone
    subnet_id = yandex_vpc_subnet.main.id
  }
}

locals {
  # Особые имена «текущий мастер»: указывают на хост-мастер и после
  # переключения, в отличие от имён конкретных хостов.
  postgresql_host = "c-${yandex_mdb_postgresql_cluster.main.id}.rw.mdb.yandexcloud.net"
  valkey_host     = "c-${yandex_mdb_redis_cluster.main.id}.rw.mdb.yandexcloud.net"
}
