import type { PublicUser } from '@streamkit/contracts';
import { create } from 'zustand';

interface AuthState {
  /**
   * Access-токен ТОЛЬКО в памяти.
   *
   * Ни localStorage, ни sessionStorage: оба доступны любому скрипту на странице,
   * и при XSS токен утекает мгновенно. Ценой служит потеря сессии при перезагрузке
   * вкладки — она восстанавливается через httpOnly refresh-cookie.
   */
  accessToken: string | null;
  user: PublicUser | null;
  /** Идёт ли восстановление сессии при старте приложения. */
  isRestoring: boolean;

  setSession: (accessToken: string, user: PublicUser) => void;
  clearSession: () => void;
  setRestoring: (value: boolean) => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  accessToken: null,
  user: null,
  isRestoring: true,

  setSession: (accessToken, user) => set({ accessToken, user, isRestoring: false }),
  clearSession: () => set({ accessToken: null, user: null, isRestoring: false }),
  setRestoring: (value) => set({ isRestoring: value }),
}));

export const useCurrentUser = (): PublicUser | null => useAuthStore((state) => state.user);
export const useIsAuthenticated = (): boolean =>
  useAuthStore((state) => state.accessToken !== null);
