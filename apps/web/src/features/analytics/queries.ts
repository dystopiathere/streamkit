import type {
  AnalyticsRange,
  AnalyticsSeries,
  AuthorizeResponse,
  AvailablePlatform,
  Channel,
  ChannelSummary,
  DonationTotal,
  Platform,
} from '@streamkit/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

export const analyticsKeys = {
  channels: ['channels'] as const,
  platforms: ['integrations'] as const,
  summary: (id: string, range: AnalyticsRange) => ['channels', id, 'summary', range] as const,
  series: (id: string, range: AnalyticsRange) => ['channels', id, 'series', range] as const,
  donations: (range: AnalyticsRange) => ['analytics', 'donations', range] as const,
};

export function useChannels() {
  return useQuery({
    queryKey: analyticsKeys.channels,
    queryFn: () => api.get<Channel[]>('/channels'),
  });
}

export function usePlatforms() {
  return useQuery({
    queryKey: analyticsKeys.platforms,
    queryFn: () => api.get<AvailablePlatform[]>('/integrations'),
  });
}

export function useChannelSummary(channelId: string, range: AnalyticsRange) {
  return useQuery({
    queryKey: analyticsKeys.summary(channelId, range),
    queryFn: () => api.get<ChannelSummary>(`/channels/${channelId}/summary?range=${range}`),
  });
}

export function useChannelSeries(channelId: string, range: AnalyticsRange) {
  return useQuery({
    queryKey: analyticsKeys.series(channelId, range),
    queryFn: () => api.get<AnalyticsSeries>(`/channels/${channelId}/series?range=${range}`),
  });
}

export function useDonationTotals(range: AnalyticsRange) {
  return useQuery({
    queryKey: analyticsKeys.donations(range),
    queryFn: () => api.get<DonationTotal[]>(`/analytics/donations?range=${range}`),
  });
}

/**
 * Подключение площадки.
 *
 * Уводим на площадку через `window.location`, а не открываем новое окно:
 * всплывающие окна блокируются, а вернуться пользователь должен в ту же
 * вкладку — сервер редиректит его обратно сам.
 */
export function useConnectPlatform() {
  return useMutation({
    mutationFn: async (platform: Platform) => {
      const { url } = await api.post<AuthorizeResponse>(`/integrations/${platform}/authorize`);
      window.location.href = url;
    },
  });
}

export function useDisconnectChannel() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (channelId: string) => api.delete<void>(`/channels/${channelId}`),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: analyticsKeys.channels });
      void client.invalidateQueries({ queryKey: analyticsKeys.platforms });
    },
  });
}
