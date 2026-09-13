import type {
  AlertEvent,
  CreatedOverlayToken,
  CreateWidgetInput,
  OverlayTokenView,
  Page,
  UpdateWidgetInput,
  Widget,
  WidgetState,
  WidgetStateCommand,
} from '@streamkit/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

export const widgetKeys = {
  all: ['widgets'] as const,
  detail: (id: string) => ['widgets', id] as const,
  tokens: (id: string) => ['widgets', id, 'tokens'] as const,
  state: (id: string) => ['widgets', id, 'state'] as const,
};

export function useWidgets() {
  return useQuery({
    queryKey: widgetKeys.all,
    queryFn: () => api.get<Widget[]>('/widgets'),
  });
}

export function useWidget(id: string) {
  return useQuery({
    queryKey: widgetKeys.detail(id),
    queryFn: () => api.get<Widget>(`/widgets/${id}`),
  });
}

export function useCreateWidget() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateWidgetInput) => api.post<Widget>('/widgets', input),
    onSuccess: () => client.invalidateQueries({ queryKey: widgetKeys.all }),
  });
}

export function useUpdateWidget(id: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateWidgetInput) => api.patch<Widget>(`/widgets/${id}`, input),
    onSuccess: (widget) => {
      // Обновляем кэш ответом сервера, а не тем, что отправили: бэкенд мержит
      // частичный конфиг с сохранённым и досыпает дефолты.
      client.setQueryData(widgetKeys.detail(id), widget);
      void client.invalidateQueries({ queryKey: widgetKeys.all });
    },
  });
}

/** Состояние виджета: собранная сумма, остаток таймера, топ. */
export function useWidgetState(id: string, enabled: boolean) {
  return useQuery({
    queryKey: widgetKeys.state(id),
    queryFn: () => api.get<WidgetState | null>(`/widgets/${id}/state`),
    enabled,
  });
}

export function useWidgetCommand(id: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (command: WidgetStateCommand) =>
      api.patch<WidgetState | null>(`/widgets/${id}/state`, command),
    // Ответ уже содержит пересчитанное состояние — второй запрос не нужен.
    onSuccess: (state) => client.setQueryData(widgetKeys.state(id), state),
  });
}

export function useDeleteWidget() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete<void>(`/widgets/${id}`),
    onSuccess: () => client.invalidateQueries({ queryKey: widgetKeys.all }),
  });
}

export function useOverlayTokens(widgetId: string) {
  return useQuery({
    queryKey: widgetKeys.tokens(widgetId),
    queryFn: () => api.get<OverlayTokenView[]>(`/widgets/${widgetId}/tokens`),
  });
}

export function useCreateOverlayToken(widgetId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (label: string | null) =>
      api.post<CreatedOverlayToken>(`/widgets/${widgetId}/tokens`, { label }),
    onSuccess: () => client.invalidateQueries({ queryKey: widgetKeys.tokens(widgetId) }),
  });
}

export function useRevokeOverlayToken(widgetId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (tokenId: string) => api.delete<void>(`/widgets/${widgetId}/tokens/${tokenId}`),
    onSuccess: () => client.invalidateQueries({ queryKey: widgetKeys.tokens(widgetId) }),
  });
}

export function useSendTestAlert() {
  return useMutation({
    mutationFn: () => api.post<AlertEvent>('/events/test'),
  });
}

/**
 * Последние события.
 *
 * Перезапрашиваются при каждом открытии вкладки, в отличие от остальных данных
 * дашборда (там `staleTime` тридцать секунд). Живая подписка на новые события
 * работает, только пока вкладка «События» открыта, — а тестовый алерт
 * отправляется со страницы виджетов, и настоящие донаты приходят, пока стример
 * смотрит куда угодно. С общим `staleTime` история, закэшированная до этого,
 * ещё полминуты считалась свежей, и событие было видно только после
 * перезагрузки страницы.
 */
export function useRecentEvents() {
  return useQuery({
    queryKey: ['events'],
    queryFn: () => api.get<Page<AlertEvent>>('/events?limit=20'),
    staleTime: 0,
  });
}
