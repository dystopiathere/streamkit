import {
  type AnalyticsRange,
  type AnalyticsSeries,
  type AuthorizeResponse,
  type AvailablePlatform,
  type Channel,
  type ChannelSummary,
  type DonationTotal,
  type Platform,
  SOCKET_EVENTS,
  analyticsUpdatedMessageSchema,
} from '@streamkit/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { api } from '@/lib/api';
import { useDashboardSocket } from '@/lib/useDashboardSocket';

/**
 * Зона браузера уезжает на сервер вместе с диапазоном.
 *
 * Считать корзины графика на сервере в UTC было неверно: аудитория в РФ, и
 * ночной эфир разваливался на графике за месяц на два соседних дня.
 */
const TIME_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;

export const analyticsKeys = {
  channels: ['channels'] as const,
  platforms: ['integrations'] as const,
  summary: (id: string, range: AnalyticsRange) => ['channels', id, 'summary', range] as const,
  series: (id: string, range: AnalyticsRange) =>
    ['channels', id, 'series', range, TIME_ZONE] as const,
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
    queryFn: () =>
      api.get<AnalyticsSeries>(
        `/channels/${channelId}/series?range=${range}&timeZone=${encodeURIComponent(TIME_ZONE)}`,
      ),
  });
}

export function useDonationTotals(range: AnalyticsRange) {
  return useQuery({
    queryKey: analyticsKeys.donations(range),
    queryFn: () => api.get<DonationTotal[]>(`/analytics/donations?range=${range}`),
  });
}

/**
 * Живые метрики каналов.
 *
 * Воркер публикует свежий снимок в шину сразу после сбора, и число зрителей
 * приезжает само. Опрашивать вместо этого API нельзя: открытая во время эфира
 * вкладка «Аналитика» превратилась бы в генератор запросов раз в минуту, а
 * данные всё равно обновляются не чаще, чем их собирает воркер.
 *
 * Правится только сводка: ряд графика — это агрегат по корзинам, и дописывать в
 * него точку на клиенте значило бы считать среднее по корзине двумя разными
 * способами в двух местах.
 */
export function useLiveChannelStats(): void {
  const client = useQueryClient();

  useDashboardSocket(
    SOCKET_EVENTS.analyticsUpdated,
    useCallback(
      (payload: unknown) => {
        const parsed = analyticsUpdatedMessageSchema.safeParse(payload);
        if (!parsed.success) return;

        const { channelId, stats } = parsed.data;
        // Обновляем сводку во всех диапазонах сразу: «сейчас» у них общее, а
        // какой из них открыт — вопрос переключателя, а не данных.
        client.setQueriesData<ChannelSummary>(
          { queryKey: ['channels', channelId, 'summary'] },
          (summary) => (summary ? { ...summary, current: stats } : summary),
        );
      },
      [client],
    ),
  );
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
