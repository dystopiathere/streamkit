import type {
  CheckoutInput,
  CheckoutResult,
  PaymentView,
  SubscriptionView,
  UpdateSubscriptionInput,
} from '@streamkit/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { api } from '@/lib/api';

export const billingKeys = {
  all: ['billing'] as const,
  subscription: ['billing', 'subscription'] as const,
  payments: ['billing', 'payments'] as const,
  // Не под 'payments': сброс истории платежей по префиксу задевал бы и этот
  // запрос — и отменял бы его прямо посреди выполнения.
  returned: (id: string) => ['billing', 'returned', id] as const,
};

export function useSubscription() {
  return useQuery({
    queryKey: billingKeys.subscription,
    queryFn: () => api.get<SubscriptionView>('/billing/subscription'),
  });
}

export function usePayments() {
  return useQuery({
    queryKey: billingKeys.payments,
    queryFn: () => api.get<PaymentView[]>('/billing/payments'),
  });
}

/** Сколько ждём подтверждения оплаты после возврата со страницы ЮKassa. */
const PAYMENT_POLL_MS = 2_000;
const PAYMENT_POLL_LIMIT = 30;

/**
 * Платёж, с оплаты которого вернулся стример.
 *
 * Уведомление ЮKassa может прийти позже возврата браузера, поэтому опрашиваем,
 * пока платёж в ожидании, — но не дольше минуты: дальше честное «оплата ещё
 * обрабатывается», а не бесконечный спиннер.
 */
export function useReturnedPayment(id: string | null) {
  const client = useQueryClient();
  const query = useQuery({
    queryKey: billingKeys.returned(id ?? ''),
    enabled: Boolean(id),
    queryFn: () => api.get<PaymentView>(`/billing/payments/${id}`),
    refetchInterval: (query) =>
      query.state.data?.status === 'pending' && query.state.dataUpdateCount < PAYMENT_POLL_LIMIT
        ? PAYMENT_POLL_MS
        : false,
  });

  // Платёж закрылся — подписка и история на странице уже устарели.
  const settled = query.data && query.data.status !== 'pending' ? query.data.status : null;
  useEffect(() => {
    if (!settled) return;
    void client.invalidateQueries({ queryKey: billingKeys.subscription });
    void client.invalidateQueries({ queryKey: billingKeys.payments, exact: true });
  }, [client, settled]);

  return query;
}

export function useCheckout() {
  return useMutation({
    mutationFn: (input: Omit<CheckoutInput, 'acceptOffer'>) =>
      api.post<CheckoutResult>('/billing/checkout', { ...input, acceptOffer: true }),
  });
}

/**
 * Отвязать сохранённый способ оплаты. Автопродление выключается вместе с ним, и
 * согласие на списания в журнале отзывается — раздел «Приватность» это покажет.
 */
export function useRemovePaymentMethod() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => api.delete<SubscriptionView>('/billing/payment-method'),
    onSuccess: (subscription) => {
      client.setQueryData(billingKeys.subscription, subscription);
      void client.invalidateQueries({ queryKey: ['privacy', 'consents'] });
    },
  });
}

export function useUpdateSubscription() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateSubscriptionInput) =>
      api.patch<SubscriptionView>('/billing/subscription', input),
    onSuccess: (subscription) => {
      client.setQueryData(billingKeys.subscription, subscription);
      // Автопродление — это ещё и согласие на списания в журнале.
      void client.invalidateQueries({ queryKey: ['privacy', 'consents'] });
    },
  });
}
