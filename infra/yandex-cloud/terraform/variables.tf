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
  description = "Публичный ключ администратора (пользователь ops, sudo)"
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

variable "root_txt_records" {
  description = "Значения TXT в корне домена: google-site-verification=... из Google Search Console, yandex-verification: ... из Яндекс 360, SPF (одна запись v=spf1 на домен). Пусто — записи нет"
  type        = list(string)
  default     = []

  validation {
    condition     = alltrue([for v in var.root_txt_records : !strcontains(v, "\"") && length(v) > 0 && length(v) <= 255])
    error_message = "root_txt_records — значения как их показывает Google, без кавычек и не длиннее 255 символов."
  }
}

variable "postbox_dkim" {
  description = "Запись DKIM из консоли Postbox для домена отправителя: полное имя (точку в конце dns.tf добавит сам) и значение TXT. null — запись ещё не заведена"
  type = object({
    name  = string
    value = string
  })
  default = null

  # Значение — как показывает консоль, одной строкой и без кавычек: кавычки и
  # разбиение на части добавляет dns.tf.
  validation {
    condition     = var.postbox_dkim == null || (!strcontains(var.postbox_dkim.value, "\"") && startswith(var.postbox_dkim.value, "v=DKIM1"))
    error_message = "postbox_dkim.value — строка из консоли Postbox вида v=DKIM1;...;p=..., без кавычек."
  }
}

variable "dmarc" {
  description = "Значение DMARC для _dmarc.<домен>, например v=DMARC1; p=none; rua=mailto:dmarc@stream-kit.ru. null — записи нет"
  type        = string
  default     = null

  # try, а не голое «||»: при null правая часть не должна вычисляться вовсе,
  # а startswith и strcontains на null падают, а не возвращают false.
  validation {
    condition     = var.dmarc == null || try(!strcontains(var.dmarc, "\"") && startswith(var.dmarc, "v=DMARC1;") && length(var.dmarc) <= 255, false)
    error_message = "dmarc — строка вида v=DMARC1; p=none; rua=mailto:..., без кавычек и не длиннее 255 символов."
  }
}

variable "yandex_dkim" {
  description = "Запись DKIM Yandex 360 для почты: полное имя (точку в конце dns.tf добавит сам) и значение TXT. null — запись ещё не заведена"
  type = object({
    name  = string
    value = string
  })
  default = null

  validation {
    condition     = var.yandex_dkim == null || (!strcontains(var.yandex_dkim.value, "\"") && startswith(var.yandex_dkim.value, "v=DKIM1"))
    error_message = "yandex_dkim.value — строка Yandex 360 вида v=DKIM1;...;p=..., без кавычек."
  }
}
