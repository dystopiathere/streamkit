import { describe, expect, it } from 'vitest';
import { expiryNoticeMessage, renewalNoticeMessage } from './renewal-notice';

describe('письмо о предстоящем списании', () => {
  const base = {
    email: 'streamer@example.com',
    displayName: 'Стример',
    language: 'ru' as const,
    plan: 'pro' as const,
    amount: { amountMinor: 49_000, currency: 'RUB' as const },
    period: 'month' as const,
    periodEnd: new Date('2026-10-15T21:30:00Z'),
    chargeNotBefore: new Date('2026-10-14T21:30:00Z'),
    paymentMethodTitle: 'Карта *4444',
    webBaseUrl: 'https://stream-kit.ru/',
  };

  it('называет тариф, сумму, способ оплаты, даты по Москве и где выключить продление', () => {
    const message = renewalNoticeMessage(base);

    expect(message.to).toBe('streamer@example.com');
    expect(message.subject).toMatch(/^StreamKit: 15 октября 2026 спишем 490\s₽ за тариф «Про»$/);
    // 21:30 UTC — это уже следующие сутки по Москве.
    expect(message.text).toContain('заканчивается 16 октября 2026');
    expect(message.text).toContain('Не ранее: 15 октября 2026');
    expect(message.text).toContain('Способ оплаты: Карта *4444');
    expect(message.text).toContain('Продление на: 1 месяц');
    expect(message.text).toContain('https://stream-kit.ru/account/billing');
    expect(message.text).toContain('https://stream-kit.ru/legal/subscription');
  });

  it('обходится без подписи способа оплаты и пишет по-английски', () => {
    const message = renewalNoticeMessage({
      ...base,
      paymentMethodTitle: null,
      period: 'year',
      plan: 'multistream',
      language: 'en',
    });
    expect(message.text).not.toContain('Payment method');
    expect(message.text).toContain('Renews for: 1 year');
    expect(message.subject).toContain('“Multistream” plan');
    expect(message.text).toContain('https://stream-kit.ru/account/billing?lang=en');
  });
});

describe('письмо о конце оплаченного периода', () => {
  it('говорит, что списания не будет, что сохранится и как продлить', () => {
    const message = expiryNoticeMessage({
      email: 'streamer@example.com',
      displayName: 'Стример',
      language: 'ru',
      plan: 'multistream',
      periodEnd: new Date('2026-10-15T21:30:00Z'),
      webBaseUrl: 'https://stream-kit.ru',
    });
    expect(message.subject).toBe('StreamKit: тариф «Мультистрим» оплачен до 16 октября 2026');
    expect(message.text).toContain('ничего не спишется');
    expect(message.text).toContain('Виджеты и настройки сохранятся');
    expect(message.text).toContain('https://stream-kit.ru/account/billing');
  });
});
