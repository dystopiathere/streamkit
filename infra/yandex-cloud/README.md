# Прод в Yandex Cloud: stream-kit.ru

Как устроено и почему — `docs/adr/0012-yandex-cloud-deploy.md`. Здесь — что
сделать руками и в каком порядке.

```
                         ┌──────────────── ВМ streamkit-app ────────────────┐
stream-kit.ru ─┐         │ Caddy (TLS) ─┬─ web       (дашборд, главная)     │
overlay.       ├─ :443 ─▶│              ├─ overlay   (браузер-сорс OBS)     │
api.           │         │              ├─ api ×1 ── worker                 │
rtc. ──────────┘         │              └─ rtc → LiveKit :7880 (внутр.)     │
                         └────────┬──────────────────────┬──────────────────┘
                                  │ 6432 TLS             │ 6380 TLS
                        Managed PostgreSQL 17     Managed Valkey 8.1
                         ┌──────────────── ВМ streamkit-livekit ────────────┐
turn. ── :443 TURN/TLS ─▶│ LiveKit (сеть хоста): 7881/tcp, 7882/udp медиа   │
                         │ вебхуки → api по внутреннему адресу :3000        │
                         └──────────────────────────────────────────────────┘
Container Registry (образы и зеркала), Lockbox (секреты), Cloud DNS (зона)
```

## 1. Подготовка — один раз

Нужны `yc` CLI и Terraform 1.6+. Реестр провайдеров HashiCorp из РФ открывается
не всегда — зеркало Yandex Cloud в `~/.terraformrc`:

```hcl
provider_installation {
  network_mirror {
    url     = "https://terraform-mirror.yandexcloud.net/"
    include = ["registry.terraform.io/*/*"]
  }
  direct {
    exclude = ["registry.terraform.io/*/*"]
  }
}
```

Сервисный аккаунт для Terraform и бакет для состояния. Роль `admin` на каталог
нужна потому, что Terraform сам назначает роли сервисным аккаунтам ВМ; меньшая
этого не позволит.

```bash
yc iam service-account create --name terraform
yc resource-manager folder add-access-binding <folder_id> --role admin --subject serviceAccount:<id terraform>
yc iam key create --service-account-name terraform -o ~/.yc/terraform-key.json
yc storage bucket create --name streamkit-terraform-state
yc iam access-key create --service-account-name terraform
```

Ключи SSH: администратора (свой) и выкатки (отдельный, только для GitHub).

```bash
ssh-keygen -t ed25519 -f ~/.ssh/streamkit-deploy -C github-actions-deploy
```

## 2. Облако

```bash
cd infra/yandex-cloud/terraform
cp terraform.tfvars.example terraform.tfvars   # идентификаторы, почта, ключи SSH
cp backend.hcl.example backend.hcl
export YC_SERVICE_ACCOUNT_KEY_FILE=~/.yc/terraform-key.json
export AWS_ACCESS_KEY_ID=<из access-key create> AWS_SECRET_ACCESS_KEY=<оттуда же>
terraform init -backend-config=backend.hcl
terraform apply
```

Создание кластеров баз занимает 10–20 минут. `terraform.tfvars` и `backend.hcl`
в `.gitignore`; в состоянии Terraform — сгенерированные секреты, поэтому бакет
закрыт и доступ к нему только у сервисного аккаунта `terraform`.

Классы хостов по умолчанию (`s3-c2-m8`, `hm3-c2-m8`) — проверьте доступность в
каталоге: `yc managed-postgresql resource-preset list`, `yc managed-redis
resource-preset list`.

## 3. Домен

У регистратора stream-kit.ru замените NS-серверы на `ns1.yandexcloud.net` и
`ns2.yandexcloud.net`. Пока делегирование не разошлось (`dig NS stream-kit.ru`),
Caddy и lego не выпустят сертификаты — первую выкатку делайте после.

## 4. Секреты, которые заводите вы

Terraform создал пустой секрет `streamkit-external` (`terraform output
external_secret_id`). Значения — без одинарных кавычек и переводов строки,
иначе выкатка остановится с ошибкой:

```bash
yc lockbox secret add-version --id <external_secret_id> --payload '[
  {"key": "SELLER_NAME",         "text_value": "Иванов Иван Иванович"},
  {"key": "SELLER_INN",          "text_value": "123456789012"},
  {"key": "SELLER_EMAIL",        "text_value": "support@stream-kit.ru"},
  {"key": "YOOKASSA_SHOP_ID",    "text_value": "..."},
  {"key": "YOOKASSA_SECRET_KEY", "text_value": "..."},
  {"key": "YOOKASSA_RECEIPTS",   "text_value": "none"},
  {"key": "TWITCH_CLIENT_ID",    "text_value": "..."},
  {"key": "TWITCH_CLIENT_SECRET","text_value": "..."},
  {"key": "YOUTUBE_CLIENT_ID",   "text_value": "..."},
  {"key": "YOUTUBE_CLIENT_SECRET","text_value": "..."}
]'
```

Ключи ЮKassa можно добавить позже: без них оплата не настроена, а комнаты
бесплатны. Реквизиты продавца нужны сразу — их проверяет модерация ЮKassa, и без
них выкатка не пройдёт последнюю проверку. Новая версия секрета применяется
следующей выкаткой.

### Почта (Postbox)

Письмо о предстоящем списании за подписку уходит за три дня, и без него
продление не списывается (п. 5 оферты). Сервисный аккаунт с ролью
`postbox.sender` и API-ключ для SMTP создаёт Terraform и кладёт ключ в секрет
приложения. Домен отправителя подтверждаете вы:

1. Консоль → Postbox → «Создать адрес»: домен `stream-kit.ru`, селектор
   `postbox`, приватный ключ DKIM (консоль подскажет команду `openssl` для его
   выпуска; ключ храните вне репозитория).
2. Консоль покажет TXT-запись. Перенесите имя и значение в `terraform.tfvars`
   (`postbox_dkim`, пример — в `terraform.tfvars.example`) и выполните
   `terraform apply`.
3. Дождитесь статуса «подтверждён» у адреса в Postbox.

До подтверждения письма не уходят, и воркер пишет об этом в лог.

## 5. GitHub

**Репозиторий → Settings → Secrets and variables → Actions:**

| Тип | Имя | Значение |
|---|---|---|
| Secret | `YC_REGISTRY_KEY` | содержимое файла из `yc iam key create --service-account-id $(terraform output -raw ci_pusher_service_account_id) -o registry-key.json` |
| Variable | `YC_REGISTRY` | `terraform output -raw registry` |
| Variable | `PUBLIC_API_URL` | `https://api.stream-kit.ru` |

**Settings → Environments → `production`** (там же — обязательное подтверждение
выкатки, если нужно):

| Тип | Имя | Значение |
|---|---|---|
| Secret | `DEPLOY_SSH_KEY` | закрытый ключ `~/.ssh/streamkit-deploy` |
| Secret | `DEPLOY_KNOWN_HOSTS` | отпечатки обеих ВМ, см. ниже |
| Variable | `APP_HOST` | `terraform output -raw app_public_ip` |
| Variable | `LIVEKIT_HOST` | `terraform output -raw livekit_public_ip` |
| Variable | `DOMAIN` | `stream-kit.ru` |

Отпечатки берутся из консоли ВМ, а не доверием первому подключению — иначе
подменённый адрес получил бы секреты:

```bash
yc compute instance get-serial-port-output streamkit-app | grep -A4 'BEGIN SSH HOST KEY'
ssh-keyscan -t ed25519 <app_ip> <livekit_ip>   # сверить с выводом выше и сохранить
```

Ключ хоста новый у каждой пересозданной ВМ: после `terraform apply -replace=...`
секрет собирается заново, иначе выкатка остановится на «Host key verification
failed». Администратор входит на ВМ как `ops`.

## 6. Выпуск и выкатка

1. Слияние в `main` → CI → workflow **«Выпуск образов»** публикует
   `streamkit-api`, `-migrate`, `-web`, `-overlay` с тегом sha коммита и копирует
   Caddy, LiveKit и lego в `mirror/`.
2. **Actions → «Выкатка» → Run workflow**: `tag` — полный sha, `target` — `all`
   на первой выкатке, дальше обычно `app`.

Выкатка приложений: окружение из Lockbox → скачивание образов → миграции →
пересоздание контейнеров → ожидание `/api/readyz` → проверка снаружи (TLS, CSP,
реквизиты). На время пересоздания API — несколько секунд недоступности.

**Откат** — тот же workflow с тегом предыдущего выпуска (`DEPLOYED_TAG` на ВМ
хранит текущий). Миграции только вперёд: откат кода на схеме нового выпуска
работает, пока миграции добавляющие. Ломающее изменение схемы — два выпуска.

## 7. Внешние сервисы после первой выкатки

- **ЮKassa**, настройки магазина: HTTP-уведомления на
  `https://api.stream-kit.ru/api/billing/yookassa/webhook` (события
  `payment.succeeded`, `payment.canceled`, `refund.succeeded`); интеграция с «Мой
  налог»; адрес сайта для модерации — `https://stream-kit.ru`.
- **Статистика посещений (Umami)** — поднимается выкаткой, но считать начинает
  только после этих шагов:
  1. Пароль входа на `https://stats.stream-kit.ru` (пользователь `owner`):
     ```bash
     yc lockbox payload get --id $(terraform output -raw app_secret_id) --key STATS_PASSWORD
     ```
  2. За ним — форма входа Umami. **Сразу** войдите как `admin` с паролем `umami`
     и смените пароль в настройках профиля: это пароль по умолчанию.
  3. «Добавить сайт»: домен `stream-kit.ru`. Скопируйте идентификатор сайта.
  4. Добавьте его в `streamkit-external` ключом `UMAMI_WEBSITE_ID` (раздел 4) и
     запустите выкатку. Без него счётчик на сайте не грузится.

  В Umami **не включайте запись сессий и тепловые карты**: сайт подключает
  только `script.js`, но решение не записывать сессии должно быть видно и в
  самом Umami. Статистика старше 13 месяцев удаляется воркером.
- **Twitch** и **Google Cloud (YouTube)**: redirect URI
  `https://api.stream-kit.ru/api/integrations/twitch/callback` и
  `https://api.stream-kit.ru/api/integrations/youtube/callback`.

## 8. Проверка

- `https://stream-kit.ru` — главная с ценами и реквизитами; `curl -I
  https://stream-kit.ru/widgets` — есть `content-security-policy` и
  `strict-transport-security`.
- Регистрация → виджет оповещений → ссылка в OBS → тестовое событие на экране.
- Комната: гость **с телефона по мобильному интернету, Wi-Fi выключен** — видео
  доходит до оверлея. Это проверка TURN, адреса узла и портов разом.
- Тестовая оплата в тестовом магазине ЮKassa; в логах воркера
  (`docker compose logs worker` на ВМ) нет ошибок продления.
- Чат Twitch в виджете идёт — значит, воркер жив и держит соединение.

## Что проверить на первой выкатке — написано по документации

- **TLS миграций.** CLI Prisma подключается своим движком, и корневой
  сертификат ему передаётся параметром `sslcert` в `MIGRATE_DATABASE_URL`, а не
  `NODE_EXTRA_CA_CERTS`. Если миграции падают на проверке сертификата — это здесь.
- **Классы хостов и версия Valkey** — по умолчанию из `variables.tf`, наличие в
  каталоге не проверено.
- **Сертификат TURN** — lego по HTTP на 80-м порту ВМ медиасервера; первый
  выпуск требует уже разошедшегося DNS для `turn.stream-kit.ru`.
- **SMTP Postbox.** Логин — идентификатор API-ключа, пароль — его секрет, порт
  587 со STARTTLS. Первое письмо о списании — проверка этой связки: ошибка
  отправки в логе воркера, и продление не спишется, пока письмо не уйдёт.

## Известные ограничения

- Один экземпляр API: выкатка — несколько секунд простоя. Второй экземпляр
  потребует балансировщика (порт 3000 привязан к внутреннему адресу для вебхуков).
- `infra.env` на ВМ пишется при создании ВМ, и `terraform apply` его не
  обновляет (`ignore_changes = [metadata]`): при смене адресов баз или секретов —
  поправить файл на ВМ или пересоздать ВМ.
- Продление сертификата TURN перезапускает LiveKit и рвёт идущие созвоны — раз в
  два месяца, в понедельник в 03:17 по Москве.
- Сгенерированные секреты лежат в состоянии Terraform. Ротация — `terraform
  apply -replace=random_password.<имя>` и выкатка; `ENCRYPTION_KEY` так менять
  нельзя: зашифрованные токены площадок перестанут читаться.
