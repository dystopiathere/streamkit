import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, query } from './api';
import { useAuthStore } from './auth-store';

const staff = {
  id: '00000000-0000-4000-8000-000000000001',
  email: 'admin@example.com',
  displayName: 'Админ',
  isTotpEnabled: true,
  emailVerified: true,
  createdAt: new Date().toISOString(),
  role: 'admin' as const,
};

describe('клиент API админки', () => {
  beforeEach(() => useAuthStore.getState().clearSession());
  afterEach(() => vi.unstubAllGlobals());

  it('строка запроса не несёт пустых фильтров', () => {
    expect(query({ q: '', status: undefined, role: 'admin', limit: 50 })).toBe(
      '?role=admin&limit=50',
    );
    expect(query({ q: undefined })).toBe('');
  });

  it('обновляет сессию своим путём, а не путём дашборда', async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        calls.push(url);
        if (url.endsWith('/admin/auth/refresh')) {
          return { ok: true, status: 200, json: async () => ({ accessToken: 'new', user: staff }) };
        }
        const authorized = calls.filter((call) => call.endsWith('/admin/users')).length > 1;
        return authorized
          ? { ok: true, status: 200, json: async () => ({ items: [], nextCursor: null }) }
          : { ok: false, status: 401, json: async () => ({}) };
      }),
    );

    await api.get('/admin/users');

    expect(calls.some((call) => call.endsWith('/api/admin/auth/refresh'))).toBe(true);
    expect(calls.some((call) => call.endsWith('/api/auth/refresh'))).toBe(false);
    expect(useAuthStore.getState().staff?.role).toBe('admin');
  });

  it('отказ в обновлении завершает сессию и чистит данные сотрудника', async () => {
    useAuthStore.getState().setSession('old', staff);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 401, json: async () => ({ message: 'нет' }) })),
    );

    await expect(api.get('/admin/users')).rejects.toMatchObject({ status: 401 });
    expect(useAuthStore.getState()).toMatchObject({ accessToken: null, staff: null });
  });
});
