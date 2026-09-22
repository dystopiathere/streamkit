import { MAX_GUESTS_PER_ROOM, PAID_PLANS, type Plan, PLAN_PRICES } from '@streamkit/contracts';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import {
  buttonClasses,
  ButtonLink,
  Card,
  cn,
  Logo,
  MainContent,
  MenuButton,
  SkipLink,
  useCollapsibleMenu,
  usePageTitle,
} from '@streamkit/app-kit';
import { planFeatureList } from '@/features/billing/plan-features';
import { PublicFooter } from '@/features/public/PublicFooter';
import { TestCard } from '@/features/public/TestCard';
import { missingValue, useSeller } from '@/features/public/seller';
import { useAuthStore } from '@/lib/auth-store';
import { formatMoney } from '@/lib/locale';

/**
 * Возможности и полоса таблицы у каждой — та же, что у типа виджета в дашборде:
 * цвет, увиденный на главной, потом встречается в редакторе на том же месте.
 * У того, что виджетом не является (аналитика, ссылка OBS), полоса серая:
 * чужой цвет размыл бы правило «цвет = тип виджета».
 */
const FEATURES = [
  ['alerts', 'alerts'],
  ['widgets', 'goal'],
  ['chat', 'chat'],
  ['analytics', null],
  ['rooms', 'guests'],
  ['obs', null],
] as const;

/** Заголовок раздела главной — табличкой, как h1, но на ступень меньше. */
const SECTION_TITLE =
  'font-[family-name:var(--font-display)] text-2xl font-semibold tracking-wide uppercase';
const ANCHORS = ['pricing', 'delivery', 'contacts'] as const;
const MENU_ID = 'landing-menu';

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
  const menu = useCollapsibleMenu(MENU_ID);
  usePageTitle(undefined);

  return (
    <div className="flex min-h-screen flex-col">
      <SkipLink />
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2">
          <Link to="/" aria-label={t('nav.home')} className="mr-auto py-2">
            <Logo />
          </Link>
          {/* Вход и панель видны всегда: это главное действие на странице, и
              прятать его в меню ради трёх якорей — плохой обмен. */}
          <div className="order-2 sm:order-3">
            {signedIn ? (
              <ButtonLink to="/widgets">{t('public.openDashboard')}</ButtonLink>
            ) : (
              <ButtonLink to="/login" variant="secondary">
                {t('auth.submitLogin')}
              </ButtonLink>
            )}
          </div>
          <MenuButton menu={menu} className="order-3 sm:hidden" />
          <nav
            id={MENU_ID}
            aria-label={t('public.nav.label')}
            className={cn(
              menu.open ? 'block' : 'hidden',
              'order-4 w-full pb-2 sm:order-2 sm:block sm:w-auto sm:pb-0',
            )}
          >
            <ul className="flex flex-col gap-1 text-base sm:flex-row sm:text-sm">
              {ANCHORS.map((anchor) => (
                <li key={anchor}>
                  <a
                    href={`#${anchor}`}
                    onClick={menu.close}
                    className="block rounded-lg px-3 py-2.5 text-muted hover:bg-surface-hover hover:text-fg sm:py-1.5"
                  >
                    {t(`public.nav.${anchor}`)}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        </div>
      </header>

      <MainContent className="mx-auto w-full max-w-6xl flex-1 space-y-16 px-4 py-10 sm:space-y-24 sm:py-14">
        {/* Первый экран — тезис одним кадром: слева что это и куда нажать,
            справа испытательная таблица с настоящим оповещением в центре. */}
        <section
          aria-labelledby="hero-title"
          className="grid items-center gap-10 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]"
        >
          <div className="space-y-6">
            <h1
              id="hero-title"
              className="text-4xl leading-[1.05] text-balance sm:text-5xl lg:text-[3.5rem]"
            >
              {t('public.hero.title')}
            </h1>
            <p className="max-w-xl text-base text-muted sm:text-lg">{t('public.hero.lead')}</p>
            {signedIn ? (
              <ButtonLink to="/widgets" className="px-5 py-2.5 text-base">
                {t('public.openDashboard')}
              </ButtonLink>
            ) : (
              <div className="flex flex-wrap gap-3">
                <ButtonLink to="/register" className="px-5 py-2.5 text-base">
                  {t('public.hero.register')}
                </ButtonLink>
                <a href="#pricing" className={buttonClasses('secondary', 'px-5 py-2.5 text-base')}>
                  {t('public.hero.pricing')}
                </a>
              </div>
            )}
          </div>
          <TestCard />
        </section>

        {/* Программа, а не сетка одинаковых карточек: строки с полосой своего
            цвета читаются как список каналов, и тот же цвет стример потом
            встретит у типа виджета в дашборде. */}
        <section aria-labelledby="features" className="space-y-6">
          <h2 id="features" className={SECTION_TITLE}>
            {t('public.features.title')}
          </h2>
          <ul className="grid border-t border-border md:grid-cols-2 md:gap-x-10">
            {FEATURES.map(([feature, bar]) => (
              <li
                key={feature}
                className="grid grid-cols-[0.375rem_1fr] gap-x-4 border-b border-border py-5"
              >
                <span
                  aria-hidden="true"
                  className="row-span-2 mt-1 h-5 rounded-[1px]"
                  style={{
                    backgroundColor: bar ? `var(--color-bar-${bar})` : 'var(--color-border-strong)',
                  }}
                />
                <h3 className="font-medium">{t(`public.features.${feature}.title`)}</h3>
                <p className="mt-1 max-w-prose text-sm text-muted">
                  {t(`public.features.${feature}.text`)}
                </p>
              </li>
            ))}
          </ul>
        </section>

        <section id="pricing" aria-labelledby="pricing-title" className="scroll-mt-6 space-y-6">
          <h2 id="pricing-title" className={SECTION_TITLE}>
            {t('public.pricing.title')}
          </h2>
          {/* Состав тарифов — из PLAN_FEATURES: те же числа, что проверяет
              сервер. Отдельный текст на странице разошёлся бы с лимитом на
              первой же правке, и узнал бы об этом оплативший. */}
          <div className="grid gap-4 md:grid-cols-3">
            <Card className="space-y-3">
              <h3 className="font-medium">{t('billing.plans.free.name')}</h3>
              <p className={PRICE}>{formatMoney({ amountMinor: 0, currency: 'RUB' })}</p>
              <PlanFeatures plan="free" />
            </Card>
            {PAID_PLANS.map((plan) => (
              <Card key={plan} className={cn('space-y-3', plan === 'pro' && 'border-accent')}>
                <h3 className="font-medium">{t(`billing.plans.${plan}.name`)}</h3>
                <p className={PRICE}>
                  {t('public.pricing.month', {
                    amount: formatMoney(PLAN_PRICES[plan].month),
                  })}
                </p>
                <p className="text-sm tabular-nums">
                  {t('public.pricing.year', { amount: formatMoney(PLAN_PRICES[plan].year) })}
                </p>
                <PlanFeatures plan={plan} />
                {plan === 'pro' ? (
                  <p className="text-sm text-muted">
                    {t('public.pricing.pro.guests', { guests: MAX_GUESTS_PER_ROOM })}
                  </p>
                ) : null}
              </Card>
            ))}
          </div>
          <p className="text-xs text-muted">
            {t('public.pricing.note')}{' '}
            <Link to="/legal/subscription" className="underline hover:text-fg">
              {t('public.pricing.offer')}
            </Link>
          </p>
        </section>

        <section id="delivery" aria-labelledby="delivery-title" className="scroll-mt-6 space-y-3">
          <h2 id="delivery-title" className={SECTION_TITLE}>
            {t('public.delivery.title')}
          </h2>
          <ul className="max-w-3xl list-disc space-y-2 pl-5 text-sm">
            {(['digital', 'instant', 'term', 'requirements'] as const).map((item) => (
              <li key={item}>{t(`public.delivery.${item}`)}</li>
            ))}
          </ul>
        </section>

        <section id="payment" aria-labelledby="payment-title" className="scroll-mt-6 space-y-3">
          <h2 id="payment-title" className={SECTION_TITLE}>
            {t('public.payment.title')}
          </h2>
          <ul className="max-w-3xl list-disc space-y-2 pl-5 text-sm">
            {(['methods', 'card', 'renewal', 'refund'] as const).map((item) => (
              <li key={item}>{t(`public.payment.${item}`)}</li>
            ))}
          </ul>
        </section>

        <section id="contacts" aria-labelledby="contacts-title" className="scroll-mt-6 space-y-3">
          <h2 id="contacts-title" className={SECTION_TITLE}>
            {t('public.contacts.title')}
          </h2>
          {/* Только способ связи. Имя, статус и ИНН продавца стоят в подвале —
              он есть на каждой странице, и модерация ЮKassa смотрит туда же.
              На главной они дублировали подвал через два экрана прокрутки. */}
          <dl className="grid max-w-3xl gap-x-6 gap-y-2 text-sm sm:grid-cols-[max-content_1fr]">
            <dt className="text-muted">{t('public.contacts.email')}</dt>
            <dd>
              {seller.data?.email ? (
                <a href={`mailto:${seller.data.email}`} className="underline hover:text-fg">
                  {seller.data.email}
                </a>
              ) : (
                missingValue()
              )}
            </dd>
          </dl>
          <p className="text-xs text-muted">{t('public.contacts.requisites')}</p>
        </section>
      </MainContent>

      <PublicFooter />
    </div>
  );
}

/** Цена — узким гротеском, как цифры на табло: её ищут глазами первой. */
const PRICE = 'font-[family-name:var(--font-display)] text-4xl font-medium tabular-nums';

/** Состав тарифа списком. Те же строки, что на странице «Тариф» в дашборде. */
function PlanFeatures({ plan }: { plan: Plan }): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <ul className="space-y-1 text-sm text-muted">
      {planFeatureList(plan, t).map((feature) => (
        <li key={feature}>{feature}</li>
      ))}
    </ul>
  );
}
