import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api } from './api';
import { useAuthStore } from './auth-store';

interface StubResponse {
  status: number;
  body?: unknown;
}

/**
 * Мокаем `fetch` целиком: проверяется логика клиента (обновление токена,
 * обработка кодов ответа), а не сеть.
 */
function stubFetch(responses: StubResponse[]): ReturnType<typeof vi.fn> {
  const queue = [...responses];
  const mock = vi.fn(async () => {
    const next = queue.shift() ?? { status: 500 };
    return {
      ok: next.status >= 200 && next.status < 300,
      status: next.status,
      json: async () => next.body ?? {},
    } as Response;
  });

  vi.stubGlobal('fetch', mock);
  return mock;
}

const user = {
  id: '00000000-0000-4000-8000-000000000001',
  email: 'streamer@example.com',
  displayName: 'Стример',
  isTotpEnabled: false,
  createdAt: new Date().toISOString(),
};

describe('клиент API', () => {
  beforeEach(() => {
    useAuthStore.getState().clearSession();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('подставляет заголовок авторизации, когда токен есть', async () => {
    useAuthStore.getState().setSession('access-token', user);
    const fetchMock = stubFetch([{ status: 200, body: { ok: true } }]);

    await api.get('/widgets');

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer access-token');
  });

  it('не шлёт заголовок авторизации без токена', async () => {
    const fetchMock = stubFetch([{ status: 200, body: {} }]);

    await api.get('/privacy/documents');

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBeUndefined();
  });

  it('возвращает undefined на 204, не пытаясь разобрать пустое тело', async () => {
    useAuthStore.getState().setSession('access-token', user);
    stubFetch([{ status: 204 }]);

    await expect(api.delete('/widgets/x')).resolves.toBeUndefined();
  });

  it('после 401 обновляет токен и повторяет запрос', async () => {
    useAuthStore.getState().setSession('истёкший', user);

    const fetchMock = stubFetch([
      { status: 401 },
      { status: 200, body: { accessToken: 'новый', user } },
      { status: 200, body: { items: [] } },
    ]);

    const result = await api.get<{ items: unknown[] }>('/events');

    expect(result.items).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(useAuthStore.getState().accessToken).toBe('новый');
  });

  it('повторяет запрос только один раз: второй 401 подряд не зацикливает клиент', async () => {
    useAuthStore.getState().setSession('истёкший', user);

    const fetchMock = stubFetch([
      { status: 401 },
      { status: 200, body: { accessToken: 'новый', user } },
      { status: 401, body: { message: 'Недействительный токен' } },
    ]);

    await expect(api.get('/events')).rejects.toBeInstanceOf(ApiError);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('при неудачном обновлении сбрасывает сессию', async () => {
    useAuthStore.getState().setSession('истёкший', user);
    stubFetch([{ status: 401 }, { status: 401 }]);

    await expect(api.get('/events')).rejects.toBeInstanceOf(ApiError);
    expect(useAuthStore.getState().accessToken).toBeNull();
  });

  it('на несколько параллельных 401 делает ровно одно обновление токена', async () => {
    useAuthStore.getState().setSession('истёкший', user);

    // Три запроса получают 401, затем одно обновление, затем три повтора.
    // Если бы обновлений было три, сервер счёл бы это переиспользованием
    // refresh-токена и разлогинил пользователя.
    const fetchMock = stubFetch([
      { status: 401 },
      { status: 401 },
      { status: 401 },
      { status: 200, body: { accessToken: 'новый', user } },
      { status: 200, body: { ok: 1 } },
      { status: 200, body: { ok: 2 } },
      { status: 200, body: { ok: 3 } },
    ]);

    await Promise.all([api.get('/a'), api.get('/b'), api.get('/c')]);

    const refreshCalls = fetchMock.mock.calls.filter((call) =>
      String(call[0]).includes('/auth/refresh'),
    );
    expect(refreshCalls).toHaveLength(1);
  });

  it('превращает ошибку сервера в ApiError с кодом и сообщением', async () => {
    stubFetch([{ status: 409, body: { message: 'Уже зарегистрирован' } }]);

    await expect(api.post('/auth/register', {})).rejects.toMatchObject({
      status: 409,
      message: 'Уже зарегистрирован',
    });
  });
});
