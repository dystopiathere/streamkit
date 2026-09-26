import { describe, expect, it } from 'vitest';
import {
  BILLING_PERIODS,
  checkoutInputSchema,
  PAID_PLANS,
  PLAN_FEATURES,
  PLAN_PRICES,
  PLANS,
  updateSubscriptionSchema,
} from './billing.js';
import { minorToDecimalString } from './common.js';

describe('сумма строкой для платёжного API', () => {
  it('всегда два знака после точки', () => {
    expect(minorToDecimalString(0)).toBe('0.00');
    expect(minorToDecimalString(5)).toBe('0.05');
    expect(minorToDecimalString(49_000)).toBe('490.00');
    expect(minorToDecimalString(1_007)).toBe('10.07');
  });

  it('не принимает дробные и отрицательные суммы', () => {
    // Дробная «сумма в копейках» — это уже случившийся float, и молча округлить
    // его значит спрятать ошибку, а не исправить.
    expect(() => minorToDecimalString(10.5)).toThrow(RangeError);
    expect(() => minorToDecimalString(-100)).toThrow(RangeError);
  });
});

describe('тариф', () => {
  it('цены целые и положительные у каждого тарифа и периода', () => {
    for (const plan of PAID_PLANS) {
      for (const period of BILLING_PERIODS) {
        expect(Number.isInteger(PLAN_PRICES[plan][period].amountMinor)).toBe(true);
        expect(PLAN_PRICES[plan][period].amountMinor).toBeGreaterThan(0);
      }
    }
  });

  it('год дешевле двенадцати месяцев: иначе годовой тариф не имеет смысла', () => {
    for (const plan of PAID_PLANS) {
      expect(PLAN_PRICES[plan].year.amountMinor).toBeLessThan(
        PLAN_PRICES[plan].month.amountMinor * 12,
      );
    }
  });

  it('старший тариф не беднее младшего', () => {
    // Тариф дороже — значит, в нём есть всё, что в дешёвом, и что-то сверх.
    // Разъехавшаяся таблица означала бы, что «Про» за 499 ₽ даёт меньше, чем
    // «Мультистрим» за 199 ₽, и заметил бы это оплативший.
    const order = PLANS;
    for (let i = 1; i < order.length; i += 1) {
      const lower = PLAN_FEATURES[order[i - 1]!];
      const upper = PLAN_FEATURES[order[i]!];
      expect(upper.widgets === null || upper.widgets >= (lower.widgets ?? 0)).toBe(true);
      expect(upper.platforms === null || upper.platforms >= (lower.platforms ?? 0)).toBe(true);
      expect(!lower.rooms || upper.rooms).toBe(true);
      expect(!lower.advancedStyling || upper.advancedStyling).toBe(true);
      // Подпись в кадре — ограничение, а не функция: у старшего её не больше.
      expect(!upper.branding || lower.branding).toBe(true);
    }
  });

  it('оплата без согласия с офертой и без тарифа отвергается схемой', () => {
    expect(checkoutInputSchema.safeParse({ plan: 'pro', period: 'month' }).success).toBe(false);
    expect(
      checkoutInputSchema.safeParse({ plan: 'pro', period: 'month', acceptOffer: false }).success,
    ).toBe(false);
    // Бесплатный тариф не оплачивается: его нет среди платных.
    expect(
      checkoutInputSchema.safeParse({ plan: 'free', period: 'year', acceptOffer: true }).success,
    ).toBe(false);
    expect(
      checkoutInputSchema.safeParse({ plan: 'multistream', period: 'year', acceptOffer: true })
        .success,
    ).toBe(true);
  });

  it('автопродление включается обратно только с согласием на списания', () => {
    expect(updateSubscriptionSchema.safeParse({ autoRenew: true }).success).toBe(false);
    expect(updateSubscriptionSchema.safeParse({ autoRenew: true, acceptOffer: true }).success).toBe(
      true,
    );
    // Выключить — без условий: отказ от списаний не требует ничего подтверждать.
    expect(updateSubscriptionSchema.safeParse({ autoRenew: false }).success).toBe(true);
  });
});
