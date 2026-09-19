import type { ChannelStats, StreamOverview } from '@streamkit/contracts';
import { type QueryClient, useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

export const streamKeys = {
  overview: ['stream', 'overview'] as const,
};

/**
 * Сводка окна эфира.
 *
 * Перезапрашивается раз в 30 секунд — ради виджетов: «подключён к OBS» —
 * отметка на сервере, и событий о ней сокет не шлёт. Зрители и чат между
 * запросами приходят сокетом.
 */
export function useStreamOverview() {
  return useQuery({
    queryKey: streamKeys.overview,
    queryFn: () => api.get<StreamOverview>('/stream'),
    // При каждом открытии — заново: виджеты и каналы меняются на соседних
    // страницах, и с общим `staleTime` окно полминуты показывало бы прежние.
    staleTime: 0,
    refetchInterval: 30_000,
  });
}

/** Свежие метрики канала из сокета — поверх сводки в кэше, без запроса. */
export function applyChannelStats(
  client: QueryClient,
  channelId: string,
  stats: ChannelStats,
): void {
  client.setQueryData<StreamOverview>(streamKeys.overview, (current) =>
    current
      ? {
          ...current,
          channels: current.channels.map((channel) =>
            channel.id === channelId
              ? {
                  ...channel,
                  isLive: stats.isLive,
                  viewers: stats.isLive ? stats.viewers : null,
                  liveSince: stats.isLive ? stats.liveSince : null,
                  title: stats.isLive ? stats.title : null,
                  capturedAt: stats.capturedAt,
                }
              : channel,
          ),
        }
      : current,
  );
}
