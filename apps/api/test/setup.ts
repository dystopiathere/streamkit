import { resolve } from 'node:path';
import { loadEnvFiles } from '../src/config/env-files';

/**
 * Окружение интеграционных тестов.
 *
 * Порядок здесь важен и неочевиден: `ConfigModule` отдаёт приоритет значениям
 * из файла `.env`, а не переменным процесса. Поэтому файл загружается ЗДЕСЬ,
 * до старта приложения, а нужные значения перебиваются после загрузки. Сам
 * модуль конфигурации в тестовом режиме файл уже не читает (`ignoreEnvFile`).
 *
 * Без этого получаются два неприятных эффекта:
 *  - боевой лимит в 10 попыток входа в минуту роняет половину прогона на 429,
 *    причём падают те тесты, которым «не повезло» с порядком;
 *  - NODE_ENV из файла остаётся development, поднимается транспорт pino-pretty
 *    в отдельном потоке, и процесс vitest висит три минуты после последнего теста.
 */
loadEnvFiles(resolve(import.meta.dirname, '..'));

// Перебиваем то, что пришло из файла.
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'error';

// Лимит не отключён, а поднят: цепочка guard'ов остаётся ровно той же, что в
// проде, но перестаёт зависеть от количества тестов в прогоне.
process.env.THROTTLE_LIMIT = '100000';
process.env.THROTTLE_AUTH_LIMIT = '100000';

// Учётные данные площадок вычищаются всегда.
//
// Иначе прогон зависит от того, завёл ли разработчик приложение Twitch или
// YouTube на своей машине: с ключами площадка считается настроенной, без них —
// нет, и один и тот же тест даёт разный результат у разных людей и в CI.
// Тесту, которому нужна настроенная площадка, проще выставить ключи самому.
for (const key of [
  'TWITCH_CLIENT_ID',
  'TWITCH_CLIENT_SECRET',
  'YOUTUBE_CLIENT_ID',
  'YOUTUBE_CLIENT_SECRET',
  // ЮKassa — по той же причине: с ключами оплата настроена и комнаты платные,
  // без них бесплатны. Тест оплаты выставляет ключи сам.
  'YOOKASSA_SHOP_ID',
  'YOOKASSA_SECRET_KEY',
  'SELLER_NAME',
  'SELLER_INN',
  'SELLER_EMAIL',
  'SELLER_PHONE',
  // Почта — чтобы прогон не слал писем через SMTP разработчика. Тесты, которым
  // она нужна, подменяют отправку провайдером MAILER.
  'SMTP_HOST',
  'SMTP_USER',
  'SMTP_PASSWORD',
  'MAIL_FROM',
  'UMAMI_WEBSITE_ID',
  'UMAMI_DATABASE_URL',
]) {
  delete process.env[key];
}

// LiveKit — фиксированные тестовые значения, а не те, что в `.env` разработчика.
// Медиасервер в интеграционных тестах подменён: они проверяют, кому и с какими
// правами выдаётся токен, а подпись токена сверяется этим же секретом.
process.env.LIVEKIT_URL = 'http://livekit.test:7880';
process.env.LIVEKIT_PUBLIC_URL = 'wss://livekit.test';
process.env.LIVEKIT_API_KEY = 'test-livekit-key';
process.env.LIVEKIT_API_SECRET = 'test-livekit-secret-at-least-32-characters';
