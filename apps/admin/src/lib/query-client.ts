import { QueryClient } from '@tanstack/react-query';

/**
 * Кэш админки. Данные сотрудник открывает, чтобы действовать по ним, поэтому
 * устаревают они быстрее, чем в дашборде: десять секунд, а не полминуты.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 10_000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});
