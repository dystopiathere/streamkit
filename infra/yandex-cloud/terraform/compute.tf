data "yandex_compute_image" "ubuntu" {
  family = "ubuntu-2404-lts"
}

locals {
  registry = "cr.yandex/${yandex_container_registry.main.id}"
}

resource "yandex_compute_instance" "app" {
  name               = "streamkit-app"
  hostname           = "streamkit-app"
  platform_id        = "standard-v3"
  zone               = var.zone
  service_account_id = yandex_iam_service_account.app_vm.id
  # Пересоздание ВМ из-за правки cloud-init — это простой сайта. Изменения
  # после первого запуска вносит выкатка, а не пересоздание.
  allow_stopping_for_update = true

  resources {
    cores         = var.app_vm.cores
    memory        = var.app_vm.memory_gb
    core_fraction = var.app_vm.core_fraction
  }

  boot_disk {
    initialize_params {
      image_id = data.yandex_compute_image.ubuntu.id
      type     = var.app_vm.disk_type
      size     = var.app_vm.disk_gb
    }
  }

  network_interface {
    subnet_id          = yandex_vpc_subnet.vms.id
    ip_address         = local.app_private_ip
    nat                = true
    nat_ip_address     = local.app_public_ip
    security_group_ids = [yandex_vpc_security_group.app.id]
  }

  metadata = {
    user-data = templatefile("${path.module}/cloud-init/app.yaml.tftpl", {
      admin_ssh_public_key  = var.admin_ssh_public_key
      deploy_ssh_public_key = var.deploy_ssh_public_key
      infra_env = {
        DOMAIN                     = var.domain
        ACME_EMAIL                 = var.acme_email
        REGISTRY                   = local.registry
        APP_PRIVATE_IP             = local.app_private_ip
        LIVEKIT_PRIVATE_IP         = local.livekit_private_ip
        POSTGRES_HOST              = local.postgresql_host
        POSTGRES_USER              = yandex_mdb_postgresql_user.app.name
        POSTGRES_DB                = yandex_mdb_postgresql_database.app.name
        VALKEY_HOST                = local.valkey_host
        LOCKBOX_APP_SECRET_ID      = yandex_lockbox_secret.app.id
        LOCKBOX_LIVEKIT_SECRET_ID  = yandex_lockbox_secret.livekit.id
        LOCKBOX_EXTERNAL_SECRET_ID = yandex_lockbox_secret.external.id
      }
    })
  }

  lifecycle {
    # Новый образ Ubuntu в семействе не повод пересоздавать работающую ВМ.
    ignore_changes = [boot_disk[0].initialize_params[0].image_id, metadata]
  }
}

resource "yandex_compute_instance" "livekit" {
  name                      = "streamkit-livekit"
  hostname                  = "streamkit-livekit"
  platform_id               = "standard-v3"
  zone                      = var.zone
  service_account_id        = yandex_iam_service_account.livekit_vm.id
  allow_stopping_for_update = true

  resources {
    cores         = var.livekit_vm.cores
    memory        = var.livekit_vm.memory_gb
    core_fraction = var.livekit_vm.core_fraction
  }

  boot_disk {
    initialize_params {
      image_id = data.yandex_compute_image.ubuntu.id
      type     = var.livekit_vm.disk_type
      size     = var.livekit_vm.disk_gb
    }
  }

  network_interface {
    subnet_id          = yandex_vpc_subnet.vms.id
    ip_address         = local.livekit_private_ip
    nat                = true
    nat_ip_address     = local.livekit_public_ip
    security_group_ids = [yandex_vpc_security_group.livekit.id]
  }

  metadata = {
    user-data = templatefile("${path.module}/cloud-init/livekit.yaml.tftpl", {
      admin_ssh_public_key  = var.admin_ssh_public_key
      deploy_ssh_public_key = var.deploy_ssh_public_key
      infra_env = {
        DOMAIN                    = var.domain
        ACME_EMAIL                = var.acme_email
        REGISTRY                  = local.registry
        LIVEKIT_PUBLIC_IP         = local.livekit_public_ip
        APP_PRIVATE_IP            = local.app_private_ip
        LOCKBOX_LIVEKIT_SECRET_ID = yandex_lockbox_secret.livekit.id
      }
    })
  }

  lifecycle {
    ignore_changes = [boot_disk[0].initialize_params[0].image_id, metadata]
  }
}
