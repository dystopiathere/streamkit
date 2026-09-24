import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { DisableTotpInput, SessionInfo } from '@streamkit/contracts';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';

export interface TotpSetup {
  secret: string;
  /** QR-код картинкой `data:` — CSP страницы разрешает `img-src data:`. */
  qrDataUrl: string;
}

/**
 * Шаг 1: сервер выпускает секрет, но второй фактор ещё не включён. Повторный
 * запрос выпускает новый секрет — прежний QR после этого не подойдёт.
 */
export function useBeginTotpSetup() {
  return useMutation({
    mutationFn: () => api.post<TotpSetup>('/auth/totp/setup'),
  });
}

// Итог включения и выключения сообщается здесь, а не колбэком `mutate`: форма,
// отправившая запрос, сменяется другой в тот же момент, когда меняется флаг
// пользователя, а колбэки `mutate` у размонтированного компонента не вызываются.

/** Шаг 2: включение только после верного кода — иначе можно запереть себя. */
export function useConfirmTotp() {
  const { t } = useTranslation();
  const patchUser = useAuthStore((state) => state.patchUser);
  return useMutation({
    mutationFn: (code: string) => api.post<void>('/auth/totp/confirm', { code }),
    onSuccess: () => {
      patchUser({ isTotpEnabled: true });
      toast.success(t('security.totp.enabled'));
    },
  });
}

export function useDisableTotp() {
  const { t } = useTranslation();
  const patchUser = useAuthStore((state) => state.patchUser);
  return useMutation({
    mutationFn: (input: DisableTotpInput) => api.post<void>('/auth/totp/disable', input),
    onSuccess: () => {
      patchUser({ isTotpEnabled: false });
      toast.success(t('security.totp.disabled'));
    },
  });
}

export const sessionKeys = {
  all: ['auth', 'sessions'] as const,
};

/** Устройства, на которых открыт дашборд: одно семейство токенов — одно устройство. */
export function useSessions() {
  return useQuery({
    queryKey: sessionKeys.all,
    queryFn: () => api.get<SessionInfo[]>('/auth/sessions'),
  });
}

/**
 * Выход на другом устройстве. Тот, кто держит эту сессию, выйдет при
 * следующем обновлении токена — в пределах срока access-токена.
 */
export function useRevokeSession() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete<void>(`/auth/sessions/${id}`),
    onSettled: () => client.invalidateQueries({ queryKey: sessionKeys.all }),
  });
}
