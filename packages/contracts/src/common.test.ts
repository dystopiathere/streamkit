import { describe, expect, it } from 'vitest';
import { formatMinorForInput, formatMoney, moneySchema, parseMajorToMinor } from './common.js';
import { dedupKey, incomingAlertEventSchema } from './events.js';

describe('деньги', () => {
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

describe('ввод сумм в рублях', () => {
  it('разбирает целые рубли', () => {
    expect(parseMajorToMinor('1000')).toBe(100_000);
  });

  it('разбирает копейки после точки и запятой', () => {
    expect(parseMajorToMinor('10.07')).toBe(1007);
    expect(parseMajorToMinor('10,5')).toBe(1050);
  });

  it('не теряет копейку на плавающей точке', () => {
    // Math.round(10.07 * 100) ещё угадывает, а на длинных суммах перестаёт.
    // Поэтому строка разбирается посимвольно, а не умножается на сто.
    expect(parseMajorToMinor('8999999.99')).toBe(899_999_999);
    expect(parseMajorToMinor('1.005')).toBeNull();
  });

  it('отличает пустой ввод от нуля', () => {
    expect(parseMajorToMinor('')).toBeNull();
    expect(parseMajorToMinor('0')).toBe(0);
  });

  it('отвергает мусор', () => {
    expect(parseMajorToMinor('тысяча')).toBeNull();
    expect(parseMajorToMinor('1e3')).toBeNull();
  });

  it('принимает отрицательные: стартовая сумма цели бывает с долгом', () => {
    expect(parseMajorToMinor('-500')).toBe(-50_000);
  });

  it('превращает копейки обратно в строку для поля ввода', () => {
    expect(formatMinorForInput(100_000)).toBe('1000');
    expect(formatMinorForInput(1007)).toBe('10.07');
    expect(formatMinorForInput(1050)).toBe('10.50');
    expect(formatMinorForInput(0)).toBe('0');
    expect(formatMinorForInput(-50_000)).toBe('-500');
  });

  it('переживает круг туда-обратно', () => {
    for (const minor of [0, 1, 99, 100, 1007, 100_000, 899_999_999]) {
      expect(parseMajorToMinor(formatMinorForInput(minor))).toBe(minor);
    }
  });
});
