import type { PublicUser } from '@streamkit/contracts';
import { create } from 'zustand';
import { writeCookieChoice } from './cookie-consent';
import { queryClient } from './query-client';

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

export const useAuthStore = create<AuthState>((set, get) => ({
  accessToken: null,
  user: null,
  isRestoring: true,

  setSession: (accessToken, user) => {
    // Вход под другим пользователем без явного выхода (сессия истекла, вошли
    // заново другим аккаунтом) — кэш прежнего тоже не должен дожить до рендера.
    const previous = get().user;
    if (previous && previous.id !== user.id) queryClient.clear();
    set({ accessToken, user, isRestoring: false });
  },
  clearSession: () => {
    // Кэш запросов принадлежит пользователю: без очистки следующий вошедший в
    // этой вкладке видел бы чужие данные, пока они не устареют.
    queryClient.clear();
    // Копия согласия на cookie — тоже. Иначе после выхода статистика на странице
    // входа считала бы по согласию предыдущего человека за этим компьютером.
    // Вернувшийся тот же пользователь согласия не лишается: оно в его журнале, и
    // сверка после входа восстановит копию без вопроса.
    writeCookieChoice(null);
    set({ accessToken: null, user: null, isRestoring: false });
  },
  setRestoring: (value) => set({ isRestoring: value }),
}));

export const useCurrentUser = (): PublicUser | null => useAuthStore((state) => state.user);
export const useIsAuthenticated = (): boolean =>
  useAuthStore((state) => state.accessToken !== null);
