terraform {
  required_version = ">= 1.6"

  required_providers {
    yandex = {
      source  = "yandex-cloud/yandex"
      version = ">= 0.140"
    }
    random = {
      source  = "hashicorp/random"
      version = ">= 3.6"
    }
  }

  # Состояние — в бакете Object Storage, а не на ноутбуке: в нём сгенерированные
  # секреты приложения, и терять или раздавать его нельзя. Бакет, ключи доступа
  # и имя файла задаются при init: terraform init -backend-config=backend.hcl
  # (образец — backend.hcl.example, порядок — ../README.md).
  backend "s3" {
    endpoints = {
      s3 = "https://storage.yandexcloud.net"
    }
    region = "ru-central1"

    skip_region_validation      = true
    skip_credentials_validation = true
    skip_requesting_account_id  = true
    skip_s3_checksum            = true
  }
}

provider "yandex" {
  cloud_id  = var.cloud_id
  folder_id = var.folder_id
  zone      = var.zone
  # Авторизация — переменной окружения YC_TOKEN или YC_SERVICE_ACCOUNT_KEY_FILE,
  # не в коде и не в tfvars.
}
