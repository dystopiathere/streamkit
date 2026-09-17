import { Injectable, Logger } from '@nestjs/common';
import {
  PlatformAuthError,
  PlatformError,
  PlatformQuotaError,
  PlatformRateLimitError,
} from './platform-errors';

/** Сколько ждём ответа площадки. Опрос идёт раз в минуту — висеть дольше незачем. */
const REQUEST_TIMEOUT_MS = 10_000;
const MAX_ATTEMPTS = 3;
const BASE_BACKOFF_MS = 300;

export interface PlatformRequest {
  platform: string;
  url: string;
  /** Токен пользователя. В логи не попадает ни при каком исходе. */
  accessToken?: string;
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  /** Тело формы — так требуют оба токен-эндпоинта, и Twitch, и Google. */
  form?: Record<string, string>;
  /** JSON-тело — так принимает платёжный API. Взаимоисключимо с `form`. */
  json?: unknown;
  /**
   * Basic-авторизация учётными данными приложения (ЮKassa: идентификатор
   * магазина и секретный ключ). В логи не попадает, как и `accessToken`.
   */
  basicAuth?: { username: string; password: string };
  /**
   * Извлечь из тела ошибки поля, которые можно писать в журнал.
   *
   * Тело целиком в журнал не идёт (эхо запроса), и без этого отказ платёжного
   * API оставлял в проде одно «ответила 403»: причина была только на уровне
   * debug. Извлекатель знает формат своей площадки и берёт из него код и
   * описание — без заголовков и данных запроса.
   */
  describeError?: (body: string) => Record<string, string> | undefined;
}

/**
 * Задержка перед повтором с джиттером.
 *
 * Джиттер обязателен: без него все каналы, упавшие в один тик опроса,
 * повторятся строго одновременно и добьют площадку ровно в тот момент, когда
 * ей плохо.
 */
export function backoffMs(attempt: number, random: () => number = Math.random): number {
  const base = BASE_BACKOFF_MS * 2 ** (attempt - 1);
  return Math.round(base * (0.5 + random()));
}

/** Стоит ли повторять запрос при таком коде ответа. */
export function isRetryable(status: number): boolean {
  // 429 сюда не входит намеренно: «слишком часто» лечится паузой до следующего
  // тика, а не немедленным повтором — повтор только усугубит.
  return status >= 500;
}

/**
 * Тонкий клиент для запросов к площадкам.
 *
 * Заведён вместо голого `fetch` из-за трёх вещей, которые голый fetch не делает:
 * таймаута (по умолчанию его нет вовсе, и зависший запрос держит тик опроса),
 * различения ошибок по смыслу и гарантии, что токен не утечёт в лог.
 */
@Injectable()
export class HttpClient {
  private readonly logger = new Logger(HttpClient.name);

  async json<T>(request: PlatformRequest): Promise<T> {
    let lastError: unknown;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      try {
        return await this.attempt<T>(request);
      } catch (error) {
        lastError = error;

        const retryable =
          error instanceof PlatformError ? isRetryable(error.status) : isNetworkError(error);
        if (!retryable || attempt === MAX_ATTEMPTS) throw error;

        const delay = backoffMs(attempt);
        this.logger.warn(
          { platform: request.platform, attempt, delay },
          'Площадка не ответила, повторяем',
        );
        await sleep(delay);
      }
    }

    throw lastError;
  }

  private async attempt<T>(request: PlatformRequest): Promise<T> {
    const response = await fetch(request.url, {
      method: request.method ?? 'GET',
      headers: {
        Accept: 'application/json',
        ...(request.accessToken ? { Authorization: `Bearer ${request.accessToken}` } : {}),
        ...(request.basicAuth
          ? {
              Authorization: `Basic ${Buffer.from(
                `${request.basicAuth.username}:${request.basicAuth.password}`,
              ).toString('base64')}`,
            }
          : {}),
        ...(request.form ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
        ...(request.json !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...request.headers,
      },
      ...(request.form ? { body: new URLSearchParams(request.form).toString() } : {}),
      ...(request.json !== undefined ? { body: JSON.stringify(request.json) } : {}),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (response.ok) {
      return (await response.json()) as T;
    }

    // Тело ошибки читаем, но наружу не отдаём целиком: площадки любят возвращать
    // в нём эхо запроса, включая заголовки.
    const detail = await response.text().catch(() => '');
    this.logger.debug(
      { platform: request.platform, status: response.status, detail: detail.slice(0, 200) },
      'Площадка ответила ошибкой',
    );

    throw withProviderError(this.errorFor(request, response, detail), request, detail);
  }

  private errorFor(request: PlatformRequest, response: Response, detail: string): PlatformError {
    // Причина разбирается ДО проверки на 401/403: Google отвечает 403 и на
    // отозванный доступ, и на исчерпанную квоту, а это противоположные реакции —
    // «переподключите площадку» против «вернёмся завтра».
    const quota = quotaReason(response.status, detail);
    if (quota) {
      return new PlatformQuotaError(
        request.platform,
        response.status,
        'Квота площадки исчерпана',
        quota,
      );
    }

    if (response.status === 401 || response.status === 403) {
      return new PlatformAuthError(request.platform, response.status, 'Площадка отвергла токен');
    }
    if (response.status === 429) {
      return new PlatformRateLimitError(
        request.platform,
        429,
        'Лимит запросов площадки исчерпан',
        retryAfterMs(response.headers.get('retry-after')),
      );
    }
    return new PlatformError(
      request.platform,
      response.status,
      `Площадка ответила ${response.status}`,
    );
  }
}

function withProviderError(
  error: PlatformError,
  request: PlatformRequest,
  detail: string,
): PlatformError {
  if (request.describeError) {
    try {
      error.providerError = request.describeError(detail);
    } catch {
      // Неразборчивое тело не должно подменять собой настоящую ошибку.
    }
  }
  return error;
}

/** Причины, которыми Google помечает исчерпание квоты и лимита частоты. */
const QUOTA_REASONS = new Set([
  'quotaExceeded',
  'dailyLimitExceeded',
  'rateLimitExceeded',
  'userRateLimitExceeded',
]);

/**
 * Причина отказа из тела ответа, если это отказ по квоте.
 *
 * Разбирать тело приходится потому, что код ответа тут ничего не различает:
 * Google отдаёт 403 и когда пользователь отозвал доступ, и когда кончились
 * суточные единицы проекта. Причина лежит в `error.errors[0].reason`.
 *
 * Чужой или неразобранный формат — не квота: молча считать отказ временным
 * опаснее, чем наоборот, потому что тогда мёртвый токен будет опрашиваться вечно.
 *
 * Смотрим только 403. Код 429 разбирать незачем: он и так означает лимит
 * частоты, и у него есть заголовок `Retry-After`, который эта ветка потеряла бы.
 */
export function quotaReason(status: number, body: string): string | null {
  if (status !== 403) return null;

  try {
    const parsed = JSON.parse(body) as {
      error?: { errors?: Array<{ reason?: unknown }>; status?: unknown };
    };
    for (const item of parsed.error?.errors ?? []) {
      if (typeof item.reason === 'string' && QUOTA_REASONS.has(item.reason)) {
        return item.reason;
      }
    }
    // Новый формат ошибок Google: массива errors нет, есть только status.
    if (parsed.error?.status === 'RESOURCE_EXHAUSTED') return 'quotaExceeded';
  } catch {
    // Не JSON — значит и не ошибка Google. Отказ разберут ветки ниже.
  }
  return null;
}

/** `Retry-After` приходит в секундах. Часа хватает: дольше ждать смысла нет. */
export function retryAfterMs(header: string | null): number {
  const seconds = Number(header);
  if (!Number.isFinite(seconds) || seconds <= 0) return 60_000;
  return Math.min(seconds, 3600) * 1000;
}

function isNetworkError(error: unknown): boolean {
  // Обрыв связи и таймаут — именно то, что стоит повторить: с самим запросом
  // всё в порядке, не повезло сети.
  return error instanceof TypeError || (error instanceof Error && error.name === 'TimeoutError');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
