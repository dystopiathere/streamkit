import {
  BILLING_PERIODS,
  type BillingPeriod,
  type Money,
  PAID_PLANS,
  type PaidPlan,
  PLAN_PRICES,
  type SubscriptionView,
} from '@streamkit/contracts';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { Button, Card, cn, NewTabHint, usePageTitle } from '@streamkit/app-kit';
import {
  useCheckout,
  usePayments,
  useReturnedPayment,
  useSubscription,
  useRemovePaymentMethod,
  useUpdateSubscription,
} from '@/features/billing/queries';
import { planFeatureList } from '@/features/billing/plan-features';
import { trackSiteEvent } from '@/features/public/site-stats';
import { ApiError } from '@/lib/api';
import { useCurrentUser } from '@/lib/auth-store';
import { formatMoney, intlLocale } from '@/lib/locale';

const formatDate = (iso: string): string =>
  new Date(iso).toLocaleDateString(intlLocale(), {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

/**
 * Тарифы: оформление, смена, автопродление, история платежей.
 *
 * Данные карты сюда не попадают вовсе: «Оплатить» уводит на страницу ЮKassa, и
 * возвращается стример уже с идентификатором платежа в адресе.
 */
export function BillingPage(): React.JSX.Element {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const subscription = useSubscription();
  const returned = useReturnedPayment(params.get('payment'));
  usePageTitle(t('billing.title'));

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

      {subscription.isLoading ? (
        <p role="status" className="text-muted">
          {t('common.loading')}
        </p>
      ) : null}
      {subscription.data && !subscription.data.billingConfigured ? (
        <Card>
          <p className="text-sm text-muted">{t('billing.notConfigured')}</p>
        </Card>
      ) : null}
      {subscription.data?.billingConfigured ? (
        subscription.data.plan === 'free' ? (
          <Checkout mode={subscription.data.status === 'expired' ? 'expired' : 'new'} />
        ) : (
          <>
            <CurrentPlan subscription={subscription.data} />
            {/* Списание не прошло: другой картой платят тем же оформлением, и
                она заменяет сохранённую. Сменить карту без оплаты периода
                нельзя — это отдельный путь у ЮKassa. */}
            {subscription.data.status === 'grace' ? (
              <Checkout
                mode="replaceCard"
                initialPlan={subscription.data.nextPlan ?? subscription.data.plan}
                initialPeriod={subscription.data.period ?? 'month'}
              />
            ) : null}
          </>
        )
      ) : null}

      <PaymentHistory />
    </div>
  );
}

function CurrentPlan({ subscription }: { subscription: SubscriptionView }): React.JSX.Element {
  const { t } = useTranslation();
  const update = useUpdateSubscription();
  const removeMethod = useRemovePaymentMethod();
  const [renewConsent, setRenewConsent] = useState(false);

  const end = subscription.currentPeriodEnd ? formatDate(subscription.currentPeriodEnd) : '';
  const nextPeriod = subscription.period ?? 'month';
  const nextPlan = subscription.nextPlan ?? 'pro';

  const handleError = (error: unknown): void => {
    toast.error(error instanceof ApiError ? error.message : t('common.error'));
  };

  return (
    <Card className="space-y-4">
      <div className="space-y-1">
        <h2 className="font-medium">{t(`billing.plans.${subscription.plan}.name`)}</h2>
        <ul className="text-xs text-muted">
          {planFeatureList(subscription.plan, t).map((feature) => (
            <li key={feature}>{feature}</li>
          ))}
        </ul>
        <p data-testid="subscription-status" className="text-sm">
          {subscription.status === 'grace'
            ? t('billing.status.grace', { date: end })
            : subscription.autoRenew
              ? t('billing.status.renews', { date: end })
              : t('billing.status.endsOn', { date: end })}
        </p>
        {subscription.paymentMethodTitle ? (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <p className="text-xs text-muted">
              {t('billing.paymentMethod', { title: subscription.paymentMethodTitle })}
            </p>
            {/* Отвязка — у самого способа оплаты, а не среди настроек продления:
                это другое действие. Выключить автопродление можно и не
                отвязывая карту, а отвязанную вернуть только новой оплатой. */}
            <Button
              variant="ghost"
              className="px-2 py-1 text-xs"
              isLoading={removeMethod.isPending}
              aria-label={t('billing.removeMethodNamed', {
                title: subscription.paymentMethodTitle,
              })}
              onClick={() => {
                if (!window.confirm(t('billing.removeMethodConfirm', { date: end }))) return;
                removeMethod.mutate(undefined, {
                  onSuccess: () => toast.success(t('billing.removeMethodDone')),
                  onError: handleError,
                });
              }}
            >
              {t('billing.removeMethod')}
            </Button>
          </div>
        ) : null}
      </div>

      {subscription.autoRenew ? (
        <div className="space-y-3">
          {/* Смена тарифа применяется при продлении: доплат и пересчёта
              остатка нет, доступ до конца оплаченного периода не меняется. */}
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-muted">{t('billing.nextPlan')}</span>
            {PAID_PLANS.map((plan) => (
              <Button
                key={plan}
                variant={plan === nextPlan ? 'secondary' : 'ghost'}
                aria-pressed={plan === nextPlan}
                onClick={() =>
                  plan === nextPlan ? undefined : update.mutate({ plan }, { onError: handleError })
                }
              >
                {t(`billing.plans.${plan}.name`)} · {formatMoney(PLAN_PRICES[plan][nextPeriod])}
              </Button>
            ))}
          </div>
          {nextPlan !== subscription.plan ? (
            <p className="text-xs text-muted">
              {t('billing.planChanges', {
                plan: t(`billing.plans.${nextPlan}.name`),
                date: end,
              })}
            </p>
          ) : null}
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
                    : PLAN_PRICES[nextPlan][period],
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
            amount={subscription.renewalAmount ?? PLAN_PRICES[nextPlan][nextPeriod]}
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

/**
 * Оформление тарифа.
 *
 * `replaceCard` — оплата следующего периода другой картой в льготные дни,
 * когда списание по сохранённой не прошло. Это то же оформление: сервер до
 * оплаты подписку не меняет, а успешный платёж сохраняет новую карту.
 */
function Checkout({
  mode,
  initialPlan = 'pro',
  initialPeriod = 'month',
}: {
  mode: 'new' | 'expired' | 'replaceCard';
  initialPlan?: PaidPlan;
  initialPeriod?: BillingPeriod;
}): React.JSX.Element {
  const { t } = useTranslation();
  const checkout = useCheckout();
  const user = useCurrentUser();
  // Сервер откажет и сам (403), но кнопка «Оплатить», которая ведёт к отказу,
  // хуже честного «сначала подтвердите почту» на её месте.
  const emailVerified = user?.emailVerified ?? true;
  const [plan, setPlan] = useState<PaidPlan>(initialPlan);
  const [period, setPeriod] = useState<BillingPeriod>(initialPeriod);
  const [accepted, setAccepted] = useState(false);

  const handlePay = async (): Promise<void> => {
    try {
      const result = await checkout.mutateAsync({ plan, period });
      trackSiteEvent('checkout');
      // Уход со страницы: данные карты вводятся у ЮKassa, а не у нас.
      window.location.assign(result.confirmationUrl);
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : t('common.error'));
    }
  };

  return (
    <Card className="space-y-5">
      <div className="space-y-1">
        <h2 className="font-medium">
          {mode === 'replaceCard' ? t('billing.replaceCard.title') : t('billing.choosePlan')}
        </h2>
        <p className="text-sm text-muted">
          {mode === 'replaceCard'
            ? t('billing.replaceCard.hint')
            : mode === 'expired'
              ? t('billing.status.expired')
              : t('billing.freeIncludes')}
        </p>
      </div>

      {/* Тариф — радиокнопками, а не двумя кнопками «оплатить»: выбор тарифа и
          выбор периода это один выбор из четырёх цен, и цена на кнопке внизу
          должна соответствовать обоим. */}
      <fieldset className="grid gap-3 sm:grid-cols-2">
        <legend className="sr-only">{t('billing.choosePlan')}</legend>
        {PAID_PLANS.map((option) => (
          <label
            key={option}
            className="flex items-start gap-3 rounded-lg border border-border-strong p-4 has-[:checked]:border-fg has-[:checked]:bg-surface-hover has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent"
          >
            <input
              type="radio"
              name="billing-plan"
              className="mt-1 h-4 w-4 shrink-0"
              checked={plan === option}
              onChange={() => setPlan(option)}
            />
            <span>
              <span className="block font-medium">{t(`billing.plans.${option}.name`)}</span>
              <span className="block text-lg tabular-nums">
                {t('billing.perMonth', { amount: formatMoney(PLAN_PRICES[option].month) })}
              </span>
              <ul className="mt-1 space-y-0.5 text-xs text-muted">
                {planFeatureList(option, t).map((feature) => (
                  <li key={feature}>{feature}</li>
                ))}
              </ul>
            </span>
          </label>
        ))}
      </fieldset>

      <fieldset className="grid gap-3 sm:grid-cols-2">
        <legend className="sr-only">{t('billing.choosePeriod')}</legend>
        {BILLING_PERIODS.map((option) => (
          <label
            key={option}
            className="flex items-start gap-3 rounded-lg border border-border-strong p-4 has-[:checked]:border-fg has-[:checked]:bg-surface-hover has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent"
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
              <span className="block text-lg tabular-nums">
                {formatMoney(PLAN_PRICES[plan][option])}
              </span>
              <span className="block text-xs text-muted">{t(`billing.periodHint.${option}`)}</span>
            </span>
          </label>
        ))}
      </fieldset>

      <OfferConsent
        checked={accepted}
        onChange={setAccepted}
        period={period}
        amount={PLAN_PRICES[plan][period]}
      />

      {emailVerified ? null : (
        <p
          role="status"
          className="rounded-lg border border-border-strong bg-surface-hover p-3 text-sm"
        >
          {t('emailVerification.billing', { email: user?.email })}
        </p>
      )}

      <Button
        onClick={() => void handlePay()}
        disabled={!accepted || !emailVerified}
        isLoading={checkout.isPending}
      >
        {t('billing.pay', { amount: formatMoney(PLAN_PRICES[plan][period]) })}
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
  amount,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  period: BillingPeriod;
  /** Сумма списаний. У действующей подписки — её цена, а не прайс. */
  amount: Money;
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
          <NewTabHint />
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
      <div className="overflow-x-auto overflow-y-hidden">
        <table className="w-full text-sm">
          <caption className="sr-only">{t('billing.history.title')}</caption>
          <thead className="text-left text-xs text-muted">
            <tr>
              <th scope="col" className="py-2 pr-4 font-normal">
                {t('billing.history.date')}
              </th>
              <th scope="col" className="py-2 pr-4 font-normal">
                {t('billing.history.what')}
              </th>
              <th scope="col" className="py-2 pr-4 text-right font-normal">
                {t('billing.history.amount')}
              </th>
              <th scope="col" className="py-2 font-normal">
                {t('billing.history.status')}
              </th>
            </tr>
          </thead>
          <tbody>
            {payments.data.map((payment) => (
              <tr key={payment.id} className="border-t border-border">
                <td className="py-2 pr-4 whitespace-nowrap">{formatDate(payment.createdAt)}</td>
                <td className="py-2 pr-4">
                  {t(`billing.plans.${payment.plan}.name`)} ·{' '}
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
                  {payment.refundedAmountMinor > 0 ? (
                    <span className="block text-xs text-muted">
                      {t('billing.history.refunded', {
                        amount: formatMoney({
                          amountMinor: payment.refundedAmountMinor,
                          currency: payment.currency,
                        }),
                      })}
                    </span>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
