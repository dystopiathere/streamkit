variable "cloud_id" {
  description = "Идентификатор облака Yandex Cloud"
  type        = string
}

variable "folder_id" {
  description = "Каталог, в котором создаются все ресурсы"
  type        = string
}

variable "zone" {
  description = "Зона доступности. ВМ и хосты баз — в одной зоне: меньше задержка и нет платы за межзональный трафик"
  type        = string
  default     = "ru-central1-a"
}

variable "domain" {
  description = "Домен сайта. Корень — главная и дашборд, поддомены — api, overlay, rtc, turn"
  type        = string
  default     = "stream-kit.ru"
}

variable "acme_email" {
  description = "Почта для Let's Encrypt: туда приходят предупреждения об истекающих сертификатах"
  type        = string
}

variable "subnet_cidr" {
  description = "Подсеть управляемых PostgreSQL и Valkey: адреса хостам раздаёт облако"
  type        = string
  default     = "10.10.0.0/24"
}

variable "vm_subnet_cidr" {
  description = "Подсеть ВМ с фиксированными адресами. По ней разрешён трафик между ВМ приложений и медиасервером"
  type        = string
  default     = "10.10.1.0/24"
}

variable "admin_ssh_cidrs" {
  description = "С каких адресов пускать SSH на ВМ. Пусто — SSH закрыт; GitHub Actions ходит по отдельному правилу"
  type        = list(string)
  default     = []
}

variable "deploy_ssh_cidrs" {
  description = "Адреса, с которых выкатка заходит по SSH. По умолчанию — отовсюду: у раннеров GitHub нет постоянных адресов, защита — ключ"
  type        = list(string)
  default     = ["0.0.0.0/0"]
}

variable "admin_ssh_public_key" {
  description = "Публичный ключ администратора (пользователь admin, sudo)"
  type        = string
}

variable "deploy_ssh_public_key" {
  description = "Публичный ключ выкатки из GitHub Actions (пользователь deploy, только docker)"
  type        = string
}

variable "app_vm" {
  description = "Размер ВМ приложений: api, worker, web, overlay, Caddy"
  type = object({
    cores     = number
    memory_gb = number
    disk_gb   = number
  })
  default = {
    cores     = 2
    memory_gb = 4
    disk_gb   = 30
  }
}

variable "livekit_vm" {
  description = "Размер ВМ медиасервера. Узкое место SFU — канал, а не процессор (docs/adr/0010)"
  type = object({
    cores     = number
    memory_gb = number
    disk_gb   = number
  })
  default = {
    cores     = 2
    memory_gb = 4
    disk_gb   = 20
  }
}

variable "postgresql" {
  description = "Управляемый PostgreSQL. Список классов хостов: yc managed-postgresql resource-preset list"
  type = object({
    resource_preset_id = string
    disk_gb            = number
  })
  default = {
    resource_preset_id = "s3-c2-m8"
    disk_gb            = 20
  }
}

variable "valkey" {
  description = "Управляемый Valkey (совместим с Redis). Список классов хостов: yc managed-redis resource-preset list"
  type = object({
    resource_preset_id = string
    disk_gb            = number
    version            = string
  })
  default = {
    resource_preset_id = "hm3-c2-m8"
    disk_gb            = 16
    # С суффиксом: API отвечает «version not found» на голое "8.1". Допустимые
    # значения — 7.2-valkey, 8.0-valkey, 8.1-valkey, 9.0-valkey.
    version = "8.1-valkey"
  }
}
