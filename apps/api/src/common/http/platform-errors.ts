/**
 * Ошибки внешних площадок.
 *
 * Разделены по тому, ЧТО делать дальше, а не по коду ответа: «переподключите
 * площадку», «подождите и попробуйте снова» и «что-то сломалось» ведут к трём
 * разным реакциям опроса и к трём разным сообщениям в дашборде.
 */
export class PlatformError extends Error {
  constructor(
    readonly platform: string,
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

/** Площадка отвергла токен. Опрос канала прекращается до повторного входа. */
export class PlatformAuthError extends PlatformError {}

/** Лимит запросов исчерпан. Опрос возобновится сам, чинить нечего. */
export class PlatformRateLimitError extends PlatformError {
  constructor(
    platform: string,
    status: number,
    message: string,
    readonly retryAfterMs: number,
  ) {
    super(platform, status, message);
  }
}
