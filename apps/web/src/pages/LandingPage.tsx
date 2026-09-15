import { formatMoney, MAX_GUESTS_PER_ROOM, PLAN_PRICES } from '@streamkit/contracts';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Button, Card } from '@/components/ui';
import { PublicFooter } from '@/features/public/PublicFooter';
import { MISSING, useSeller } from '@/features/public/seller';
import { useAuthStore } from '@/lib/auth-store';

const FEATURES = ['alerts', 'widgets', 'chat', 'analytics', 'rooms', 'obs'] as const;

/**
 * Главная: что это за сервис, сколько стоит, как его получить и кто продаёт.
 *
 * Открыта без входа и собрана под проверку ЮKassa перед подключением оплаты:
 * услуга с ценой, порядок получения (цифровая услуга, доставки нет), оплата и
 * возврат, оферта и реквизиты продавца. Каждый раздел — ответ на пункт этой
 * проверки, поэтому у разделов якоря: на них удобно сослаться в заявке.
 */
export function LandingPage(): React.JSX.Element {
  const { t } = useTranslation();
  const signedIn = useAuthStore((state) => Boolean(state.accessToken));
  const seller = useSeller();

  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <span className="font-semibold tracking-tight">StreamKit</span>
          <nav className="flex flex-wrap items-center gap-1 text-sm">
            <a href="#pricing" className="rounded-lg px-3 py-1.5 text-muted hover:text-fg">
              {t('public.nav.pricing')}
            </a>
            <a href="#delivery" className="rounded-lg px-3 py-1.5 text-muted hover:text-fg">
              {t('public.nav.delivery')}
            </a>
            <a href="#contacts" className="rounded-lg px-3 py-1.5 text-muted hover:text-fg">
              {t('public.nav.contacts')}
            </a>
            {signedIn ? (
              <Link to="/widgets">
                <Button>{t('public.openDashboard')}</Button>
              </Link>
            ) : (
              <Link to="/login">
                <Button variant="secondary">{t('auth.submitLogin')}</Button>
              </Link>
            )}
          </nav>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 space-y-16 px-4 py-12">
        <section className="max-w-3xl space-y-4">
          <h1 className="text-3xl font-semibold text-balance sm:text-4xl">
            {t('public.hero.title')}
          </h1>
          <p className="text-lg text-muted">{t('public.hero.lead')}</p>
          {signedIn ? null : (
            <div className="flex flex-wrap gap-3">
              <Link to="/register">
                <Button>{t('public.hero.register')}</Button>
              </Link>
              <a href="#pricing">
                <Button variant="ghost">{t('public.hero.pricing')}</Button>
              </a>
            </div>
          )}
        </section>

        <section aria-labelledby="features" className="space-y-4">
          <h2 id="features" className="text-xl font-semibold">
            {t('public.features.title')}
          </h2>
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((feature) => (
              <li key={feature} className="rounded-lg border border-border p-4">
                <p className="font-medium">{t(`public.features.${feature}.title`)}</p>
                <p className="mt-1 text-sm text-muted">{t(`public.features.${feature}.text`)}</p>
              </li>
            ))}
          </ul>
        </section>

        <section id="pricing" aria-labelledby="pricing-title" className="scroll-mt-6 space-y-4">
          <h2 id="pricing-title" className="text-xl font-semibold">
            {t('public.pricing.title')}
          </h2>
          <div className="grid gap-4 md:grid-cols-2">
            <Card className="space-y-3">
              <p className="font-medium">{t('public.pricing.free.name')}</p>
              <p className="text-3xl tabular-nums">
                {formatMoney({ amountMinor: 0, currency: 'RUB' })}
              </p>
              <p className="text-sm text-muted">{t('public.pricing.free.text')}</p>
            </Card>
            <Card className="space-y-3 border-accent/60">
              <p className="font-medium">{t('public.pricing.pro.name')}</p>
              <p className="text-3xl tabular-nums">
                {t('public.pricing.pro.month', { amount: formatMoney(PLAN_PRICES.month) })}
              </p>
              <p className="text-sm tabular-nums">
                {t('public.pricing.pro.year', { amount: formatMoney(PLAN_PRICES.year) })}
              </p>
              <p className="text-sm text-muted">
                {t('public.pricing.pro.text', { guests: MAX_GUESTS_PER_ROOM })}
              </p>
            </Card>
          </div>
          <p className="text-xs text-muted">
            {t('public.pricing.note')}{' '}
            <Link to="/legal/subscription" className="underline hover:text-fg">
              {t('public.pricing.offer')}
            </Link>
          </p>
        </section>

        <section id="delivery" aria-labelledby="delivery-title" className="scroll-mt-6 space-y-3">
          <h2 id="delivery-title" className="text-xl font-semibold">
            {t('public.delivery.title')}
          </h2>
          <ul className="max-w-3xl list-disc space-y-2 pl-5 text-sm">
            {(['digital', 'instant', 'term', 'requirements'] as const).map((item) => (
              <li key={item}>{t(`public.delivery.${item}`)}</li>
            ))}
          </ul>
        </section>

        <section id="payment" aria-labelledby="payment-title" className="scroll-mt-6 space-y-3">
          <h2 id="payment-title" className="text-xl font-semibold">
            {t('public.payment.title')}
          </h2>
          <ul className="max-w-3xl list-disc space-y-2 pl-5 text-sm">
            {(['methods', 'card', 'renewal', 'refund'] as const).map((item) => (
              <li key={item}>{t(`public.payment.${item}`)}</li>
            ))}
          </ul>
        </section>

        <section id="contacts" aria-labelledby="contacts-title" className="scroll-mt-6 space-y-3">
          <h2 id="contacts-title" className="text-xl font-semibold">
            {t('public.contacts.title')}
          </h2>
          <dl className="grid max-w-3xl gap-x-6 gap-y-2 text-sm sm:grid-cols-[max-content_1fr]">
            <dt className="text-muted">{t('public.contacts.seller')}</dt>
            <dd>{seller.data?.name ?? MISSING}</dd>
            <dt className="text-muted">{t('public.contacts.status')}</dt>
            <dd>{t('public.contacts.selfEmployed')}</dd>
            <dt className="text-muted">{t('public.contacts.inn')}</dt>
            <dd className="tabular-nums">{seller.data?.inn ?? MISSING}</dd>
            <dt className="text-muted">{t('public.contacts.email')}</dt>
            <dd>
              {seller.data?.email ? (
                <a href={`mailto:${seller.data.email}`} className="underline hover:text-fg">
                  {seller.data.email}
                </a>
              ) : (
                MISSING
              )}
            </dd>
            {seller.data?.phone ? (
              <>
                <dt className="text-muted">{t('public.contacts.phone')}</dt>
                <dd>{seller.data.phone}</dd>
              </>
            ) : null}
          </dl>
        </section>
      </main>

      <PublicFooter />
    </div>
  );
}
