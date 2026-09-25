import { describe, expect, it } from 'vitest';
import type { DonatePayTransaction } from './donatepay.api';
import {
  DONATEPAY_ALERT_FRESH_MS,
  DONATEPAY_PENDING_HOLD_MS,
  normalizeDonatePayDonation,
  parseDonatePayTime,
  planDonatePayPoll,
} from './donatepay.connector';

const userId = '00000000-0000-4000-8000-000000000001';
const now = Date.parse('2026-09-25T12:00:00Z');

/** Донат в формате DonatePay: время — `DateTime` PHP в московской зоне. */
function donation(
  id: number,
  overrides: Partial<DonatePayTransaction> & { agoMs?: number } = {},
): DonatePayTransaction {
  const { agoMs = 5_000, ...rest } = overrides;
  const moscow = new Date(now - agoMs + 3 * 3_600_000).toISOString().replace('T', ' ');
  return {
    id,
    type: 'donation',
    status: 'success',
    sum: '100.00',
    vars: { name: 'Зритель', comment: 'Привет' },
    created_at: { date: `${moscow.slice(0, 19)}.000000`, timezone: 'Europe/Moscow' },
    ...rest,
  };
}

describe('донат DonatePay → событие', () => {
  it('переводит сумму строкой в копейки, валюта по умолчанию — рубли', () => {
    const event = normalizeDonatePayDonation(donation(7, { sum: '150.5' }), userId);
    expect(event).toMatchObject({
      provider: 'donatepay',
      externalId: '7',
      username: 'Зритель',
      message: 'Привет',
      amount: { amountMinor: 15_050, currency: 'RUB' },
    });
    expect(normalizeDonatePayDonation(donation(8, { sum: 99.99 }), userId).amount).toEqual({
      amountMinor: 9_999,
      currency: 'RUB',
    });
  });

  it('незнакомую валюту не выдаёт за рубли, пустое имя — «Аноним»', () => {
    const event = normalizeDonatePayDonation(
      donation(9, { currency: 'GBP', vars: { name: '  ' } }),
      userId,
    );
    expect(event.amount).toBeNull();
    expect(event.username).toBe('Аноним');
    expect(event.message).toBe('');
  });

  it('берёт комментарий транзакции, если в vars его нет, и режет длинное', () => {
    const event = normalizeDonatePayDonation(
      donation(10, { vars: { name: 'x'.repeat(100) }, comment: 'y'.repeat(600) }),
      userId,
    );
    expect(event.username).toHaveLength(64);
    expect(event.message).toHaveLength(500);
  });

  it('время доната ставит временем события', () => {
    expect(normalizeDonatePayDonation(donation(11, { agoMs: 60_000 }), userId).occurredAt).toBe(
      new Date(now - 60_000).toISOString(),
    );
  });
});

describe('время DonatePay', () => {
  it('понимает DateTime PHP с зоной IANA и со смещением', () => {
    expect(
      parseDonatePayTime({ date: '2026-09-25 15:00:00.000000', timezone: 'Europe/Moscow' }),
    ).toEqual(new Date('2026-09-25T12:00:00Z'));
    expect(parseDonatePayTime({ date: '2026-09-25 15:00:00', timezone: '+03:00' })).toEqual(
      new Date('2026-09-25T12:00:00Z'),
    );
    expect(parseDonatePayTime({ date: '2026-09-25 12:00:00', timezone: 'UTC' })).toEqual(
      new Date('2026-09-25T12:00:00Z'),
    );
  });

  it('понимает строку ISO и не выдумывает время там, где его не разобрать', () => {
    expect(parseDonatePayTime('2026-09-25T15:00:00+03:00')).toEqual(
      new Date('2026-09-25T12:00:00Z'),
    );
    expect(parseDonatePayTime({ date: '2026-09-25 15:00:00', timezone: 'MSK' })).toBeNull();
    expect(parseDonatePayTime('вчера')).toBeNull();
    expect(parseDonatePayTime(null)).toBeNull();
  });
});

describe('опрос DonatePay', () => {
  const ids = (plan: { emit: DonatePayTransaction[] }): number[] =>
    plan.emit.map((item) => Number(item.id));

  it('первое подключение не показывает историю: курсор встаёт на самый новый донат', () => {
    const plan = planDonatePayPoll(
      [donation(12), donation(10), donation(11)],
      null,
      new Set(),
      now,
    );
    expect(plan).toEqual({ emit: [], cursor: 12 });
    expect(planDonatePayPoll([], null, new Set(), now)).toEqual({ emit: [], cursor: 0 });
  });

  it('показывает новые успешные донаты по порядку и двигает курсор', () => {
    const plan = planDonatePayPoll(
      [donation(13), donation(12), donation(11), donation(10)],
      11,
      new Set(),
      now,
    );
    expect(ids(plan)).toEqual([12, 13]);
    expect(plan.cursor).toBe(13);
  });

  it('ожидающий оплаты донат держит курсор и показывается, когда станет успешным', () => {
    const first = planDonatePayPoll(
      [donation(13), donation(12, { status: 'wait' }), donation(11)],
      11,
      new Set(),
      now,
    );
    expect(ids(first)).toEqual([13]);
    expect(first.cursor).toBe(11);

    const second = planDonatePayPoll(
      [donation(13), donation(12), donation(11)],
      first.cursor,
      new Set([13]),
      now,
    );
    expect(ids(second)).toEqual([12]);
    expect(second.cursor).toBe(13);
  });

  it('брошенная оплата не держит курсор дольше часа', () => {
    const plan = planDonatePayPoll(
      [donation(13), donation(12, { status: 'wait', agoMs: DONATEPAY_PENDING_HOLD_MS + 1 })],
      11,
      new Set(),
      now,
    );
    expect(plan.cursor).toBe(13);
  });

  it('отменённый донат не показывается, но курсор проходит его', () => {
    const plan = planDonatePayPoll([donation(12, { status: 'cancel' })], 11, new Set(), now);
    expect(plan).toEqual({ emit: [], cursor: 12 });
  });

  it('после простоя не вываливает в кадр старые донаты, но курсор их проходит', () => {
    const plan = planDonatePayPoll(
      [donation(13), donation(12, { agoMs: DONATEPAY_ALERT_FRESH_MS + 1 })],
      11,
      new Set(),
      now,
    );
    expect(ids(plan)).toEqual([13]);
    expect(plan.cursor).toBe(13);
  });
});
