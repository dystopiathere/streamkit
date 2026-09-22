import {
  MAX_GUESTS_PER_ROOM,
  type Money,
  PAID_PLANS,
  type Plan,
  PLAN_PRICES,
  formatMoney,
} from '@streamkit/contracts';
import type { TFunction } from 'i18next';
// Относительный путь с расширением, а не `@/`: файл импортирует конфиг Vite
// (`vite/seo-plugin.ts`), а при загрузке конфига алиасов ещё нет — сборка падает
// на «module not found». Расширение требует нативный загрузчик конфига.
import { planFeatureList } from '../billing/plan-features.ts';

/**
 * Статический снимок главной — для роботов, которые не исполняют JavaScript.
 *
 * SPA отдаёт на любой адрес пустой `<div id="root">`, и робот без скриптов видит
 * страницу без единого слова: ни что это за сервис, ни цен. Снимок кладётся в
 * `landing.html` при сборке (`vite/seo-plugin.ts`), nginx отдаёт его на `/`, а
 * React при запуске заменяет его живой страницей.
 *
 * Текст — те же строки словаря и цены из `PLAN_PRICES`, что у `LandingPage`:
 * отдельная копия разошлась бы с живой страницей на первой правке, и поисковик
 * показывал бы не ту цену. Классы — те же, что у живой страницы: до запуска
 * скрипта человек видит тот же текст почти в той же вёрстке.
 */
export function landingSnapshot(t: TFunction): string {
  const features = (['alerts', 'widgets', 'chat', 'analytics', 'rooms', 'obs'] as const)
    .map(
      (feature) =>
        `<li class="border-b border-border py-5"><h3 class="font-medium">${text(t(`public.features.${feature}.title`))}</h3>` +
        `<p class="mt-1 max-w-prose text-sm text-muted">${text(t(`public.features.${feature}.text`))}</p></li>`,
    )
    .join('');

  const plans = (['free', ...PAID_PLANS] as Plan[])
    .map((plan) => {
      const price =
        plan === 'free'
          ? text(money({ amountMinor: 0, currency: 'RUB' }))
          : text(t('public.pricing.month', { amount: money(PLAN_PRICES[plan].month) })) +
            `</p><p class="text-sm tabular-nums">${text(
              t('public.pricing.year', { amount: money(PLAN_PRICES[plan].year) }),
            )}`;
      const extras = planFeatureList(plan, t)
        .concat(
          plan === 'pro' ? [t('public.pricing.pro.guests', { guests: MAX_GUESTS_PER_ROOM })] : [],
        )
        .map((feature) => `<li>${text(feature)}</li>`)
        .join('');
      return (
        `<div class="space-y-3 rounded-lg border border-border p-4"><h3 class="font-medium">${text(t(`billing.plans.${plan}.name`))}</h3>` +
        `<p class="text-2xl tabular-nums">${price}</p><ul class="space-y-1 text-sm text-muted">${extras}</ul></div>`
      );
    })
    .join('');

  const list = (section: 'delivery' | 'payment', items: readonly string[]) =>
    `<section id="${section}" class="space-y-3"><h2 class="text-2xl font-semibold uppercase">${text(t(`public.${section}.title`))}</h2>` +
    `<ul class="max-w-3xl list-disc space-y-2 pl-5 text-sm">${items
      .map((item) => `<li>${text(t(`public.${section}.${item}`))}</li>`)
      .join('')}</ul></section>`;

  const documents = (
    [
      ['terms', 'terms'],
      ['subscription', 'offer'],
      ['privacy', 'privacy'],
      ['personal-data', 'personalData'],
      ['cookies', 'cookies'],
    ] as const
  )
    .map(
      ([slug, key]) =>
        `<li><a class="underline" href="/legal/${slug}">${text(t(`public.footer.${key}`))}</a></li>`,
    )
    .join('');

  return (
    `<div class="flex min-h-screen flex-col">` +
    `<header class="border-b border-border bg-surface"><div class="mx-auto flex max-w-6xl items-center px-4 py-3">` +
    `<a href="/" class="mr-auto font-semibold uppercase">StreamKit</a>` +
    `<a href="/login" class="text-sm underline">${text(t('auth.submitLogin'))}</a></div></header>` +
    `<main class="mx-auto w-full max-w-6xl flex-1 space-y-16 px-4 py-10">` +
    `<section class="space-y-6"><h1 class="text-4xl leading-[1.05] text-balance">${text(t('public.hero.title'))}</h1>` +
    `<p class="max-w-xl text-base text-muted">${text(t('public.hero.lead'))}</p>` +
    `<p><a href="/register" class="underline">${text(t('public.hero.register'))}</a></p></section>` +
    `<section class="space-y-6"><h2 class="text-2xl font-semibold uppercase">${text(t('public.features.title'))}</h2>` +
    `<ul class="grid border-t border-border md:grid-cols-2 md:gap-x-10">${features}</ul></section>` +
    `<section id="pricing" class="space-y-6"><h2 class="text-2xl font-semibold uppercase">${text(t('public.pricing.title'))}</h2>` +
    `<div class="grid gap-4 md:grid-cols-3">${plans}</div>` +
    `<p class="text-xs text-muted">${text(t('public.pricing.note'))} <a class="underline" href="/legal/subscription">${text(t('public.pricing.offer'))}</a></p></section>` +
    list('delivery', ['digital', 'instant', 'term', 'requirements']) +
    list('payment', ['methods', 'card', 'renewal', 'refund']) +
    `</main><footer class="border-t border-border px-4 py-6 text-sm"><nav aria-label="${text(t('public.footer.documents'))}">` +
    `<ul class="mx-auto flex max-w-6xl flex-wrap gap-4">${documents}</ul></nav></footer></div>`
  );
}

/**
 * Структурированные данные главной (schema.org): что за продукт и почём.
 *
 * Продавец в них не указан намеренно: реквизиты самозанятого — персональные
 * данные, и в сборку они не попадают, их отдаёт API (`/api/public/seller`).
 */
export function landingStructuredData(t: TFunction, siteUrl: string): string {
  const offer = (plan: Plan, amount: Money, duration?: 'P1M' | 'P1Y') => ({
    '@type': 'Offer',
    name: t(`billing.plans.${plan}.name`),
    price: decimal(amount.amountMinor),
    priceCurrency: amount.currency,
    ...(duration
      ? {
          priceSpecification: {
            '@type': 'UnitPriceSpecification',
            price: decimal(amount.amountMinor),
            priceCurrency: amount.currency,
            billingDuration: duration,
          },
        }
      : {}),
  });

  const data = [
    {
      '@context': 'https://schema.org',
      '@type': 'WebSite',
      name: 'StreamKit',
      url: `${siteUrl}/`,
      inLanguage: ['ru', 'en'],
    },
    {
      '@context': 'https://schema.org',
      '@type': 'SoftwareApplication',
      name: 'StreamKit',
      url: `${siteUrl}/`,
      applicationCategory: 'MultimediaApplication',
      operatingSystem: 'Web',
      description: t('seo.home.description'),
      offers: [
        offer('free', { amountMinor: 0, currency: 'RUB' }),
        ...PAID_PLANS.flatMap((plan) => [
          offer(plan, PLAN_PRICES[plan].month, 'P1M'),
          offer(plan, PLAN_PRICES[plan].year, 'P1Y'),
        ]),
      ],
    },
  ];
  // `<` экранируется: строка из словаря с «</script>» закрыла бы тег раньше.
  return JSON.stringify(data).replace(/</g, '\\u003c');
}

/** Текст для HTML: снимок собирается строкой, и разметку делаем только мы. */
export function text(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Цена в разметке: целые рубли и копейки без арифметики с плавающей точкой. */
function decimal(amountMinor: number): string {
  const kopecks = amountMinor % 100;
  return `${(amountMinor - kopecks) / 100}.${String(kopecks).padStart(2, '0')}`;
}

function money(amount: Money): string {
  return formatMoney(amount, 'ru-RU');
}
