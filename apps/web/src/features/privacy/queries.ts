import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { ANALYTICS_CONSENT, writeCookieChoice } from '@/lib/cookie-consent';

export interface ConsentView {
  document: string;
  title: string;
  path: string;
  required: boolean;
  currentVersion: string;
  acceptedVersion: string | null;
  acceptedAt: string | null;
  needsRenewal: boolean;
}

export const consentKeys = { all: ['privacy', 'consents'] as const };

/**
 * Журнал согласий пользователя.
 *
 * Один запрос на два места — раздел «Приватность» и баннер cookie. Раньше
 * баннер журнал не читал вовсе, и «Принять все» в нём не оставляло в журнале
 * никакого следа.
 */
export function useConsents() {
  return useQuery({
    queryKey: consentKeys.all,
    queryFn: () => api.get<ConsentView[]>('/privacy/consents'),
  });
}

/** Действующее согласие на аналитические cookie: есть и дано на текущую редакцию. */
export function isAnalyticsAccepted(consents: ConsentView[] | undefined): boolean {
  const analytics = consents?.find((consent) => consent.document === ANALYTICS_CONSENT);
  return Boolean(analytics?.acceptedVersion) && !analytics?.needsRenewal;
}

export function useGrantConsent() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (document: string) => api.post<void>('/privacy/consents', { document }),
    onSuccess: async (_result, document) => {
      // Выбор в браузере следует за журналом сразу, не дожидаясь перезапроса:
      // иначе баннер успел бы мигнуть с вопросом, на который уже ответили.
      if (document === ANALYTICS_CONSENT) writeCookieChoice('all');
      await client.invalidateQueries({ queryKey: consentKeys.all });
    },
  });
}

export function useRevokeConsent() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (document: string) => api.post<void>('/privacy/consents/revoke', { document }),
    onSuccess: async (_result, document) => {
      // Отзыв в разделе «Приватность» — это ответ «только необходимые», а не
      // «спросите меня снова»: баннер после него появляться не должен.
      if (document === ANALYTICS_CONSENT) writeCookieChoice('necessary');
      await client.invalidateQueries({ queryKey: consentKeys.all });
    },
  });
}
