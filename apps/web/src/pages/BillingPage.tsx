import {
  BILLING_PERIODS,
  type BillingPeriod,
  formatMoney,
  type Money,
  PLAN_PRICES,
  type SubscriptionView,
} from '@streamkit/contracts';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { Button, Card, cn } from '@/components/ui';
import {
  useCheckout,
  usePayments,
  useReturnedPayment,
  useSubscription,
  useUpdateSubscription,
} from '@/features/billing/queries';
import { ApiError } from '@/lib/api';

const formatDate = (iso: string): string =>
  new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });

/**
 * Тариф «Про»: оформление, автопродление, история платежей.
 *
 * Данные карты сюда не попадают вовсе: «Оплатить» уводит на страницу ЮKassa, и
 * возвращается стример уже с идентификатором платежа в адресе.
 */
export function BillingPage(): React.JSX.Element {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const subscription = useSubscription();
  const returned = useReturnedPayment(params.get('payment'));

  return (
    <div className="max-w-3xl space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">{t('billing.title')}</h1>
        <p className="text-sm text-muted">{t('billing.description')}</p>
      </div>

      {returned.data ? (
        <p
          role="status"
          className={cn(
            'rounded-lg border p-3 text-sm',
            returned.data.status === 'succeeded'
              ? 'border-success/40 bg-success/10'
              : returned.data.status === 'canceled'
                ? 'border-danger/40 bg-danger/10'
                : 'border-border bg-surface',
          )}
        >
          {t(`billing.returned.${returned.data.status}`)}
        </p>
      ) : null}

      {subscription.isLoading ? <p className="text-muted">{t('common.loading')}</p> : null}
      {subscription.data && !subscription.data.billingConfigured ? (
        <Card>
          <p className="text-sm text-muted">{t('billing.notConfigured')}</p>
        </Card>
      ) : null}
      {subscription.data?.billingConfigured ? (
        subscription.data.roomsAccess ? (
          <CurrentPlan subscription={subscription.data} />
        ) : (
          <Checkout expired={subscription.data.status === 'expired'} />
        )
      ) : null}

      <PaymentHistory />
    </div>
  );
}

function CurrentPlan({ subscription }: { subscription: SubscriptionView }): React.JSX.Element {
  const { t } = useTranslation();
  const update = useUpdateSubscription();
  const [renewConsent, setRenewConsent] = useState(false);

  const end = subscription.currentPeriodEnd ? formatDate(subscription.currentPeriodEnd) : '';
  const nextPeriod = subscription.period ?? 'month';

  const handleError = (error: unknown): void => {
    toast.error(error instanceof ApiError ? error.message : t('common.error'));
  };

  return (
    <Card className="space-y-4">
      <div className="space-y-1">
        <h2 className="font-medium">{t('billing.plan.name')}</h2>
        <p data-testid="subscription-status" className="text-sm">
          {subscription.status === 'grace'
            ? t('billing.status.grace', { date: end })
            : subscription.autoRenew
              ? t('billing.status.renews', { date: end })
              : t('billing.status.endsOn', { date: end })}
        </p>
        {subscription.paymentMethodTitle ? (
          <p className="text-xs text-muted">
            {t('billing.paymentMethod', { title: subscription.paymentMethodTitle })}
          </p>
        ) : null}
      </div>

      {subscription.autoRenew ? (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-muted">{t('billing.nextPeriod')}</span>
            {BILLING_PERIODS.map((period) => (
              <Button
                key={period}
                variant={period === nextPeriod ? 'secondary' : 'ghost'}
                aria-pressed={period === nextPeriod}
                onClick={() =>
                  period === nextPeriod
                    ? undefined
                    : update.mutate({ period }, { onError: handleError })
                }
              >
                {t(`billing.period.${period}`)} ·{' '}
                {/* У текущего периода — цена подписки: у оформивших раньше она
                    может отличаться от прайса, и списана будет именно она. */}
                {formatMoney(
                  period === nextPeriod && subscription.renewalAmount
                    ? subscription.renewalAmount
                    : PLAN_PRICES[period],
                )}
              </Button>
            ))}
          </div>
          <Button
            variant="ghost"
            isLoading={update.isPending}
            onClick={() => update.mutate({ autoRenew: false }, { onError: handleError })}
          >
            {t('billing.disableAutoRenew')}
          </Button>
          <p className="text-xs text-muted">{t('billing.disableAutoRenewHint')}</p>
        </div>
      ) : subscription.paymentMethodTitle ? (
        <div className="space-y-3">
          <OfferConsent
            checked={renewConsent}
            onChange={setRenewConsent}
            period={nextPeriod}
            amount={subscription.renewalAmount ?? undefined}
          />
          <Button
            variant="secondary"
            disabled={!renewConsent}
            isLoading={update.isPending}
            onClick={() =>
              update.mutate({ autoRenew: true, acceptOffer: true }, { onError: handleError })
            }
          >
            {t('billing.enableAutoRenew')}
          </Button>
        </div>
      ) : null}
    </Card>
  );
}

function Checkout({ expired }: { expired: boolean }): React.JSX.Element {
  const { t } = useTranslation();
  const checkout = useCheckout();
  const [period, setPeriod] = useState<BillingPeriod>('month');
  const [accepted, setAccepted] = useState(false);

  const handlePay = async (): Promise<void> => {
    try {
      const result = await checkout.mutateAsync(period);
      // Уход со страницы: данные карты вводятся у ЮKassa, а не у нас.
      window.location.assign(result.confirmationUrl);
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : t('common.error'));
    }
  };

  return (
    <Card className="space-y-5">
      <div className="space-y-1">
        <h2 className="font-medium">{t('billing.plan.name')}</h2>
        <p className="text-sm text-muted">
          {expired ? t('billing.status.expired') : t('billing.plan.includes')}
        </p>
      </div>

      <fieldset className="grid gap-3 sm:grid-cols-2">
        <legend className="sr-only">{t('billing.choosePeriod')}</legend>
        {BILLING_PERIODS.map((option) => (
          <label
            key={option}
            className="flex cursor-pointer items-start gap-3 rounded-lg border border-border p-4 has-[:checked]:border-accent"
          >
            <input
              type="radio"
              name="billing-period"
              className="mt-1 h-4 w-4 shrink-0"
              checked={period === option}
              onChange={() => setPeriod(option)}
            />
            <span>
              <span className="block font-medium">{t(`billing.period.${option}`)}</span>
              <span className="block text-lg tabular-nums">{formatMoney(PLAN_PRICES[option])}</span>
              <span className="block text-xs text-muted">{t(`billing.periodHint.${option}`)}</span>
            </span>
          </label>
        ))}
      </fieldset>

      <OfferConsent checked={accepted} onChange={setAccepted} period={period} />

      <Button onClick={() => void handlePay()} disabled={!accepted} isLoading={checkout.isPending}>
        {t('billing.pay', { amount: formatMoney(PLAN_PRICES[period]) })}
      </Button>
    </Card>
  );
}

/**
 * Согласие с офертой и автоматическими списаниями.
 *
 * Сумма и периодичность — в самом тексте флажка, а не только в оферте по ссылке:
 * согласие на «регулярные списания» без суммы — согласие ни на что.
 */
function OfferConsent({
  checked,
  onChange,
  period,
  amount = PLAN_PRICES[period],
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  period: BillingPeriod;
  /** Сумма списаний. У действующей подписки — её цена, а не прайс. */
  amount?: Money;
}): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <label className="flex items-start gap-2 text-sm" htmlFor="billing-offer">
      <input
        id="billing-offer"
        type="checkbox"
        className="mt-0.5 h-4 w-4 shrink-0"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span>
        {t('billing.offer.accept')}{' '}
        <Link to="/legal/subscription" target="_blank" className="underline">
          {t('billing.offer.link')}
        </Link>
        <span className="mt-1 block text-xs text-muted">
          {t(`billing.offer.recurring.${period}`, { amount: formatMoney(amount) })}
        </span>
      </span>
    </label>
  );
}

function PaymentHistory(): React.JSX.Element | null {
  const { t } = useTranslation();
  const payments = usePayments();
  if (!payments.data?.length) return null;

  return (
    <Card className="space-y-3">
      <h2 className="font-medium">{t('billing.history.title')}</h2>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-muted">
            <tr>
              <th className="py-2 pr-4 font-normal">{t('billing.history.date')}</th>
              <th className="py-2 pr-4 font-normal">{t('billing.history.what')}</th>
              <th className="py-2 pr-4 text-right font-normal">{t('billing.history.amount')}</th>
              <th className="py-2 font-normal">{t('billing.history.status')}</th>
            </tr>
          </thead>
          <tbody>
            {payments.data.map((payment) => (
              <tr key={payment.id} className="border-t border-border">
                <td className="py-2 pr-4 whitespace-nowrap">{formatDate(payment.createdAt)}</td>
                <td className="py-2 pr-4">
                  {t(`billing.history.kind.${payment.kind}`)} ·{' '}
                  {t(`billing.period.${payment.period}`)}
                </td>
                <td className="py-2 pr-4 text-right tabular-nums">{formatMoney(payment)}</td>
                <td
                  className={cn(
                    'py-2',
                    payment.status === 'succeeded' && 'text-success',
                    payment.status === 'canceled' && 'text-muted',
                  )}
                >
                  {t(`billing.history.state.${payment.status}`)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
