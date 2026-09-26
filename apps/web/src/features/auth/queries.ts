import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { DisableTotpInput, PublicUser, SessionInfo } from '@streamkit/contracts';
import { useEffect } from 'react';
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

/**
 * Письмо подтверждения почты ещё раз. Сервер пускает раз в минуту и отвечает
 * 429 с текстом — его и показываем.
 */
export function useResendVerification() {
  return useMutation({
    mutationFn: () => api.post<void>('/auth/email/resend'),
  });
}

/**
 * Подтверждение почты, сделанное в другой вкладке или на телефоне.
 *
 * Ссылку из письма открывают где угодно, а флаг в этой вкладке живёт в памяти
 * до следующего входа. Пока почта не подтверждена, профиль перечитывается при
 * возврате на вкладку — плашка уходит сама, без перезагрузки.
 */
export function useEmailVerificationSync(): void {
  const user = useAuthStore((state) => state.user);
  const patchUser = useAuthStore((state) => state.patchUser);
  const pending = user !== null && !user.emailVerified;
  const me = useQuery({
    queryKey: ['auth', 'me'],
    queryFn: () => api.get<PublicUser>('/auth/me'),
    enabled: pending,
    refetchOnWindowFocus: 'always',
    staleTime: 0,
  });
  const verified = me.data?.emailVerified === true;
  useEffect(() => {
    if (pending && verified) patchUser({ emailVerified: true });
  }, [pending, verified, patchUser]);
}
