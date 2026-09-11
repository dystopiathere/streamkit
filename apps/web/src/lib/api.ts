import { API_BASE } from './config';
import { useAuthStore } from './auth-store';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly details?: Array<{ path: string; message: string }>,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  /** Внутренний флаг: запрос уже повторялся после обновления токена. */
  retried?: boolean;
}

/**
 * Единственное место, где происходит обновление access-токена.
 *
 * Промис обновления кэшируется: при загрузке страницы уходит сразу несколько
 * запросов, и без кэша каждый 401 запустил бы свой `/auth/refresh`. Параллельные
 * обновления гасят друг друга — сервер считает переиспользованием токена
 * второе обращение и выкидывает пользователя из аккаунта.
 */
let refreshPromise: Promise<boolean> | null = null;

async function refreshAccessToken(): Promise<boolean> {
  refreshPromise ??= (async () => {
    try {
      const response = await fetch(`${API_BASE}/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
      });
      if (!response.ok) return false;

      const data = (await response.json()) as { accessToken: string; user: unknown };
      useAuthStore.getState().setSession(data.accessToken, data.user as never);
      return true;
    } catch {
      return false;
    } finally {
      // Сбрасываем в микротаске, чтобы все ожидающие успели получить результат.
      queueMicrotask(() => {
        refreshPromise = null;
      });
    }
  })();

  return refreshPromise;
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, retried = false } = options;
  const accessToken = useAuthStore.getState().accessToken;

  const response = await fetch(`${API_BASE}${path}`, {
    method,
    // credentials нужны только ради refresh-cookie; она уходит лишь на /auth/*,
    // потому что Path у неё узкий.
    credentials: 'include',
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });

  if (response.status === 401 && !retried) {
    const refreshed = await refreshAccessToken();
    if (refreshed) {
      return apiRequest<T>(path, { ...options, retried: true });
    }
    useAuthStore.getState().clearSession();
  }

  if (response.status === 204) {
    return undefined as T;
  }

  const payload = (await response.json().catch(() => null)) as {
    message?: string;
    errors?: Array<{ path: string; message: string }>;
  } | null;

  if (!response.ok) {
    throw new ApiError(
      response.status,
      payload?.message ?? 'Не удалось выполнить запрос',
      payload?.errors,
    );
  }

  return payload as T;
}

export const api = {
  get: <T>(path: string) => apiRequest<T>(path),
  post: <T>(path: string, body?: unknown) => apiRequest<T>(path, { method: 'POST', body }),
  patch: <T>(path: string, body?: unknown) => apiRequest<T>(path, { method: 'PATCH', body }),
  // DELETE с телом нужен там, где удаление требует явного подтверждения
  // (удаление аккаунта): подтверждение не должно уезжать в строку запроса.
  delete: <T>(path: string, body?: unknown) => apiRequest<T>(path, { method: 'DELETE', body }),
  /** Восстановление сессии при загрузке страницы: access-токен живёт только в памяти. */
  restoreSession: refreshAccessToken,
};
