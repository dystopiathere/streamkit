import { describe, expect, it } from 'vitest';
import { formatMoney } from './common.js';
import { testEventSchema } from './events.js';
import { isLanguage, translateMessage } from './messages.js';

describe('translateMessage', () => {
  it('переводит известное сообщение на английский', () => {
    expect(translateMessage('Неверный email или пароль', 'en')).toBe('Wrong email or password');
  });

  it('на русском и для незнакомого текста возвращает сообщение как есть', () => {
    expect(translateMessage('Неверный email или пароль', 'ru')).toBe('Неверный email или пароль');
    expect(translateMessage('Новое сообщение', 'en')).toBe('Новое сообщение');
  });

  it('не находит свойства Object.prototype', () => {
    expect(translateMessage('constructor', 'en')).toBe('constructor');
  });
});

describe('isLanguage', () => {
  it('знает только языки интерфейса', () => {
    expect(isLanguage('en')).toBe(true);
    expect(isLanguage('de')).toBe(false);
    expect(isLanguage(null)).toBe(false);
  });
});

describe('formatMoney по-английски', () => {
  it('пишет знак рубля, а не код валюты', () => {
    const formatted = formatMoney({ amountMinor: 49_000, currency: 'RUB' }, 'en-US');
    expect(formatted).toContain('₽');
    expect(formatted).not.toContain('RUB');
  });
});

describe('testEventSchema', () => {
  it('принимает запрос без тела', () => {
    expect(testEventSchema.parse(undefined)).toEqual({});
  });

  it('отвергает незнакомый язык', () => {
    expect(testEventSchema.safeParse({ language: 'de' }).success).toBe(false);
  });
});
