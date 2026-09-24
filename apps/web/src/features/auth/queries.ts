import { useMutation } from '@tanstack/react-query';
import type { DisableTotpInput } from '@streamkit/contracts';
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
      toast.success(t('privacy.totp.enabled'));
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
      toast.success(t('privacy.totp.disabled'));
    },
  });
}
