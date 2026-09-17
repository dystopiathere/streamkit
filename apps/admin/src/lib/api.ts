import { createApiClient } from '@streamkit/app-kit';
import type { AdminMe } from '@streamkit/contracts';
import { useAuthStore } from './auth-store';
import { API_BASE } from './config';

export { ApiError } from '@streamkit/app-kit';

export const api = createApiClient<AdminMe>({
  baseUrl: API_BASE,
  refreshPath: '/admin/auth/refresh',
  // Своя блокировка: сессия админки не должна ждать обновления сессии дашборда.
  lockName: 'streamkit:admin-auth-refresh',
  session: {
    getToken: () => useAuthStore.getState().accessToken,
    setSession: (accessToken, staff) => useAuthStore.getState().setSession(accessToken, staff),
    clearSession: () => useAuthStore.getState().clearSession(),
  },
});

/** Строка запроса без пустых значений. */
export function query(params: Record<string, string | number | undefined | null>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : '';
}
