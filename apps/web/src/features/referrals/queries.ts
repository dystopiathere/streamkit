import type { ReferralOverview } from '@streamkit/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { billingKeys } from '@/features/billing/queries';
import { api } from '@/lib/api';

export const referralKeys = {
  overview: ['referrals'] as const,
};

export function useReferrals() {
  return useQuery({
    queryKey: referralKeys.overview,
    queryFn: () => api.get<ReferralOverview>('/referrals'),
  });
}

/**
 * Включить накопленные дни. Меняет и тариф: «Про» открывается сразу, а конец
 * оплаченного периода сдвигается — поэтому подписка перечитывается тоже.
 */
export function useActivateReferralDays() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (days: number) => api.post<ReferralOverview>('/referrals/activate', { days }),
    onSuccess: (overview) => {
      client.setQueryData(referralKeys.overview, overview);
      void client.invalidateQueries({ queryKey: billingKeys.subscription });
    },
  });
}
