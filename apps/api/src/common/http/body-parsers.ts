import type { NestExpressApplication } from '@nestjs/platform-express';

/**
 * Разбор тел, которые приходят не как `application/json`.
 *
 * LiveKit шлёт вебхуки с типом `application/webhook+json`. Стандартный парсер
 * Nest такое тело не трогает: `rawBody` остаётся пустым, подпись сверить не с
 * чем, и каждый вебхук отвергался бы как поддельный — то есть отозванный гость
 * спокойно входил бы обратно, а в логах была бы только «неверная подпись».
 *
 * Общая функция для `main.ts` и тестового стенда: разойдись они, интеграционный
 * тест проверял бы не то приложение, что работает в проде.
 */
export function registerBodyParsers(app: NestExpressApplication): void {
  // Оба типа в ОДНОМ парсере. Зарегистрированный здесь JSON-парсер Nest считает
  // уже применённым и свой стандартный не ставит: с одним только
  // `application/webhook+json` каждый обычный запрос с JSON приходил без тела,
  // и регистрация отвечала 400.
  app.useBodyParser('json', { type: ['application/json', 'application/webhook+json'] });
}
