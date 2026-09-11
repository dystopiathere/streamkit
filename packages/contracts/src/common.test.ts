import { describe, expect, it } from 'vitest';
import { formatMoney, moneySchema, toMinor } from './common.js';
import { dedupKey, incomingAlertEventSchema } from './events.js';

describe('деньги', () => {
  it('переводит мажорные единицы в минорные без потерь на дробных значениях', () => {
    expect(toMinor(10.1, 'RUB')).toEqual({ amountMinor: 1010, currency: 'RUB' });
    expect(toMinor(0.07, 'USD')).toEqual({ amountMinor: 7, currency: 'USD' });
    // 19.99 * 100 в плавающей точке даёт 1998.9999...; округление обязано дать 1999
    expect(toMinor(19.99, 'EUR')).toEqual({ amountMinor: 1999, currency: 'EUR' });
  });

  it('запрещает дробные и отрицательные минорные единицы', () => {
    expect(moneySchema.safeParse({ amountMinor: 10.5, currency: 'RUB' }).success).toBe(false);
    expect(moneySchema.safeParse({ amountMinor: -1, currency: 'RUB' }).success).toBe(false);
  });

  it('запрещает неизвестную валюту', () => {
    expect(moneySchema.safeParse({ amountMinor: 100, currency: 'XXX' }).success).toBe(false);
  });

  it('форматирует сумму для отображения', () => {
    const formatted = formatMoney({ amountMinor: 150_000, currency: 'RUB' });
    // Разделители разрядов зависят от ICU, поэтому проверяем содержательную часть
    expect(formatted).toContain('1');
    expect(formatted).toContain('500');
  });
});

describe('входящее событие', () => {
  it('подставляет дефолты для необязательных полей', () => {
    const parsed = incomingAlertEventSchema.parse({
      userId: '00000000-0000-4000-8000-000000000001',
      type: 'donation',
      provider: 'donationalerts',
      externalId: 'da-42',
      username: 'Аноним',
    });
    expect(parsed.message).toBe('');
    expect(parsed.amount).toBeNull();
    expect(parsed.isTest).toBe(false);
  });

  it('требует externalId — без него невозможна дедупликация', () => {
    const result = incomingAlertEventSchema.safeParse({
      userId: '00000000-0000-4000-8000-000000000001',
      type: 'donation',
      provider: 'donationalerts',
      externalId: '',
      username: 'Аноним',
    });
    expect(result.success).toBe(false);
  });

  it('строит ключ дедупликации, различающий провайдеров с одинаковым id', () => {
    expect(dedupKey({ provider: 'donationalerts', externalId: '42' })).toBe(
      'dedup:donationalerts:42',
    );
    expect(dedupKey({ provider: 'donatepay', externalId: '42' })).not.toBe(
      dedupKey({ provider: 'donationalerts', externalId: '42' }),
    );
  });
});
