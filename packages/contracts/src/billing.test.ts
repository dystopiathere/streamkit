import { describe, expect, it } from 'vitest';
import {
  BILLING_PERIODS,
  checkoutInputSchema,
  PLAN_PRICES,
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
  it('цены целые и положительные для каждого периода', () => {
    for (const period of BILLING_PERIODS) {
      expect(Number.isInteger(PLAN_PRICES[period].amountMinor)).toBe(true);
      expect(PLAN_PRICES[period].amountMinor).toBeGreaterThan(0);
    }
  });

  it('оплата без согласия с офертой отвергается схемой', () => {
    expect(checkoutInputSchema.safeParse({ period: 'month' }).success).toBe(false);
    expect(checkoutInputSchema.safeParse({ period: 'month', acceptOffer: false }).success).toBe(
      false,
    );
    expect(checkoutInputSchema.safeParse({ period: 'year', acceptOffer: true }).success).toBe(true);
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
