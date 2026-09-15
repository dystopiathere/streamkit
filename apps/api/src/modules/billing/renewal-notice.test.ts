import { describe, expect, it } from 'vitest';
import { renewalNoticeMessage } from './renewal-notice';

describe('письмо о предстоящем списании', () => {
  const base = {
    email: 'streamer@example.com',
    displayName: 'Стример',
    amount: { amountMinor: 49_000, currency: 'RUB' as const },
    period: 'month' as const,
    periodEnd: new Date('2026-10-15T21:30:00Z'),
    chargeNotBefore: new Date('2026-10-14T21:30:00Z'),
    paymentMethodTitle: 'Карта *4444',
    webBaseUrl: 'https://stream-kit.ru/',
  };

  it('называет сумму, способ оплаты, даты по Москве и где выключить продление', () => {
    const message = renewalNoticeMessage(base);

    expect(message.to).toBe('streamer@example.com');
    // 21:30 UTC — это уже следующие сутки по Москве.
    expect(message.text).toContain('заканчивается 16 октября 2026');
    expect(message.text).toContain('Не ранее 15 октября 2026');
    expect(message.text).toContain('(Карта *4444)');
    expect(message.text).toMatch(/490\s₽/);
    expect(message.text).toContain('https://stream-kit.ru/billing');
    expect(message.text).toContain('https://stream-kit.ru/legal/subscription');
  });

  it('обходится без подписи способа оплаты', () => {
    const message = renewalNoticeMessage({ ...base, paymentMethodTitle: null, period: 'year' });
    expect(message.text).toContain('способа оплаты будет списано');
    expect(message.text).toContain('на 1 год');
  });
});
