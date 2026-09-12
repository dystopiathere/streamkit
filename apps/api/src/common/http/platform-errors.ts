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

/**
 * Квота площадки исчерпана.
 *
 * Отдельный класс, потому что Google сообщает об этом кодом 403 — тем же, что и
 * об отозванном доступе. Без разбора причины любое исчерпание квоты выглядело бы
 * как мёртвый токен, и опрос всех каналов YouTube останавливался бы НАВСЕГДА,
 * требуя от каждого стримера переподключить площадку руками. Между тем квота
 * восстанавливается сама в полночь.
 */
export class PlatformQuotaError extends PlatformError {
  constructor(
    platform: string,
    status: number,
    message: string,
    /** Причина из ответа площадки: `quotaExceeded`, `rateLimitExceeded` и т.п. */
    readonly reason: string,
  ) {
    super(platform, status, message);
  }

  /**
   * Кончился ли суточный бюджет — в отличие от мгновенного лимита частоты.
   *
   * Разница существенная: суточный означает «до завтра», и наш счётчик обязан
   * об этом узнать; частотный проходит за секунды и трогать счётчик не должен.
   */
  get isDaily(): boolean {
    return this.reason === 'quotaExceeded' || this.reason === 'dailyLimitExceeded';
  }
}
