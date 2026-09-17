import type {
  AdminAuditEntry,
  AdminChannel,
  AdminInvite,
  AdminPayment,
  AdminRoom,
  AdminStats,
  AdminStatsRange,
  AdminUserDetail,
  AdminUserRow,
  AdminWidget,
  Page,
} from '@streamkit/contracts';
import { toast } from 'sonner';
import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import i18n from './i18n';
import { api, ApiError, query } from './api';

type Params = Record<string, string | undefined>;

/**
 * Ключи кэша.
 *
 * Списки и карточка лежат под общим префиксом `admin`, и действие сбрасывает
 * его целиком: отзыв ссылки меняет и карточку пользователя, и список
 * виджетов, и журнал — выбирать, что из них устарело, дороже, чем перечитать.
 */
export const adminKeys = {
  all: ['admin'] as const,
  list: (resource: string, params: Params) => ['admin', 'list', resource, params] as const,
  user: (id: string) => ['admin', 'user', id] as const,
  invites: (roomId: string) => ['admin', 'invites', roomId] as const,
  stats: (range: AdminStatsRange) => ['admin', 'stats', range] as const,
};

/** Курсорный список: страницы подгружаются кнопкой, фильтры — новый ключ. */
export function useCursorList<T>(resource: string, params: Params, enabled = true) {
  const result = useInfiniteQuery({
    enabled,
    queryKey: adminKeys.list(resource, params),
    queryFn: ({ pageParam }) =>
      api.get<Page<T>>(`/admin/${resource}${query({ ...params, cursor: pageParam, limit: 50 })}`),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    // Смена фильтра не должна мигать пустой таблицей.
    placeholderData: keepPreviousData,
  });
  return {
    ...result,
    items: result.data?.pages.flatMap((page) => page.items) ?? [],
  };
}

export const useUsers = (params: Params) => useCursorList<AdminUserRow>('users', params);
export const useWidgets = (params: Params) => useCursorList<AdminWidget>('widgets', params);
export const useRooms = (params: Params) => useCursorList<AdminRoom>('rooms', params);
export const useChannels = (params: Params) => useCursorList<AdminChannel>('channels', params);
export const usePayments = (params: Params) => useCursorList<AdminPayment>('payments', params);
/** Журнал открыт только админу: у поддержки запрос не уходит вовсе. */
export const useAudit = (params: Params, enabled = true) =>
  useCursorList<AdminAuditEntry>('audit', params, enabled);

export function useUser(id: string) {
  return useQuery({
    queryKey: adminKeys.user(id),
    queryFn: () => api.get<AdminUserDetail>(`/admin/users/${id}`),
  });
}

export function useInvites(roomId: string, enabled: boolean) {
  return useQuery({
    queryKey: adminKeys.invites(roomId),
    queryFn: () => api.get<AdminInvite[]>(`/admin/rooms/${roomId}/invites`),
    enabled,
  });
}

export function useStats(range: AdminStatsRange) {
  return useQuery({
    queryKey: adminKeys.stats(range),
    queryFn: () => api.get<AdminStats>(`/admin/stats${query({ range })}`),
    placeholderData: keepPreviousData,
  });
}

/**
 * Действие сотрудника: запрос, сброс кэша админки, сообщение о результате.
 *
 * Ошибку показывает сам хук — текст сервера уже написан для человека
 * («Свою роль менять нельзя»), и повторять обработку в каждой кнопке незачем.
 */
export function useAdminAction<TInput>(
  run: (input: TInput) => Promise<unknown>,
  successMessage: string,
) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: run,
    onSuccess: async () => {
      toast.success(successMessage);
      await client.invalidateQueries({ queryKey: adminKeys.all });
    },
    onError: (error) => {
      toast.error(error instanceof ApiError ? error.message : i18n.t('common.error'));
    },
  });
}
