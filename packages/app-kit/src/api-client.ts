export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly details?: Array<{ path: string; message: string }>,
    /** Машиночитаемый код ошибки, если сервер его прислал (`subscription_required`). */
    readonly code?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  /** Внутренний флаг: запрос уже повторялся после обновления токена. */
  retried?: boolean;
}

/** Где приложение держит сессию. Токен — только в памяти, см. хранилища приложений. */
export interface SessionStore<TUser> {
  getToken(): string | null;
  setSession(accessToken: string, user: TUser): void;
  clearSession(): void;
}

export interface ApiClientOptions<TUser> {
  /** Origin API с префиксом: `https://api.example.ru/api`. */
  baseUrl: string;
  /** Путь обновления токена относительно `baseUrl`: у дашборда и админки он свой. */
  refreshPath: string;
  /** Имя блокировки между вкладками. Разные сессии не должны ждать друг друга. */
  lockName: string;
  session: SessionStore<TUser>;
}

type RefreshOutcome = 'refreshed' | 'rejected' | 'unavailable';

export interface ApiClient {
  request<T>(path: string, options?: RequestOptions): Promise<T>;
  get<T>(path: string): Promise<T>;
  post<T>(path: string, body?: unknown): Promise<T>;
  patch<T>(path: string, body?: unknown): Promise<T>;
  // DELETE с телом нужен там, где удаление требует явного подтверждения
  // (удаление аккаунта): подтверждение не должно уезжать в строку запроса.
  delete<T>(path: string, body?: unknown): Promise<T>;
  /** Восстановление сессии при загрузке страницы: access-токен живёт только в памяти. */
  restoreSession(): Promise<boolean>;
}

/**
 * Клиент API с обновлением access-токена.
 *
 * Обновление — единственное место на клиента. Промис обновления кэшируется: при
 * загрузке страницы уходит сразу несколько запросов, и без кэша каждый 401
 * запустил бы своё обновление. Параллельные обновления гасят друг друга —
 * сервер считает переиспользованием токена второе обращение и выкидывает
 * пользователя из аккаунта.
 */
export function createApiClient<TUser>({
  baseUrl,
  refreshPath,
  lockName,
  session,
}: ApiClientOptions<TUser>): ApiClient {
  let refreshPromise: Promise<RefreshOutcome> | null = null;

  /**
   * Между вкладками — по очереди.
   *
   * Кэш промиса живёт в одной вкладке. Браузер, восстановивший сессию с
   * дашбордом и комнатой в двух вкладках, отправлял два обновления с одной и той
   * же cookie разом, сервер видел повторное предъявление токена и гасил сессию
   * целиком. Под общей блокировкой вторая вкладка ждёт первую и идёт уже с новой
   * cookie: хранилище cookie у вкладок общее.
   */
  async function acrossTabs<T>(task: () => Promise<T>): Promise<T> {
    if (typeof navigator === 'undefined' || !navigator.locks) return task();
    return navigator.locks.request(lockName, task);
  }

  function refreshAccessToken(): Promise<RefreshOutcome> {
    refreshPromise ??= (async () => {
      try {
        const response = await acrossTabs(() =>
          fetch(`${baseUrl}${refreshPath}`, { method: 'POST', credentials: 'include' }),
        );
        // Разлогинивает только отказ по самой сессии. 429 и 5xx — это «сейчас не
        // вышло», а не «сессии нет»: выкидывать человека из аккаунта из-за
        // перегруженного API или лимита на общий IP нельзя.
        if (response.status === 401 || response.status === 403) return 'rejected';
        if (!response.ok) return 'unavailable';

        const data = (await response.json()) as { accessToken: string; user: TUser };
        session.setSession(data.accessToken, data.user);
        return 'refreshed';
      } catch {
        return 'unavailable';
      } finally {
        // Сбрасываем в микротаске, чтобы все ожидающие успели получить результат.
        queueMicrotask(() => {
          refreshPromise = null;
        });
      }
    })();

    return refreshPromise;
  }

  async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const { method = 'GET', body, retried = false } = options;
    const accessToken = session.getToken();

    const response = await fetch(`${baseUrl}${path}`, {
      method,
      // credentials нужны ради refresh-cookie (её Path узкий) и cookie-пропуска
      // админки, которую проверяет прокси перед API.
      credentials: 'include',
      headers: {
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });

    if (response.status === 401 && !retried) {
      const outcome = await refreshAccessToken();
      if (outcome === 'refreshed') {
        return request<T>(path, { ...options, retried: true });
      }
      if (outcome === 'rejected') {
        session.clearSession();
      } else {
        throw new ApiError(503, 'Сервис временно недоступен, попробуйте ещё раз');
      }
    }

    if (response.status === 204) {
      return undefined as T;
    }

    const payload = (await response.json().catch(() => null)) as {
      message?: string;
      code?: string;
      errors?: Array<{ path: string; message: string }>;
    } | null;

    if (!response.ok) {
      throw new ApiError(
        response.status,
        payload?.message ?? 'Не удалось выполнить запрос',
        payload?.errors,
        payload?.code,
      );
    }

    return payload as T;
  }

  return {
    request,
    get: (path) => request(path),
    post: (path, body) => request(path, { method: 'POST', body }),
    patch: (path, body) => request(path, { method: 'PATCH', body }),
    delete: (path, body) => request(path, { method: 'DELETE', body }),
    restoreSession: async () => (await refreshAccessToken()) === 'refreshed',
  };
}
