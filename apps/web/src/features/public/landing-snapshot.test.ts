import { PAID_PLANS, PLAN_PRICES, formatMoney } from '@streamkit/contracts';
import { describe, expect, it } from 'vitest';
import { landingSnapshot, landingStructuredData, text } from './landing-snapshot';
import i18n from '@/lib/i18n';

const t = i18n.getFixedT('ru');

/**
 * Снимок главной видит робот без JavaScript — и видит его вместо живой страницы.
 * Разойтись с ней по ценам он не вправе: цена в выдаче, которой нет на сайте,
 * хуже, чем отсутствие снимка.
 */
describe('статический снимок главной', () => {
  it('говорит то же, что живая главная: заголовок, возможности, тарифы', () => {
    const html = landingSnapshot(t);

    expect(html).toContain(
      `<h1 class="text-4xl leading-[1.05] text-balance">${text(t('public.hero.title'))}</h1>`,
    );
    expect(html).toContain(text(t('public.features.chat.title')));
    for (const plan of PAID_PLANS) {
      expect(html).toContain(text(formatMoney(PLAN_PRICES[plan].month, 'ru-RU')));
      expect(html).toContain(text(formatMoney(PLAN_PRICES[plan].year, 'ru-RU')));
    }
    // Ссылки — обычные `<a href>`: по ним робот уходит к регистрации и документам.
    expect(html).toContain('href="/register"');
    expect(html).toContain('href="/legal/subscription"');
  });

  it('структурированные данные — цены из PLAN_PRICES, без реквизитов продавца', () => {
    const data = JSON.parse(landingStructuredData(t, 'https://example.test')) as Array<{
      '@type': string;
      offers?: Array<{ price: string; priceCurrency: string }>;
      seller?: unknown;
    }>;
    const app = data.find((item) => item['@type'] === 'SoftwareApplication')!;

    expect(app.offers!.map((offer) => offer.price)).toEqual([
      '0.00',
      ...PAID_PLANS.flatMap((plan) => [
        `${PLAN_PRICES[plan].month.amountMinor / 100}.00`,
        `${PLAN_PRICES[plan].year.amountMinor / 100}.00`,
      ]),
    ]);
    expect(app.offers!.every((offer) => offer.priceCurrency === 'RUB')).toBe(true);
    expect(app.seller).toBeUndefined();
  });

  it('текст экранируется: строка словаря не становится разметкой', () => {
    expect(text('<script>&"')).toBe('&lt;script&gt;&amp;&quot;');
    // Внутри <script type="application/ld+json"> «</script>» закрыл бы тег.
    const fake = ((key: string) =>
      key === 'seo.home.description' ? '</script><b>' : key) as never;
    expect(landingStructuredData(fake, 'https://example.test')).not.toContain('</script>');
  });
});
