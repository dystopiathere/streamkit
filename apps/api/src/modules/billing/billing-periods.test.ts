import { GRACE_DAYS, PLAN_FEATURES } from '@streamkit/contracts';
import { describe, expect, it } from 'vitest';
import {
  addBillingPeriod,
  DAY_MS,
  effectivePlan,
  paidPlan,
  subscriptionStatus,
} from './billing-periods';

const utc = (iso: string) => new Date(iso);

describe('период подписки', () => {
  it('месяц — календарный: 15-е число остаётся 15-м', () => {
    expect(addBillingPeriod(utc('2026-09-15T10:00:00Z'), 'month').toISOString()).toBe(
      '2026-10-15T10:00:00.000Z',
    );
  });

  it('31 января + месяц — последний день февраля, а не 3 марта', () => {
    expect(addBillingPeriod(utc('2026-01-31T12:00:00Z'), 'month').toISOString()).toBe(
      '2026-02-28T12:00:00.000Z',
    );
    expect(addBillingPeriod(utc('2028-01-31T12:00:00Z'), 'month').toISOString()).toBe(
      '2028-02-29T12:00:00.000Z',
    );
  });

  it('декабрь переходит в январь следующего года', () => {
    expect(addBillingPeriod(utc('2026-12-20T00:00:00Z'), 'month').toISOString()).toBe(
      '2027-01-20T00:00:00.000Z',
    );
  });

  it('год от 29 февраля — 28 февраля следующего года', () => {
    expect(addBillingPeriod(utc('2028-02-29T08:00:00Z'), 'year').toISOString()).toBe(
      '2029-02-28T08:00:00.000Z',
    );
  });
});

describe('состояние подписки', () => {
  const end = utc('2026-10-15T00:00:00Z');

  it('без оплаченного периода — none', () => {
    expect(subscriptionStatus(null, end)).toBe('none');
    expect(subscriptionStatus({ currentPeriodEnd: null, autoRenew: true }, end)).toBe('none');
  });

  it('льготные дни — только при включённом автопродлении', () => {
    const afterEnd = new Date(end.getTime() + DAY_MS);
    expect(subscriptionStatus({ currentPeriodEnd: end, autoRenew: true }, afterEnd)).toBe('grace');
    // Отказавшийся от продления доживает оплаченное и не больше.
    expect(subscriptionStatus({ currentPeriodEnd: end, autoRenew: false }, afterEnd)).toBe(
      'expired',
    );
  });

  it('после льготных дней — expired', () => {
    const late = new Date(end.getTime() + GRACE_DAYS * DAY_MS);
    expect(subscriptionStatus({ currentPeriodEnd: end, autoRenew: true }, late)).toBe('expired');
  });
});

describe('действующий тариф', () => {
  const end = utc('2026-10-15T00:00:00Z');
  const inside = utc('2026-10-01T00:00:00Z');

  it('без подписки — бесплатный', () => {
    expect(effectivePlan(null, inside, null)).toBe('free');
    expect(
      effectivePlan({ plan: 'PRO', currentPeriodEnd: null, autoRenew: false }, inside, null),
    ).toBe('free');
  });

  it('внутри оплаченного периода — тариф из подписки', () => {
    expect(
      effectivePlan({ plan: 'PRO', currentPeriodEnd: end, autoRenew: true }, inside, null),
    ).toBe('pro');
    expect(
      effectivePlan({ plan: 'MULTISTREAM', currentPeriodEnd: end, autoRenew: false }, inside, null),
    ).toBe('multistream');
  });

  it('в льготные дни тариф ещё действует, после них — нет', () => {
    const grace = new Date(end.getTime() + DAY_MS);
    const late = new Date(end.getTime() + GRACE_DAYS * DAY_MS);
    expect(
      effectivePlan({ plan: 'PRO', currentPeriodEnd: end, autoRenew: true }, grace, null),
    ).toBe('pro');
    expect(effectivePlan({ plan: 'PRO', currentPeriodEnd: end, autoRenew: true }, late, null)).toBe(
      'free',
    );
    // Без автопродления льготных дней нет: тариф кончается вместе с периодом.
    expect(
      effectivePlan({ plan: 'PRO', currentPeriodEnd: end, autoRenew: false }, grace, null),
    ).toBe('free');
  });

  it('истёкшая подписка не открывает ничего сверх бесплатного', () => {
    const late = new Date(end.getTime() + 365 * DAY_MS);
    const plan = effectivePlan({ plan: 'PRO', currentPeriodEnd: end, autoRenew: true }, late, null);
    expect(PLAN_FEATURES[plan]).toEqual(PLAN_FEATURES.free);
  });
});

describe('«Про» за приглашения', () => {
  const end = utc('2026-10-15T00:00:00Z');
  const inside = utc('2026-10-01T00:00:00Z');
  const multistream = { plan: 'MULTISTREAM' as const, currentPeriodEnd: end, autoRenew: true };

  it('пока срок не кончился — «Про» поверх любого тарифа', () => {
    const until = new Date(inside.getTime() + DAY_MS);
    expect(effectivePlan(null, inside, until)).toBe('pro');
    expect(effectivePlan(multistream, inside, until)).toBe('pro');
  });

  it('после срока — снова оплаченный тариф, а оплаченным тариф не становится вовсе', () => {
    expect(effectivePlan(multistream, inside, inside)).toBe('multistream');
    expect(effectivePlan(null, inside, new Date(inside.getTime() - DAY_MS))).toBe('free');
    expect(paidPlan(null, inside)).toBe('free');
    expect(paidPlan(multistream, inside)).toBe('multistream');
  });
});
