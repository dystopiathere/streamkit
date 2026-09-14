import { GRACE_DAYS } from '@streamkit/contracts';
import { describe, expect, it } from 'vitest';
import { addBillingPeriod, DAY_MS, subscriptionStatus } from './billing-periods';

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
