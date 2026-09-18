import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AuthorizeResponse, DonationService, DonationSources } from '@streamkit/contracts';
import { api } from '@/lib/api';

export const sourcesKeys = { all: ['donation-sources'] as const };

export function useDonationSources() {
  return useQuery({
    queryKey: sourcesKeys.all,
    queryFn: () => api.get<DonationSources>('/integrations/donations'),
  });
}

/**
 * Подключение сервиса: уводим в ту же вкладку, а не в новое окно — всплывающие
 * окна блокируются, а вернуть человека сервер должен туда, откуда он ушёл.
 */
export function useConnectDonationService() {
  return useMutation({
    mutationFn: async (service: DonationService) => {
      const { url } = await api.post<AuthorizeResponse>(
        `/integrations/donations/${service}/authorize`,
      );
      window.location.href = url;
    },
  });
}

export function useDisconnectDonationService() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (service: DonationService) =>
      api.delete<void>(`/integrations/donations/${service}`),
    onSuccess: () => client.invalidateQueries({ queryKey: sourcesKeys.all }),
  });
}

/** Новый секрет вебхука. Показывается один раз, старый перестаёт работать сразу. */
export function useRotateWebhookSecret() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<{ sourceId: string; secret: string }>('/events/webhook/secret'),
    onSuccess: () => client.invalidateQueries({ queryKey: sourcesKeys.all }),
  });
}
