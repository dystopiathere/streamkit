import type { AdminMe } from '@streamkit/contracts';
import { create } from 'zustand';
import { queryClient } from './query-client';

interface AuthState {
  /** Access-токен только в памяти — как в дашборде, и по той же причине. */
  accessToken: string | null;
  staff: AdminMe | null;
  isRestoring: boolean;
  setSession: (accessToken: string, staff: AdminMe) => void;
  clearSession: () => void;
  setRestoring: (value: boolean) => void;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  accessToken: null,
  staff: null,
  isRestoring: true,
  setSession: (accessToken, staff) => {
    const previous = get().staff;
    if (previous && previous.id !== staff.id) queryClient.clear();
    set({ accessToken, staff, isRestoring: false });
  },
  clearSession: () => {
    // Карточки пользователей в кэше — чужие данные: следующий вошедший в этой
    // вкладке не должен их видеть ни секунды.
    queryClient.clear();
    set({ accessToken: null, staff: null, isRestoring: false });
  },
  setRestoring: (value) => set({ isRestoring: value }),
}));

export const useStaff = (): AdminMe | null => useAuthStore((state) => state.staff);
