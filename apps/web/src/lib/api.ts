import { createApiClient } from '@streamkit/app-kit';
import { type PublicUser, translateMessage } from '@streamkit/contracts';
import { API_BASE } from './config';
import { useAuthStore } from './auth-store';
import { currentLanguage } from './locale';

export { ApiError } from '@streamkit/app-kit';

export const api = createApiClient<PublicUser>({
  baseUrl: API_BASE,
  refreshPath: '/auth/refresh',
  lockName: 'streamkit:auth-refresh',
  session: {
    getToken: () => useAuthStore.getState().accessToken,
    setSession: (accessToken, user) => useAuthStore.getState().setSession(accessToken, user),
    clearSession: () => useAuthStore.getState().clearSession(),
  },
  localizeMessage: (message) => translateMessage(message, currentLanguage()),
});
